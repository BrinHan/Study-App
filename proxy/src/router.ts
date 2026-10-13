import type { Config } from './config'
import { corsHeaders, errorResponse, json, readJsonBody } from './http'
import type { LimitResult } from './limits'
import { hashIp, signSession } from './session'
import { handleGenerate } from './generate'
import { handleClarify, handleTranscribe } from './scan'
import { verifyTurnstile } from './turnstile'

export interface LimiterLike { check(ipHash: string, nowMs: number): Promise<LimitResult> }
export interface CacheLike { get(key: string): Promise<unknown>; put(key: string, value: unknown): Promise<void> }
export interface Deps { config: Config; fetch: typeof fetch; limiter: LimiterLike; cache: CacheLike; now: () => number; ip: string }

type Route = (req: Request, deps: Deps, origin: string) => Promise<Response> | Response

async function session(req: Request, deps: Deps, origin: string): Promise<Response> {
  const { config } = deps
  // Fail closed: never sign with an empty key
  if (!config.turnstileSecret || !config.sessionSecret) return errorResponse('disabled', 503, origin)
  const body = await readJsonBody(req)
  if (!body.ok) return errorResponse(body.code, body.code === 'too-large' ? 413 : 400, origin)
  const token = (body.value as { turnstileToken?: unknown } | null)?.turnstileToken
  if (typeof token !== 'string' || token.length < 1 || token.length > 2048) return errorResponse('bad-request', 400, origin)
  if (!(await verifyTurnstile(config.turnstileSecret, token, deps.ip, deps.fetch))) return errorResponse('forbidden', 403, origin)
  const now = deps.now()
  const ipHash = await hashIp(config.sessionSecret, deps.ip)
  const signed = await signSession(config.sessionSecret, ipHash, now, config.sessionTtlSec)
  return json({ session: signed, expiresAt: now + config.sessionTtlSec * 1000 }, 200, origin)
}


const routes = new Map<string, Route>([['/session', session], ['/generate', handleGenerate], ['/transcribe', handleTranscribe], ['/clarify', handleClarify]])

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get('origin') ?? ''
  try {
    // No CORS headers for unknown origins
    if (!origin || !deps.config.allowedOrigins.includes(origin)) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
    }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
    if (!deps.config.enabled) return errorResponse('disabled', 503, origin)
    const route = req.method === 'POST' ? routes.get(new URL(req.url).pathname) : undefined
    if (!route) return errorResponse('not-found', 404, origin)
    return await route(req, deps, origin)
  } catch {
    console.error('upstream')
    return errorResponse('upstream', 502, origin)
  }
}
