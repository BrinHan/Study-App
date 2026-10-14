import { describe, expect, it } from 'vitest'
import { migrateCard, parseBackup } from './db'

const card = (extra: object) => ({ id: 'k:c1', kitId: 'k', type: 'cloze', prompt: 'The _____ makes ATP.', answer: 'mitochondria', hint: '', topic: 'Cells', ...extra })

describe('parseBackup', () => {
  it('converts v1 FSRS cards to mastery progress', () => {
    const v1 = { app: 'margin', version: 1, kits: [], cards: [card({ fsrs: { state: 2, scheduled_days: 30, reps: 4, due: '2026-11-01T00:00:00.000Z' }, introducedOn: '2026-10-01' })], settings: { newPerDay: 20 } }
    const b = parseBackup(JSON.stringify(v1))
    expect(b.cards[0].progress.state).toBe('mastered')
    expect(b.cards[0].progress.seen).toBe(4)
    expect('fsrs' in b.cards[0]).toBe(false)
    expect('introducedOn' in b.cards[0]).toBe(false)
    expect(b.settings).toEqual({ learnAnswer: 'mixed', roundSize: 7 })
  })

  it('keeps v2 cards as they are', () => {
    const progress = { state: 'learning', streak: 1, seen: 3, lastSeen: 5 }
    const b = parseBackup(JSON.stringify({ app: 'margin', version: 2, kits: [], cards: [card({ progress, starred: true })] }))
    expect(b.cards[0].progress).toEqual(progress)
    expect(b.cards[0].starred).toBe(true)
  })
})

describe('migrateCard', () => {
  it('gives a card with neither field a fresh progress', () => {
    expect(migrateCard(card({})).progress).toEqual({ state: 'new', streak: 0, seen: 0 })
  })
})
