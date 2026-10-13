import { expect, test } from 'vitest'
import { handle, type Deps } from '../src/router'
import { readConfig, type Env } from '../src/config'
import { readJsonBody } from '../src/http'

const env = { ENABLED: 'true', ALLOWED_ORIGINS: 'https://brinhan.github.io', GEMINI_MODEL: 'm', IP_PER_HOUR: '40', IP_PER_DAY: '120', GLOBAL_PER_MINUTE: '8', GLOBAL_PER_DAY: '800', SESSION_TTL_SEC: '600', GEMINI_API_KEY: 'k', TURNSTILE_SECRET: 't', SESSION_SECRET: 's' }
const ORIGIN = 'https://brinhan.github.io'

function deps(over: { enabled?: boolean } = {}): Deps {
  const config = { ...readConfig(env as Env), allowedOrigins: [ORIGIN], ...over }
  return { config, fetch, limiter: { check: async () => ({ ok: true }) }, cache: { get: async () => undefined, put: async () => {} }, now: () => 0, ip: '1.2.3.4' }
}
const post = (path: string, body: unknown) => new Request('https://p' + path, { method: 'POST', headers: { origin: ORIGIN }, body: JSON.stringify(body) })
const get = (path: string) => new Request('https://p' + path, { headers: { origin: ORIGIN } })

test('rejects requests with no Origin or a foreign Origin with 403 and no CORS headers', async () => {
  const r1 = await handle(new Request('https://p/session', { method: 'POST' }), deps())
  const r2 = await handle(new Request('https://p/session', { method: 'POST', headers: { origin: 'https://evil.example' } }), deps())
  expect([r1.status, r2.status]).toEqual([403, 403])
  expect(r2.headers.get('access-control-allow-origin')).toBeNull()
})
test('answers preflight from an allowed origin with 204 and CORS headers', async () => {
  const r = await handle(new Request('https://p/generate', { method: 'OPTIONS', headers: { origin: ORIGIN } }), deps())
  expect(r.status).toBe(204)
  expect(r.headers.get('access-control-allow-origin')).toBe(ORIGIN)
})
test('kill switch returns 503 disabled for every route', async () => {
  const r = await handle(post('/generate', {}), deps({ enabled: false }))
  expect(r.status).toBe(503); expect(await r.json()).toEqual({ error: 'disabled' })
})
test('unknown path or GET returns 404 not-found', async () => {
  expect((await handle(get('/'), deps())).status).toBe(404)
  expect((await handle(get('/session'), deps())).status).toBe(404)
})
test('readJsonBody rejects bodies over 64 KB and invalid JSON', async () => {
  expect(await readJsonBody(new Request('https://p', { method: 'POST', body: 'x'.repeat(65537) }))).toEqual({ ok: false, code: 'too-large' })
  expect(await readJsonBody(new Request('https://p', { method: 'POST', body: '{nope' }))).toEqual({ ok: false, code: 'bad-request' })
})
test('readJsonBody counts UTF-8 bytes, not characters', async () => {
  expect(await readJsonBody(new Request('https://p', { method: 'POST', body: '"' + 'é'.repeat(33000) + '"' }))).toEqual({ ok: false, code: 'too-large' })
})
test('readConfig falls back to defaults for bad numbers', () => {
  expect(readConfig({ ...env, IP_PER_HOUR: 'abc' } as Env).limits.ipPerHour).toBe(40)
  expect(readConfig({ ...env, IP_PER_DAY: '0' } as Env).limits.ipPerDay).toBe(120)
  expect(readConfig({ ...env, ENABLED: 'TRUE' } as Env).enabled).toBe(false)
  expect(readConfig({ ...env, SESSION_TTL_SEC: '' } as Env).sessionTtlSec).toBe(1800)
})
