export interface Env { ENABLED: string; ALLOWED_ORIGINS: string; GEMINI_MODEL: string; IP_PER_HOUR: string; IP_PER_DAY: string; GLOBAL_PER_MINUTE: string; GLOBAL_PER_DAY: string; SESSION_TTL_SEC: string; GEMINI_API_KEY: string; TURNSTILE_SECRET: string; SESSION_SECRET: string; LIMITER: DurableObjectNamespace }
export interface Limits { ipPerHour: number; ipPerDay: number; globalPerMinute: number; globalPerDay: number }
export interface Config { enabled: boolean; allowedOrigins: string[]; model: string; limits: Limits; sessionTtlSec: number; geminiKey: string; turnstileSecret: string; sessionSecret: string }

// Non-numeric, non-positive or fractional values fall back to the default
function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return raw && Number.isInteger(n) && n > 0 ? n : fallback
}

export function readConfig(env: Env): Config {
  return {
    enabled: env.ENABLED === 'true',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    model: env.GEMINI_MODEL || 'gemini-2.5-flash',
    limits: {
      ipPerHour: positive(env.IP_PER_HOUR, 40),
      ipPerDay: positive(env.IP_PER_DAY, 120),
      globalPerMinute: positive(env.GLOBAL_PER_MINUTE, 8),
      globalPerDay: positive(env.GLOBAL_PER_DAY, 800),
    },
    sessionTtlSec: positive(env.SESSION_TTL_SEC, 1800),
    geminiKey: env.GEMINI_API_KEY,
    turnstileSecret: env.TURNSTILE_SECRET,
    sessionSecret: env.SESSION_SECRET,
  }
}
