import { DurableObject } from 'cloudflare:workers'
import { readConfig, type Env } from './config'
import { checkAndCount, PRUNE_INTERVAL_MS, type CounterStore, type LimitResult } from './limits'

export class Limiter extends DurableObject<Env> {
  private lastPrune = -Infinity
  private store: CounterStore

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    const sql = ctx.storage.sql
    sql.exec('CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL, expires INTEGER NOT NULL)')
    this.store = {
      get: (key) => {
        const row = sql.exec<{ n: number }>('SELECT n FROM counters WHERE key = ?', key).toArray()[0]
        return row ? row.n : 0
      },
      incr: (key, expiresAtMs) => {
        sql.exec('INSERT INTO counters (key, n, expires) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET n = n + 1', key, expiresAtMs)
      },
      prune: (nowMs) => {
        if (nowMs - this.lastPrune < PRUNE_INTERVAL_MS) return
        this.lastPrune = nowMs
        sql.exec('DELETE FROM counters WHERE expires <= ?', nowMs)
      },
    }
  }

  // One call at a time per DO, so check-then-increment is atomic
  async check(ipHash: string, nowMs: number): Promise<LimitResult> {
    return checkAndCount(this.store, ipHash, nowMs, readConfig(this.env).limits)
  }
}
