import { describe, expect, it } from 'vitest'
import { applyAnswer, kitMastery, newProgress, progressFromFsrs } from './mastery'
import type { StudyCard } from '../lib/types'

describe('applyAnswer', () => {
  it('masters a card after two correct answers in a row', () => {
    const once = applyAnswer(newProgress(), true, 1000)
    expect(once).toEqual({ state: 'learning', streak: 1, seen: 1, lastSeen: 1000 })
    const twice = applyAnswer(once, true, 2000)
    expect(twice.state).toBe('mastered')
    expect(twice.streak).toBe(2)
  })
  it('a wrong answer resets the streak, even on a mastered card', () => {
    const p = applyAnswer({ state: 'mastered', streak: 4, seen: 6 }, false)
    expect(p.state).toBe('learning')
    expect(p.streak).toBe(0)
    expect(p.seen).toBe(7)
  })
})

describe('progressFromFsrs', () => {
  it('maps a new FSRS card to not studied', () => {
    expect(progressFromFsrs({ state: 0, scheduled_days: 0, reps: 0 }).state).toBe('new')
  })
  it('maps a review card 21+ days out to mastered', () => {
    const p = progressFromFsrs({ state: 2, scheduled_days: 21, reps: 5, last_review: '2026-01-02T00:00:00.000Z' })
    expect(p).toEqual({ state: 'mastered', streak: 2, seen: 5, lastSeen: Date.parse('2026-01-02T00:00:00.000Z') })
  })
  it('maps shorter reviews and relearning to still learning', () => {
    expect(progressFromFsrs({ state: 2, scheduled_days: 20, reps: 5 }).state).toBe('learning')
    expect(progressFromFsrs({ state: 3, scheduled_days: 40, reps: 9 }).state).toBe('learning')
    expect(progressFromFsrs({ state: 1, scheduled_days: 0, reps: 1 }).streak).toBe(0)
  })
})

describe('kitMastery', () => {
  it('counts cards per state', () => {
    const card = (state: 'new' | 'learning' | 'mastered') => ({ progress: { state, streak: 0, seen: 0 } }) as StudyCard
    expect(kitMastery([card('new'), card('mastered'), card('mastered'), card('learning')]))
      .toEqual({ new: 1, learning: 1, mastered: 2, total: 4 })
  })
})
