import { expect, test } from 'vitest'
import { checkAndCount, MemoryCounterStore } from '../src/limits'

const L = { ipPerHour: 2, ipPerDay: 3, globalPerMinute: 5, globalPerDay: 6 }
const H = 3600_000

test('allows up to ipPerHour then blocks with ip-hour and a retry time', () => {
  const s = new MemoryCounterStore(); const t = 10 * H
  expect(checkAndCount(s, 'a', t, L).ok).toBe(true); expect(checkAndCount(s, 'a', t, L).ok).toBe(true)
  expect(checkAndCount(s, 'a', t + 1000, L)).toEqual({ ok: false, reason: 'ip-hour', retryAfterSec: 3599 })
})

test('next hour allows again until ipPerDay', () => {
  const s = new MemoryCounterStore()
  expect(checkAndCount(s, 'a', 10 * H, L).ok).toBe(true); expect(checkAndCount(s, 'a', 10 * H, L).ok).toBe(true)
  expect(checkAndCount(s, 'a', 11 * H, L).ok).toBe(true)
  expect(checkAndCount(s, 'a', 11 * H, L)).toEqual({ ok: false, reason: 'ip-day', retryAfterSec: 13 * 3600 })
})

test('global minute budget is shared across IPs', () => {
  const s = new MemoryCounterStore(); const t = 10 * H
  for (const ip of ['a', 'b', 'c', 'd', 'e']) expect(checkAndCount(s, ip, t, L).ok).toBe(true)
  expect(checkAndCount(s, 'f', t, L)).toEqual({ ok: false, reason: 'global-minute', retryAfterSec: 60 })
})

test('global day budget blocks everyone', () => {
  const s = new MemoryCounterStore()
  for (let i = 0; i < 6; i++) expect(checkAndCount(s, `ip${i}`, i * 60_000, L).ok).toBe(true)
  expect(checkAndCount(s, 'fresh', 7 * 60_000, L)).toEqual({ ok: false, reason: 'global-day', retryAfterSec: 86400 - 7 * 60 })
})

test('a blocked request does not consume any counter', () => {
  const s = new MemoryCounterStore(); const t = 10 * H
  checkAndCount(s, 'a', t, L); checkAndCount(s, 'a', t, L)
  expect(checkAndCount(s, 'a', t, L).ok).toBe(false)
  for (const ip of ['b', 'c', 'd']) expect(checkAndCount(s, ip, t, L).ok).toBe(true)
  expect(checkAndCount(s, 'e', t, L)).toMatchObject({ ok: false, reason: 'global-minute' })
})
