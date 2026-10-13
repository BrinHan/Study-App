import type { Limits } from './config'

export interface CounterStore { get(key: string): number; incr(key: string, expiresAtMs: number): void; prune(nowMs: number): void }
export type LimitResult = { ok: true } | { ok: false; reason: 'ip-hour' | 'ip-day' | 'global-minute' | 'global-day'; retryAfterSec: number }

const MINUTE = 60_000
const HOUR = 3600_000
const DAY = 86400_000
export const PRUNE_INTERVAL_MS = MINUTE

export class MemoryCounterStore implements CounterStore {
  private rows = new Map<string, { n: number; expires: number }>()
  private lastPrune = -Infinity
  get(key: string): number { return this.rows.get(key)?.n ?? 0 }
  incr(key: string, expiresAtMs: number): void {
    const row = this.rows.get(key)
    if (row) row.n++
    else this.rows.set(key, { n: 1, expires: expiresAtMs })
  }
  prune(nowMs: number): void {
    if (nowMs - this.lastPrune < PRUNE_INTERVAL_MS) return
    this.lastPrune = nowMs
    for (const [k, r] of this.rows) if (r.expires <= nowMs) this.rows.delete(k)
  }
}

// Fixed buckets; checked in this order, and nothing is counted unless every check passes
export function checkAndCount(store: CounterStore, ipHash: string, nowMs: number, limits: Limits): LimitResult {
  store.prune(nowMs)
  const bucket = (prefix: string, size: number) => {
    const idx = Math.floor(nowMs / size)
    return { key: `${prefix}:${idx}`, end: (idx + 1) * size }
  }
  const checks = [
    { ...bucket('g:d', DAY), max: limits.globalPerDay, reason: 'global-day' as const },
    { ...bucket('g:m', MINUTE), max: limits.globalPerMinute, reason: 'global-minute' as const },
    { ...bucket(`ip:${ipHash}:d`, DAY), max: limits.ipPerDay, reason: 'ip-day' as const },
    { ...bucket(`ip:${ipHash}:h`, HOUR), max: limits.ipPerHour, reason: 'ip-hour' as const },
  ]
  for (const c of checks) {
    if (store.get(c.key) >= c.max) return { ok: false, reason: c.reason, retryAfterSec: Math.ceil((c.end - nowMs) / 1000) }
  }
  for (const c of checks) store.incr(c.key, c.end)
  return { ok: true }
}
