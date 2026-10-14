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

