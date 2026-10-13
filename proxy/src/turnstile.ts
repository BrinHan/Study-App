const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

// Any network, HTTP, parse or timeout failure counts as a failed check
export async function verifyTurnstile(secret: string, token: string, ip: string, fetchFn: typeof fetch): Promise<boolean> {
  try {
    const body = new FormData()
    body.append('secret', secret)
    body.append('response', token)
    body.append('remoteip', ip)
    const res = await fetchFn(SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(5000) })
    if (!res.ok) return false
    return ((await res.json()) as { success?: unknown }).success === true
  } catch {
    return false
  }
}
