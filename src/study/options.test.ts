import { describe, expect, it } from 'vitest'
import { choicesFor, distinctAnswers } from './options'
import { makeCard, makeDeck } from './fixtures'

describe('choicesFor', () => {
  it('uses the card’s own distractors when it has three', () => {
    const card = makeCard(1, 'mitochondria', { type: 'mcq', distractors: ['nucleus', 'ribosome', 'vacuole'] })
    expect([...choicesFor(card, [card], 's')!].sort()).toEqual(['mitochondria', 'nucleus', 'ribosome', 'vacuole'])
  })

  it('fills a cloze card from other answers in the kit', () => {
    const deck = makeDeck(5)
    const c = choicesFor(deck[0], deck, 's')!
    expect(c).toHaveLength(4)
    expect(c).toContain(deck[0].answer)
    expect(new Set(c).size).toBe(4)
  })

  it('returns null with fewer than 4 distinct answers', () => {
    const deck = [makeCard(1, 'ATP'), makeCard(2, 'atp'), makeCard(3, 'DNA'), makeCard(4, 'RNA')]
    expect(choicesFor(deck[2], deck, 's')).toBeNull()
  })

  it('never offers the same term twice, ignoring case', () => {
    const deck = [makeCard(1, 'ATP'), makeCard(2, 'atp'), makeCard(3, 'DNA'), makeCard(4, 'RNA'), makeCard(5, 'gene'), makeCard(6, 'Gene')]
    const c = choicesFor(deck[2], deck, 's')!
    expect(new Set(c.map((x) => x.toLowerCase())).size).toBe(4)
  })

  it('ignores compare cards as filler', () => {
    const deck = [...makeDeck(3), makeCard(9, 'nucleus / ribosome', { type: 'compare' })]
    expect(choicesFor(deck[0], deck, 's')).toBeNull()
  })
})

describe('distinctAnswers', () => {
  it('counts answers case-insensitively, skipping compare cards', () => {
    expect(distinctAnswers([makeCard(1, 'ATP'), makeCard(2, 'atp'), makeCard(3, 'DNA'), makeCard(4, 'a / b', { type: 'compare' })])).toBe(2)
  })
})
