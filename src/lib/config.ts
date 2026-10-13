// Build-time AI settings. With either unset, or when offline, the app uses the classic generator.
const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

export const AI_PROXY_URL: string | undefined = clean(import.meta.env.VITE_AI_PROXY_URL)
export const TURNSTILE_SITEKEY: string | undefined = clean(import.meta.env.VITE_TURNSTILE_SITEKEY)

export function aiConfigured(env: { proxy?: string; sitekey?: string; online?: boolean } = {}): boolean {
  // An explicit `undefined` means "unset", so only fall back when the key is absent.
  const proxy = 'proxy' in env ? env.proxy : AI_PROXY_URL
  const sitekey = 'sitekey' in env ? env.sitekey : TURNSTILE_SITEKEY
  const online = env.online ?? (typeof navigator === 'undefined' || navigator.onLine)
  return !!proxy && !!sitekey && online
}
