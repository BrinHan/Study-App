import type { ProxyErrorCode } from '../../shared/quiz'

export const MAX_BODY_BYTES = 65536 // /session, /generate, /clarify
export const MAX_IMAGE_BODY_BYTES = 2_000_000 // /transcribe

export function corsHeaders(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export function json(body: unknown, status: number, origin: string, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', ...extra },
  })
}

export function errorResponse(code: ProxyErrorCode, status: number, origin: string, retryAfterSec?: number): Response {
  return json({ error: code }, status, origin, retryAfterSec === undefined ? {} : { 'Retry-After': String(retryAfterSec) })
}

// Measures the real UTF-8 size; Content-Length is never trusted
export async function readJsonBody(req: Request, maxBytes = MAX_BODY_BYTES): Promise<{ ok: true; value: unknown } | { ok: false; code: 'too-large' | 'bad-request' }> {
  const text = await req.text()
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, code: 'too-large' }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, code: 'bad-request' }
  }
}
