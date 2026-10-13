import { beforeEach, expect, test, vi } from 'vitest'
import { handle, type Deps } from '../src/router'
import { readConfig, type Env } from '../src/config'
import { hashIp, signSession } from '../src/session'
import { CLARIFY_PROMPT, TRANSCRIBE_PROMPT } from '../src/prompt'
import type { LimitResult } from '../src/limits'

const env = { ENABLED: 'true', ALLOWED_ORIGINS: 'https://brinhan.github.io', GEMINI_MODEL: 'm', IP_PER_HOUR: '40', IP_PER_DAY: '120', GLOBAL_PER_MINUTE: '8', GLOBAL_PER_DAY: '800', SESSION_TTL_SEC: '600', GEMINI_API_KEY: 'test-key', TURNSTILE_SECRET: 't', SESSION_SECRET: 's' }
const ORIGIN = 'https://brinhan.github.io'
const IP = '1.1.1.1'
const envelope = (payload: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] })
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes, ...new Array(30).fill(0)))
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0])
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

type TestDeps = Omit<Deps, 'fetch'> & { fetch: ReturnType<typeof vi.fn>; limiterCalls: number; token: string }
let limitResult: LimitResult
let d: TestDeps
let reply: unknown

async function mk(): Promise<TestDeps> {
  const config = { ...readConfig(env as Env), allowedOrigins: [ORIGIN] }
  const store = new Map<string, any>()
  const token = await signSession('s', await hashIp('s', IP), 0, 600)
  const out: TestDeps = {
    config, token, limiterCalls: 0,
    fetch: vi.fn(async () => new Response(JSON.stringify(envelope(reply)), { status: 200 })),
    limiter: { check: async () => { out.limiterCalls++; return limitResult } },
    cache: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v) } },
    now: () => 1000, ip: IP,
  }
  return out
}
beforeEach(async () => { limitResult = { ok: true }; reply = { text: 'ΔH_sub = ΔH_fus', legible: true }; d = await mk() })

