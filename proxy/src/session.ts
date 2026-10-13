const enc = new TextEncoder()

const b64u = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64u = (s: string): Uint8Array<ArrayBuffer> => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('b64')
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
const hmacKey = (secret: string) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

// One IPv6 user usually holds a whole /64, so limits count the prefix, not the address
function ipKey(ip: string): string {
  if (!ip.includes(':') || ip.includes('.')) return ip
  const [head, tail] = ip.toLowerCase().split('::')
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const all = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t]
  return all.slice(0, 4).map((x) => parseInt(x, 16).toString(16)).join(':')
}

export async function hashIp(secret: string, ip: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(secret + ':' + ipKey(ip)))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function signSession(secret: string, ipHash: string, nowMs: number, ttlSec: number): Promise<string> {
  const payload = b64u(enc.encode(JSON.stringify({ iph: ipHash, exp: nowMs + ttlSec * 1000 })))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload))
  return payload + '.' + b64u(new Uint8Array(sig))
}

export async function verifySession(secret: string, token: string, ipHash: string, nowMs: number): Promise<boolean> {
  try {
    const parts = token.split('.')
    if (parts.length !== 2) return false
    const [payload, sig] = parts
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64u(sig), enc.encode(payload)))) return false
    const { iph, exp } = JSON.parse(new TextDecoder().decode(fromB64u(payload)))
    return iph === ipHash && typeof exp === 'number' && nowMs <= exp
  } catch {
    return false
  }
}
