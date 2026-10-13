import { ProxyError } from './proxyClient'

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Errors that stop starting new items; any other error only loses the item it hit. */
const STOP = new Set<string>(['budget', 'rate-limited', 'session', 'disabled', 'forbidden'])
const BUSY_RETRIES = 3

export type Stop = { stopped: boolean; code?: string }

/** Runs fn over items with at most `concurrency` in flight; fn must not throw. */
export async function runPool<T>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
}

/**
 * Calls fn. `busy` waits Retry-After (default 5 s, at most 60 s) and retries up to 3 times;
 * `upstream` and `network` wait delayMs and retry once. A STOP error sets stop.stopped.
 */
export async function callWithRetry<T>(fn: () => Promise<T>, delayMs: number, stop: Stop, wait: (ms: number) => Promise<void> = sleep): Promise<T> {
  let busy = 0
  let other = 0
  for (;;) {
    try {
      return await fn()
    } catch (e) {
      const code = e instanceof ProxyError ? e.code : undefined
      if (code && STOP.has(code) && !stop.stopped) { stop.stopped = true; stop.code = code }
      if (stop.stopped) throw e
      if (code === 'busy' && busy++ < BUSY_RETRIES) await wait(Math.min((e as ProxyError).retryAfterSec ?? 5, 60) * 1000)
      else if ((code === 'upstream' || code === 'network') && other++ < 1) await wait(delayMs)
      else throw e
      if (stop.stopped) throw e
    }
  }
}
