import type { Card as FsrsCard } from 'ts-fsrs'

export type KitStatus = 'building' | 'ready'

export interface SummaryPoint {
  sentenceId: string
  text: string
  page?: number
  paragraph: number
}

export interface Kit {
  id: string
  title: string
  sourceType: 'pdf' | 'paste'
  fileName?: string
  pageCount?: number
  createdAt: number
  examDate?: string // yyyy-mm-dd
  notes?: string
  status: KitStatus
  quizEnabled: boolean
  quizReason?: string // why the quiz is off, shown on the kit page
  summary: SummaryPoint[]
  sentenceCount: number
  transcript?: string // AI-read text of photos and scanned pages, kept for a later viewer and editor
}

export interface Sentence {
  id: string
  kitId: string
  text: string
  page?: number
  paragraph: number // 1-based, counted across the whole source
  index: number // order in the source
  topic: string
}

export type CardType = 'cloze' | 'mcq' | 'compare'

export interface DistractorSource {
  term: string
  sentenceId: string
}

export interface StudyCard {
  id: string
  kitId: string
  type: CardType
  prompt: string
  answer: string
  distractors?: string[]
  distractorSources?: DistractorSource[]
  explanation?: string // why the answer is right
  distractorExplanations?: string[] // aligned index-for-index with distractors
  sourceSentenceId?: string
  extraSourceIds?: string[] // compare cards cite both terms
  hint: string
  topic: string
  fsrs: FsrsCard
  introducedOn?: string // yyyy-mm-dd of first review, for the new-cards-per-day limit
}

export interface Review {
  id: string
  cardId: string
  kitId: string
  topic: string
  rating: 1 | 2 | 3 | 4
  pickedAnswer?: string
  correct: boolean
  reviewedAt: number
}

export interface Confusion {
  id: string // `${kitId}|${termA}|${termB}`
  kitId: string
  termA: string // the right answer
  termB: string // what the user picked instead
  count: number
  compareCardId?: string
}

export interface StoredFile {
  kitId: string
  name: string
  size: number
  blob: Blob
}

export interface Settings {
  newPerDay: number
}

export const DEFAULT_SETTINGS: Settings = { newPerDay: 20 }
