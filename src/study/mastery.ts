// Card mastery, shared by Learn, Flashcards and Test.
import type { CardProgress, MasteryState, StudyCard } from '../lib/types'

export const MASTERED_STREAK = 2

export const STATUS_LABEL: Record<MasteryState, string> = { new: 'Not studied', learning: 'Still learning', mastered: 'Mastered' }

export const newProgress = (): CardProgress => ({ state: 'new', streak: 0, seen: 0 })

