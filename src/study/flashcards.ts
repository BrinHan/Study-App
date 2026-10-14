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

