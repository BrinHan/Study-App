import { describe, expect, it } from 'vitest'
import { checkTyped, levenshtein, normalize } from './answer'
import { shuffled } from './random'

describe('normalize', () => {
  it('drops case, punctuation and a leading article', () => {
    expect(normalize('  The Mitochondria. ')).toBe('mitochondria')
    expect(normalize('an ATP-synthase')).toBe('atp synthase')
  })
})

describe('checkTyped', () => {
  it('accepts an exact match after normalising', () => {
    expect(checkTyped('mitochondria', 'Mitochondria')).toBe('exact')
    expect(checkTyped('The mitochondria.', 'mitochondria')).toBe('exact')
  })
  it('allows 2 typos on longer answers and 1 on short ones', () => {
    expect(checkTyped('plasma membrain', 'plasma membrane')).toBe('close')
    expect(checkTyped('ATQ', 'ATP')).toBe('close')
    expect(checkTyped('ARQ', 'ATP')).toBe('wrong')
  })
  it('treats an empty answer as wrong', () => {
    expect(checkTyped('', 'ATP')).toBe('wrong')
    expect(checkTyped('  ', 'ATP')).toBe('wrong')
  })
  it('levenshtein counts edits', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('', 'abc')).toBe(3)
  })
})

describe('shuffled', () => {
  it('is deterministic for a seed and keeps every item', () => {
    const a = shuffled([1, 2, 3, 4], 's')
    expect(shuffled([1, 2, 3, 4], 's')).toEqual(a)
    expect([...a].sort()).toEqual([1, 2, 3, 4])
  })
})
