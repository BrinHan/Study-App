import { errorResponse } from './http'
import type { Deps } from './router'
import { hashIp, verifySession } from './session'

export async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Fail closed on empty secrets, then verify the session bound to this IP. Returns the IP hash or an error response.
export async function authenticate(req: Request, deps: Deps, origin: string): Promise<{ ipHash: string } | Response> {
  const { config } = deps
  if (!config.geminiKey || !config.sessionSecret) return errorResponse('disabled', 503, origin)
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const ipHash = await hashIp(config.sessionSecret, deps.ip)
  if (!token || !(await verifySession(config.sessionSecret, token, ipHash, deps.now()))) return errorResponse('session', 401, origin)
  return { ipHash }
}

// Returns an error response when the limiter blocks, otherwise null
export async function limited(deps: Deps, ipHash: string, origin: string): Promise<Response | null> {
  const lim = await deps.limiter.check(ipHash, deps.now())
  if (lim.ok) return null
  if (lim.reason.startsWith('ip-')) return errorResponse('rate-limited', 429, origin, lim.retryAfterSec)
  // the minute bucket refills soon, so clients wait and retry
  return errorResponse(lim.reason === 'global-minute' ? 'busy' : 'budget', 503, origin, lim.retryAfterSec)
}
