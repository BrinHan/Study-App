import { describe, expect, it } from 'vitest'
import { answeredCount, buildTest, gradeTest, type TestQuestion } from './test'
import { normalize } from './answer'
import { makeCard, makeDeck } from './fixtures'

const ALL = ['tf', 'mcq', 'match', 'written'] as const
const byId = (cards: ReturnType<typeof makeDeck>) => new Map(cards.map((c) => [c.id, c]))
const size = (q: TestQuestion) => (q.kind === 'match' ? q.cardIds.length : 1)

describe('buildTest', () => {
  it('spreads the questions over every chosen type, in sheet order', () => {
    const deck = makeDeck(20)
    const qs = buildTest(deck, deck, { count: 20, types: [...ALL], starredOnly: false }, 's')
    expect(qs.reduce((n, q) => n + size(q), 0)).toBe(20)
    const kinds = qs.map((q) => q.kind)
    for (const k of ALL) expect(kinds).toContain(k)
    expect(kinds).toEqual([...kinds].sort((a, b) => ALL.indexOf(a) - ALL.indexOf(b)))
  })

  it('includes a matching group even in a short test', () => {
    const deck = makeDeck(20)
    for (const seed of ['s', 't', 'u']) {
      const qs = buildTest(deck, deck, { count: 10, types: [...ALL], starredOnly: false }, seed)
      expect(qs.map((q) => q.kind)).toContain('match')
      expect(new Set(qs.map((q) => q.kind)).size).toBe(4)
      expect(qs.reduce((n, q) => n + size(q), 0)).toBe(10)
    }
  })

  it('caps the count at the number of cards', () => {
    const deck = makeDeck(6)
    const qs = buildTest(deck, deck, { count: 20, types: ['mcq'], starredOnly: false }, 's')
    expect(qs).toHaveLength(6)
  })

  it('match groups have 4–5 pairs with distinct answers', () => {
    const deck = [...makeDeck(10), makeCard(50, 'mitochondria'), makeCard(51, 'Nucleus'), makeCard(52, 'ribosome')]
    const qs = buildTest(deck, deck, { count: 13, types: ['match', 'written'], starredOnly: false }, 's')
    const cards = byId(deck)
    const groups = qs.filter((q) => q.kind === 'match')
    expect(groups.length).toBeGreaterThan(0)
    for (const g of groups) {
      if (g.kind !== 'match') continue
      expect(g.cardIds.length).toBeGreaterThanOrEqual(4)
      expect(g.cardIds.length).toBeLessThanOrEqual(5)
      const terms = g.cardIds.map((id) => normalize(cards.get(id)!.answer))
      expect(new Set(terms).size).toBe(terms.length)
      expect([...g.terms].sort()).toEqual(g.cardIds.map((id) => cards.get(id)!.answer).sort())
    }
    expect(qs.reduce((n, q) => n + size(q), 0)).toBe(13)
  })

  it('makes both true and false statements', () => {
    const deck = makeDeck(12)
    const qs = buildTest(deck, deck, { count: 12, types: ['tf'], starredOnly: false }, 's')
    const values = new Set(qs.map((q) => q.kind === 'tf' && q.isTrue))
    expect(values).toEqual(new Set([true, false]))
    for (const q of qs) if (q.kind === 'tf') expect(q.statement).toContain(q.shown)
  })

  it('falls back to written when choices can’t be made, and skips compare cards', () => {
    const deck = [makeCard(1, 'ATP'), makeCard(2, 'DNA'), makeCard(3, 'RNA'), makeCard(4, 'a / b', { type: 'compare' })]
    const qs = buildTest(deck, deck, { count: 10, types: ['mcq', 'tf'], starredOnly: false }, 's')
    expect(qs.map((q) => q.kind)).toEqual(['written', 'written', 'written'])
  })

  it('a match type that can’t form a group hands its cards on', () => {
    const deck = makeDeck(3)
    const qs = buildTest(deck, deck, { count: 3, types: ['match'], starredOnly: false }, 's')
    expect(qs.map((q) => q.kind)).toEqual(['written', 'written', 'written'])
  })
})

describe('gradeTest', () => {
  const deck = makeDeck(8)
  const cards = byId(deck)
  const qs: TestQuestion[] = [
    { kind: 'tf', id: 'q0', cardId: 'k:c0', statement: '', shown: 'mitochondria', isTrue: true },
    { kind: 'mcq', id: 'q1', cardId: 'k:c1', choices: ['nucleus', 'ribosome', 'ATP', 'DNA'] },
    { kind: 'match', id: 'q2', cardIds: ['k:c2', 'k:c3'], terms: ['chloroplast', 'ribosome'] },
    { kind: 'written', id: 'q3', cardId: 'k:c4' },
    { kind: 'written', id: 'q4', cardId: 'k:c5' },
    { kind: 'written', id: 'q5', cardId: 'k:c6' },
  ]
  const answers = { q0: 'true', q1: 'nucleus', q2: { 'k:c2': 'chloroplast', 'k:c3': 'chloroplast' }, q3: 'golgi aparatus', q5: 'osmosis' }

  it('scores each answer, with typos allowed on written ones', () => {
    const g = gradeTest(qs, answers, cards)
    const r = Object.fromEntries(g.results.map((x) => [`${x.qid}|${x.cardId}`, x]))
    expect(r['q0|k:c0'].correct).toBe(true)
    expect(r['q1|k:c1'].correct).toBe(true)
    expect(r['q2|k:c2'].correct).toBe(false)
    expect(r['q2|k:c3'].correct).toBe(true)
    expect(r['q3|k:c4']).toMatchObject({ correct: true, close: true })
    expect(r['q4|k:c5']).toMatchObject({ correct: false, given: '' })
    expect(r['q5|k:c6'].correct).toBe(false)
    expect(g).toMatchObject({ score: 4, total: 7 })
  })

  it('an override marks a written answer right', () => {
    expect(gradeTest(qs, answers, cards, new Set(['q5|k:c6'])).score).toBe(5)
  })

  it('counts answered questions, one per matching pair', () => {
    expect(answeredCount(qs, answers)).toEqual({ answered: 6, total: 7 })
  })
})
