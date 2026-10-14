import { describe, expect, it } from 'vitest'
import { answerItem, currentItem, isFinished, learnProgress, learnStats, nextRound, pruneLearn, startLearn, type LearnOptions, type LearnState } from './learn'
import { makeCard, makeDeck } from './fixtures'

const opts = (o: Partial<LearnOptions> = {}): LearnOptions => ({ answer: 'mixed', roundSize: 7, starredOnly: false, ...o })

/** Answer every item left in the round with `correct(id)`. */
function playRound(s: LearnState, pool: ReturnType<typeof makeDeck>, correct: (id: string) => boolean) {
  let item = currentItem(s, pool)
  while (item) {
    s = answerItem(s, correct(item.id))
    item = currentItem(s, pool)
  }
  return s
}

describe('Learn', () => {
  it('starts with a round of at most roundSize cards', () => {
    const deck = makeDeck(10)
    const s = startLearn('k', deck, deck, opts(), 'seed')!
    expect(s.roundIds).toHaveLength(7)
    expect(currentItem(s, deck)!.format).toBe('mcq')
    expect(currentItem(s, deck)!.choices).toHaveLength(4)
  })

  it('mixed: multiple choice, then typed, then done', () => {
    const deck = makeDeck(5)
    let s = startLearn('k', deck, deck, opts({ roundSize: 1 }), 'seed')!
    const id = s.roundIds[0]
    s = answerItem(s, true)
    expect(s.stage[id]).toBe('written')
    expect(currentItem(s, deck)).toBeNull()
    s = nextRound(s)
    expect(s.roundIds[0]).toBe(id) // started cards come first
    expect(currentItem(s, deck)!.format).toBe('written')
    s = answerItem(s, true)
    expect(s.stage[id]).toBe('done')
  })

  it('mcq only: one right answer finishes a card', () => {
    const deck = makeDeck(5)
    let s = startLearn('k', deck, deck, opts({ answer: 'mcq', roundSize: 1 }), 'seed')!
    const id = s.roundIds[0]
    s = answerItem(s, true)
    expect(s.stage[id]).toBe('done')
  })

  it('written only starts typed', () => {
    const deck = makeDeck(5)
    const s = startLearn('k', deck, deck, opts({ answer: 'written' }), 'seed')!
    expect(currentItem(s, deck)!.format).toBe('written')
  })

  it('a wrong answer keeps the stage and the card comes back first next round', () => {
    const deck = makeDeck(10)
    let s = startLearn('k', deck, deck, opts({ roundSize: 3 }), 'seed')!
    const missed = s.roundIds[2]
    s = playRound(s, deck, (id) => id !== missed)
    expect(s.stage[missed]).toBe('mcq')
    s = nextRound(s)
    expect(s.round).toBe(2)
    expect(s.roundIds[0]).toBe(missed)
  })

  it('progress gives half credit for a card past its multiple-choice step', () => {
    const deck = makeDeck(4)
    let s = startLearn('k', deck, deck, opts({ roundSize: 4 }), 'seed')!
    expect(learnProgress(s)).toBe(0)
    s = answerItem(s, true)
    expect(learnProgress(s)).toBe(0.125)
    const written = startLearn('k', deck, deck, opts({ answer: 'written', roundSize: 4 }), 'seed')!
    expect(learnProgress(answerItem(written, true))).toBe(0.25)
  })

  it('finishes once every card is done', () => {
    const deck = makeDeck(6)
    let s = startLearn('k', deck, deck, opts({ roundSize: 4 }), 'seed')!
    for (let i = 0; i < 10 && !isFinished(s); i++) {
      s = playRound(s, deck, () => true)
      if (!isFinished(s)) s = nextRound(s)
    }
    expect(isFinished(s)).toBe(true)
    expect(learnStats(s)).toEqual({ done: 6, total: 6 })
  })

  it('mixed skips the multiple-choice stage when no choices can be made', () => {
    const deck = [makeCard(1, 'ATP'), makeCard(2, 'DNA'), makeCard(3, 'RNA')]
    const s = startLearn('k', deck, deck, opts(), 'seed')!
    expect(currentItem(s, deck)!.format).toBe('written')
  })

  it('leaves out compare cards, and returns null when nothing is left', () => {
    const deck = [...makeDeck(4), makeCard(9, 'a / b', { type: 'compare' })]
    expect(startLearn('k', deck, deck, opts(), 'seed')!.order).not.toContain('k:c9')
    expect(startLearn('k', deck, deck, opts({ starredOnly: true }), 'seed')).toBeNull()
  })

  it('pruneLearn drops cards that no longer exist', () => {
    const deck = makeDeck(8)
    let s = startLearn('k', deck, deck, opts({ roundSize: 4 }), 'seed')!
    s = answerItem(s, true)
    const gone = s.roundIds[0]
    const kept = new Set(deck.map((c) => c.id).filter((id) => id !== gone))
    const p = pruneLearn(s, kept)!
    expect(p.order).not.toContain(gone)
    expect(p.roundIds).not.toContain(gone)
    expect(p.pos).toBe(0)
    expect(pruneLearn(s, new Set())).toBeNull()
  })
})