const post = (path: string, body: unknown, token: string | null = d.token) =>
  new Request('https://p' + path, { method: 'POST', headers: { origin: ORIGIN, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const run = (req: Request) => handle(req, d as Deps)
const tr = (image: unknown, mimeType = 'image/jpeg') => post('/transcribe', { image, mimeType })

test('prompts are exact', () => {
  expect(TRANSCRIBE_PROMPT.startsWith("You transcribe one page of a student's notes")).toBe(true)
  expect(TRANSCRIBE_PROMPT.endsWith('then text is "".')).toBe(true)
  expect(CLARIFY_PROMPT.endsWith('Return one resolution per item.')).toBe(true)
})

test('transcribe: valid JPEG -> Gemini gets inline_data, key in header -> 200', async () => {
  const r = await run(tr(JPEG)); expect(r.status).toBe(200)
  expect(await r.json()).toEqual({ text: 'ΔH_sub = ΔH_fus', legible: true })
  const [url, init] = d.fetch.mock.calls[0]
  expect(url).not.toContain('key='); expect(init.headers['x-goog-api-key']).toBe('test-key'); expect(init.body).not.toContain('test-key')
  const body = JSON.parse(init.body)
  expect(body.contents[0].parts[0]).toEqual({ inline_data: { mime_type: 'image/jpeg', data: JPEG } })
  expect(body.systemInstruction.parts[0].text).toBe(TRANSCRIBE_PROMPT)
  expect(body.generationConfig.temperature).toBe(0.1)
  expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(512)
  expect(body.generationConfig.responseSchema.required).toEqual(['text', 'legible'])
})
test('transcribe: requires session and fails closed', async () => {
  expect((await run(post('/transcribe', { image: JPEG, mimeType: 'image/jpeg' }, null))).status).toBe(401)
  d.config = { ...d.config, geminiKey: '' }
  const r = await run(tr(JPEG)); expect(r.status).toBe(503); expect(await r.json()).toEqual({ error: 'disabled' })
  expect(d.fetch).not.toHaveBeenCalled()
})
test('transcribe: PNG bytes declared as JPEG -> 400', async () => {
  const r = await run(tr(PNG)); expect(r.status).toBe(400); expect(await r.json()).toEqual({ error: 'bad-request' })
  expect((await run(tr(PNG, 'image/png'))).status).toBe(200)
  expect((await run(tr(PNG, 'image/gif'))).status).toBe(400)
})
test('transcribe: body over 2 MB -> 413', async () => {
  const r = await run(tr('A'.repeat(2_000_001))); expect(r.status).toBe(413)
})
test('transcribe: image over the base64 cap or non-base64 -> 400', async () => {
  expect((await run(tr(JPEG.slice(0, 20) + 'A'.repeat(1_900_000)))).status).toBe(400)
  for (const bad of ['not base64!', 'data:image/jpeg;base64,' + JPEG, '', 5]) expect((await run(tr(bad))).status).toBe(400)
  expect(d.fetch).not.toHaveBeenCalled()
})
test('transcribe: legible:false passes through with empty text, and is cached', async () => {
  reply = { text: 'something', legible: false }
  let r = await run(tr(JPEG)); expect(r.status).toBe(200); expect(await r.json()).toEqual({ text: '', legible: false })
  r = await run(tr(JPEG)); expect(await r.json()).toEqual({ text: '', legible: false })
  expect(d.fetch).toHaveBeenCalledTimes(1)
})
test('transcribe: off-schema Gemini output -> 502, not cached', async () => {
  reply = { poem: 'roses' }
  const r = await run(tr(JPEG)); expect(r.status).toBe(502); expect(await r.json()).toEqual({ error: 'upstream' })
  reply = { text: 'ok', legible: true }
  expect((await run(tr(JPEG))).status).toBe(200); expect(d.fetch).toHaveBeenCalledTimes(2)
})
test('transcribe: second identical image is served from cache without Gemini or the limiter', async () => {
  await run(tr(JPEG)); const r = await run(tr(JPEG))
  expect(r.status).toBe(200); expect(d.fetch).toHaveBeenCalledTimes(1); expect(d.limiterCalls).toBe(1)
})
test('transcribe: rate limited -> 429', async () => {
  limitResult = { ok: false, reason: 'ip-hour', retryAfterSec: 60 }
  const r = await run(tr(JPEG)); expect(r.status).toBe(429); expect(d.fetch).not.toHaveBeenCalled()
})

const items = [{ id: 'u1', kind: 'w', raw: 'enthalpv', guesses: ['enthalpy'] }, { id: 'u2', kind: 's', raw: 'E', guesses: [] }]
const text = 'The ⟦u1:enthalpv⟧ of ⟦u2:E⟧ <b> here'
const cl = (body: unknown = { text, items }) => post('/clarify', body)

test('clarify: valid request -> resolutions filtered to request ids', async () => {
  reply = { resolutions: [{ id: 'u1', value: 'enthalpy', confidence: 'high' }, { id: 'u9', value: 'zzz', confidence: 'high' }, { id: 'u2', value: 'energy of sublimation', confidence: 'medium' }] }
  const r = await run(cl()); expect(r.status).toBe(200)
  expect(await r.json()).toEqual({ resolutions: [{ id: 'u1', value: 'enthalpy', confidence: 'high' }, { id: 'u2', value: 'energy of sublimation', confidence: 'medium' }] })
  const body = JSON.parse(d.fetch.mock.calls[0][1].body)
  expect(body.contents[0].parts).toHaveLength(1)
  expect(body.contents[0].parts[0].text).toBe(`<notes>\nThe ⟦u1:enthalpv⟧ of ⟦u2:E⟧ ‹b› here\n</notes>\nItems:\n${JSON.stringify(items)}`)
  expect(body.systemInstruction.parts[0].text).toBe(CLARIFY_PROMPT)
  expect(body.generationConfig.temperature).toBe(0.2)
  expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(1024)
})
test('clarify: bad shapes -> 400', async () => {
  const it = items[0]
  const bad: unknown[] = [
    { text, items: [{ id: 'u3', kind: 'w', raw: 'x', guesses: [] }] },
    { text: '', items },
    { text, items: [] },
    { text, items: [it, it] },
    { text, items: [{ ...it, id: 'x1' }] },
    { text, items: [{ ...it, kind: 'q' }] },
    { text, items: [{ ...it, guesses: ['a', 'b', 'c', 'd'] }] },
    { text: 'x'.repeat(24001), items },
    { text: 5, items },
  ]
  for (const b of bad) { const r = await run(cl(b)); expect(r.status).toBe(400) }
  expect(d.fetch).not.toHaveBeenCalled()
})
test('clarify: zero valid resolutions -> 502; rate limited -> 429; cache skips limiter', async () => {
  reply = { resolutions: [{ id: 'u9', value: 'x', confidence: 'high' }] }
  expect((await run(cl())).status).toBe(502)
  reply = { resolutions: [{ id: 'u1', value: 'enthalpy', confidence: 'high' }] }
  await run(cl()); await run(cl())
  expect(d.fetch).toHaveBeenCalledTimes(2); expect(d.limiterCalls).toBe(2)
  limitResult = { ok: false, reason: 'ip-day', retryAfterSec: 60 }
  expect((await run(cl({ text: text + ' more', items }))).status).toBe(429)
})
test('clarify: requires a session and fails closed', async () => {
  expect((await run(post('/clarify', { text, items }, null))).status).toBe(401)
  d.config = { ...d.config, sessionSecret: '' }
  expect((await run(cl())).status).toBe(503)
})
