// Gets an invisible Cloudflare Turnstile token. Never rejects: any failure or timeout gives null.
declare global {
  interface Window {
    turnstile?: {
      render(el: string, opts: Record<string, unknown>): string
      remove(id: string): void
    }
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptP: Promise<void> | null = null

function loadScript(): Promise<void> {
  scriptP ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { scriptP = null; reject(new Error('turnstile script failed')) }
    document.head.appendChild(s)
  })
  return scriptP
}

export function getTurnstileToken(siteKey: string, timeoutMs = 15000): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let widgetId: string | undefined
    let settled = false
    const finish = (token: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { if (widgetId !== undefined) window.turnstile?.remove(widgetId) } catch { /* already gone */ }
      resolve(token)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    loadScript()
      .then(() => {
        if (settled) return
        if (!document.getElementById('ts-mount')) {
          const d = document.createElement('div')
          d.id = 'ts-mount'
          document.body.appendChild(d)
        }
        widgetId = window.turnstile!.render('#ts-mount', {
          sitekey: siteKey,
          appearance: 'interaction-only',
          callback: (t: string) => finish(t),
          'error-callback': () => finish(null),
          'timeout-callback': () => finish(null),
        })
        if (settled) try { window.turnstile?.remove(widgetId) } catch { /* already gone */ } // callback fired during render
      })
      .catch(() => finish(null))
  })
}
