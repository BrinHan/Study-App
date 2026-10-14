// Flashcards: flip through a deck, optionally sorting each card into Know / Still learning.
import type { StudyCard } from '../lib/types'
import { shuffled } from './random'

export type Pile = 'know' | 'learning'
export interface FlashOptions { sort: boolean; front: 'prompt' | 'answer'; starredOnly: boolean; shuffle: boolean }
export interface FlashState {
  kitId: string
  options: FlashOptions
  deck: string[]
  index: number // deck.length = end of deck
  know: string[]
  learning: string[]
  history: Pile[] // the pile each sorted card went to, for undo
}

export function startFlashcards(kitId: string, cards: StudyCard[], options: FlashOptions, seed: string, only?: string[]): FlashState | null {
  const keep = only && new Set(only)
  const ids = cards.filter((c) => (!keep || keep.has(c.id)) && (!options.starredOnly || c.starred)).map((c) => c.id)
  if (!ids.length) return null
  return { kitId, options, deck: options.shuffle ? shuffled(ids, seed) : ids, index: 0, know: [], learning: [], history: [] }
}

export const atEnd = (s: FlashState) => s.index >= s.deck.length

export function move(s: FlashState, delta: 1 | -1): FlashState {
  return { ...s, index: Math.min(s.deck.length, Math.max(0, s.index + delta)) }
}

export function sortCard(s: FlashState, pile: Pile): FlashState {
  const id = s.deck[s.index]
  if (!id) return s
  return { ...s, [pile]: [...s[pile], id], index: s.index + 1, history: [...s.history, pile] }
}

export function undo(s: FlashState): FlashState {
  const pile = s.history.at(-1)
  if (!pile || s.index === 0) return s
  return { ...s, [pile]: s[pile].slice(0, -1), index: s.index - 1, history: s.history.slice(0, -1) }
}

export function restartWith(s: FlashState, which: 'learning' | 'all', seed: string): FlashState {
  const ids = which === 'learning' && s.learning.length ? s.learning : s.deck
  return { ...s, deck: s.options.shuffle ? shuffled(ids, seed) : ids, index: 0, know: [], learning: [], history: [] }
}

/** Drop cards that were deleted since the session was saved; null when none are left. */
export function pruneFlash(s: FlashState, ids: Set<string>): FlashState | null {
  const deck = s.deck.filter((id) => ids.has(id))
  if (!deck.length) return null
  if (deck.length === s.deck.length) return s
  const index = s.deck.slice(0, s.index).filter((id) => ids.has(id)).length
  return { ...s, deck, index, know: s.know.filter((id) => ids.has(id)), learning: s.learning.filter((id) => ids.has(id)), history: [] }
}
