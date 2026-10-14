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
  progress: CardProgress
  starred?: boolean
}

export type MasteryState = 'new' | 'learning' | 'mastered'

/** Shared by every study mode: two correct answers in a row = mastered, a wrong answer resets. */
export interface CardProgress {
  state: MasteryState
  streak: number
  seen: number
  lastSeen?: number
}

export type StudyMode = 'learn' | 'flashcards' | 'test'
export type AnswerFormat = 'mcq' | 'written' | 'tf' | 'match' | 'flip'

export interface Review {
  id: string
  cardId: string
  kitId: string
  topic: string
  rating?: 1 | 2 | 3 | 4 // only on answers from the old FSRS review
  mode?: StudyMode
  format?: AnswerFormat
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

export type LearnAnswer = 'mixed' | 'mcq' | 'written'

export interface Settings {
  learnAnswer: LearnAnswer
  roundSize: number
}

export const DEFAULT_SETTINGS: Settings = { learnAnswer: 'mixed', roundSize: 7 }

/** An unfinished Learn or Flashcards session, saved so it can be resumed from Home. */
export interface StudySession {
  id: string // `${kitId}|${mode}`
  kitId: string
  mode: 'learn' | 'flashcards'
  state: unknown
  updatedAt: number
}
