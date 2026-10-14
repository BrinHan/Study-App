import { describe, expect, it } from 'vitest'
import { atEnd, move, pruneFlash, restartWith, sortCard, startFlashcards, undo, type FlashOptions } from './flashcards'
import { makeCard, makeDeck } from './fixtures'

const opts = (o: Partial<FlashOptions> = {}): FlashOptions => ({ sort: true, front: 'prompt', starredOnly: false, shuffle: false, ...o })

describe('Flashcards', () => {
  it('keeps card order unless shuffled, and includes compare cards', () => {
    const deck = [...makeDeck(3), makeCard(9, 'a / b', { type: 'compare' })]
    expect(startFlashcards('k', deck, opts(), 's')!.deck).toEqual(['k:c0', 'k:c1', 'k:c2', 'k:c9'])
    const mixed = startFlashcards('k', makeDeck(12), opts({ shuffle: true }), 's')!
    expect(mixed.deck).not.toEqual(makeDeck(12).map((c) => c.id))
  })

  it('sorts cards into piles and moves on', () => {
    let s = startFlashcards('k', makeDeck(4), opts(), 's')!
    s = sortCard(s, 'know')
    s = sortCard(s, 'learning')
    expect(s.know).toEqual(['k:c0'])
    expect(s.learning).toEqual(['k:c1'])
    expect(s.index).toBe(2)
  })

  it('undo takes back the last sort', () => {
    let s = startFlashcards('k', makeDeck(4), opts(), 's')!
    s = sortCard(sortCard(s, 'know'), 'learning')
    s = undo(s)
    expect(s.index).toBe(1)
    expect(s.learning).toEqual([])
    expect(s.know).toEqual(['k:c0'])
    expect(undo(undo(s)).index).toBe(0)
  })

  it('reaches the end of the deck and restarts with the still-learning pile', () => {
    let s = startFlashcards('k', makeDeck(3), opts(), 's')!
    s = sortCard(sortCard(sortCard(s, 'learning'), 'know'), 'learning')
    expect(atEnd(s)).toBe(true)
    s = restartWith(s, 'learning', 's')
    expect(s.deck).toEqual(['k:c0', 'k:c2'])
    expect(s.know).toEqual([])
    expect(s.learning).toEqual([])
    expect(s.index).toBe(0)
  })

  it('move stays inside the deck', () => {
    let s = startFlashcards('k', makeDeck(2), opts({ sort: false }), 's')!
    s = move(s, -1)
    expect(s.index).toBe(0)
    s = move(move(move(s, 1), 1), 1)
    expect(s.index).toBe(2)
    expect(atEnd(s)).toBe(true)
  })

  it('can be limited to starred cards or a list of ids', () => {
    const deck = [makeCard(1, 'ATP', { starred: true }), makeCard(2, 'DNA')]
    expect(startFlashcards('k', deck, opts({ starredOnly: true }), 's')!.deck).toEqual(['k:c1'])
    expect(startFlashcards('k', deck, opts(), 's', ['k:c2'])!.deck).toEqual(['k:c2'])
    expect(startFlashcards('k', [deck[1]], opts({ starredOnly: true }), 's')).toBeNull()
  })

  it('pruneFlash drops deleted cards', () => {
    let s = startFlashcards('k', makeDeck(3), opts(), 's')!
    s = sortCard(s, 'know')
    const p = pruneFlash(s, new Set(['k:c1', 'k:c2']))!
    expect(p.deck).toEqual(['k:c1', 'k:c2'])
    expect(p.know).toEqual([])
    expect(p.index).toBe(0)
    expect(pruneFlash(s, new Set())).toBeNull()
  })
})
