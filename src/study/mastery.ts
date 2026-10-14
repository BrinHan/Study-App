// Card mastery, shared by Learn, Flashcards and Test.
import type { CardProgress, MasteryState, StudyCard } from '../lib/types'

export const MASTERED_STREAK = 2

export const STATUS_LABEL: Record<MasteryState, string> = { new: 'Not studied', learning: 'Still learning', mastered: 'Mastered' }

export const newProgress = (): CardProgress => ({ state: 'new', streak: 0, seen: 0 })

export function applyAnswer(p: CardProgress, correct: boolean, now = Date.now()): CardProgress {
  const streak = correct ? p.streak + 1 : 0
  return { state: streak >= MASTERED_STREAK ? 'mastered' : 'learning', streak, seen: p.seen + 1, lastSeen: now }
}

/** The FSRS fields older versions stored on each card (State: 0 New, 1 Learning, 2 Review, 3 Relearning). */
export interface LegacyFsrs { state: number; scheduled_days: number; reps: number; last_review?: string | Date }

export function progressFromFsrs(f: LegacyFsrs): CardProgress {
  const lastSeen = f.last_review ? new Date(f.last_review).getTime() : undefined
  const base = { seen: f.reps, ...(lastSeen ? { lastSeen } : {}) }
  if (f.state === 0) return { state: 'new', streak: 0, ...base }
  if (f.state === 2 && f.scheduled_days >= 21) return { state: 'mastered', streak: MASTERED_STREAK, ...base }
  return { state: 'learning', streak: 0, ...base }
}

