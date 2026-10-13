import { expect, test, vi } from 'vitest'
import { hashIp, signSession, verifySession } from '../src/session'
import { verifyTurnstile } from '../src/turnstile'
import { sha256hex } from '../src/guard'
import { handle, type Deps } from '../src/router'
import { readConfig, type Env } from '../src/config'

const env = { ENABLED: 'true', ALLOWED_ORIGINS: 'https://brinhan.github.io', GEMINI_MODEL: 'm', IP_PER_HOUR: '40', IP_PER_DAY: '120', GLOBAL_PER_MINUTE: '8', GLOBAL_PER_DAY: '800', SESSION_TTL_SEC: '600', GEMINI_API_KEY: 'k', TURNSTILE_SECRET: 't', SESSION_SECRET: 's' }
const ORIGIN = 'https://brinhan.github.io'

function deps(over: Partial<Deps> = {}, cfg: Record<string, unknown> = {}): Deps {
  const config = { ...readConfig(env as Env), allowedOrigins: [ORIGIN], ...cfg }
  return { config, fetch, limiter: { check: async () => ({ ok: true }) }, cache: { get: async () => undefined, put: async () => {} }, now: () => 5_000, ip: '1.2.3.4', ...over }
}
const post = (path: string, body: unknown) => new Request('https://p' + path, { method: 'POST', headers: { origin: ORIGIN }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const ok = () => vi.fn(async () => Response.json({ success: true }))

test('session round-trips for the same IP and fails for another IP', async () => {
  const t = await signSession('k', 'ipA', 1_000, 600)
  expect(await verifySession('k', t, 'ipA', 2_000)).toBe(true)
  expect(await verifySession('k', t, 'ipB', 2_000)).toBe(false)
})
test('session expires after ttl', async () => { const t = await signSession('k', 'ipA', 0, 600); expect(await verifySession('k', t, 'ipA', 600_001)).toBe(false) })
test('tampered payload, wrong secret or garbage fail', async () => {
  const t = await signSession('k', 'ipA', 0, 600); const [p, s] = t.split('.')
  expect(await verifySession('k', p.slice(0, -1) + 'A' + '.' + s, 'ipA', 1)).toBe(false)
  expect(await verifySession('other', t, 'ipA', 1)).toBe(false)
  expect(await verifySession('k', 'not-a-token', 'ipA', 1)).toBe(false)
  expect(await verifySession('k', '%%%.%%%', 'ipA', 1)).toBe(false)
})
test('token is unpadded base64url', async () => {
  const t = await signSession('k', 'ipA', 0, 600)
  expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
})
test('hashIp is a stable hex SHA-256 that depends on the secret', async () => {
  const a = await hashIp('s', '1.2.3.4')
  expect(a).toMatch(/^[0-9a-f]{64}$/)
  expect(a).toBe(await hashIp('s', '1.2.3.4'))
  expect(a).not.toBe(await hashIp('s2', '1.2.3.4'))
})
test('hashIp leaves IPv4 unchanged', async () => {
  expect(await hashIp('s', '1.2.3.4')).toBe(await sha256hex('s:1.2.3.4'))
})
test('hashIp groups IPv6 addresses by /64', async () => {
  const a = await hashIp('s', '2001:db8:1:2:aaaa::1')
  expect(a).toBe(await hashIp('s', '2001:db8:1:2:bbbb::2'))
  expect(a).toBe(await hashIp('s', '2001:0DB8:0001:0002:cccc:dddd:eeee:ffff'))
  expect(a).toBe(await sha256hex('s:2001:db8:1:2'))
  expect(a).not.toBe(await hashIp('s', '2001:db8:1:3:aaaa::1'))
  expect(await hashIp('s', '::1')).toBe(await sha256hex('s:0:0:0:0'))
  expect(await hashIp('s', '2001:db8::')).toBe(await sha256hex('s:2001:db8:0:0'))
})
test('verifyTurnstile posts secret, response and remoteip as form data and reads success', async () => {
  const f = vi.fn(async () => Response.json({ success: true }))
  expect(await verifyTurnstile('sec', 'tok', '1.2.3.4', f as any)).toBe(true)
  const [url, init] = f.mock.calls[0] as any
  expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
  expect(Object.fromEntries(init.body as FormData)).toEqual({ secret: 'sec', response: 'tok', remoteip: '1.2.3.4' })
})
test('verifyTurnstile returns false on network error or success:false', async () => {
  expect(await verifyTurnstile('s', 't', 'i', (async () => { throw new Error('x') }) as any)).toBe(false)
  expect(await verifyTurnstile('s', 't', 'i', (async () => Response.json({ success: false })) as any)).toBe(false)
})
test('verifyTurnstile gives up after 5 seconds', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout')
  // a fetch that only ends when its signal aborts
  const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => {
    init.signal!.addEventListener('abort', () => rej(init.signal!.reason))
  }))
  const ctl = new AbortController()
  timeout.mockReturnValue(ctl.signal)
  const p = verifyTurnstile('s', 't', 'i', f as any)
  expect(timeout).toHaveBeenCalledWith(5000)
  ctl.abort(new DOMException('timed out', 'TimeoutError'))
  expect(await p).toBe(false)
  timeout.mockRestore()
})
test('POST /session returns an IP-bound session when Turnstile passes', async () => {
  const d = deps({ fetch: ok() as any })
  const r = await handle(post('/session', { turnstileToken: 'tok' }), d)
  expect(r.status).toBe(200)
  const b = await r.json() as { session: string; expiresAt: number }
  expect(b.expiresAt).toBe(5_000 + 600_000)
  const iph = await hashIp('s', '1.2.3.4')
  expect(await verifySession('s', b.session, iph, 6_000)).toBe(true)
  expect(await verifySession('s', b.session, await hashIp('s', '9.9.9.9'), 6_000)).toBe(false)
})
test('POST /session returns 403 forbidden when Turnstile fails', async () => {
  const f = vi.fn(async () => Response.json({ success: false }))
  const r = await handle(post('/session', { turnstileToken: 'tok' }), deps({ fetch: f as any }))
  expect(r.status).toBe(403); expect(await r.json()).toEqual({ error: 'forbidden' })
})
test('POST /session validates the body', async () => {
  const f = ok()
  const d = deps({ fetch: f as any })
  for (const body of [{}, { turnstileToken: 1 }, { turnstileToken: '' }, { turnstileToken: 'x'.repeat(2049) }, null, 'nope{']) {
    const r = await handle(post('/session', typeof body === 'string' ? body : body), d)
    expect(r.status).toBe(400); expect(await r.json()).toEqual({ error: 'bad-request' })
  }
  expect(f).not.toHaveBeenCalled()
  const big = await handle(post('/session', 'x'.repeat(65537)), d)
  expect(big.status).toBe(413)
})
test('/session fails closed with 503 disabled when a secret is missing', async () => {
  for (const cfg of [{ sessionSecret: '' }, { sessionSecret: undefined }, { turnstileSecret: '' }, { turnstileSecret: undefined }]) {
    const f = ok()
    const r = await handle(post('/session', { turnstileToken: 'tok' }), deps({ fetch: f as any }, cfg))
    expect(r.status).toBe(503); expect(await r.json()).toEqual({ error: 'disabled' })
    expect(f).not.toHaveBeenCalled()
  }
})
test('prototype property paths return 404', async () => {
  for (const p of ['/constructor', '/__proto__', '/toString']) expect((await handle(post(p, {}), deps())).status).toBe(404)
})
