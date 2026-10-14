// Learn: rounds of a few cards. Each card is asked as multiple choice, then typed (or one of them, per the
// answer option), and keeps coming back in later rounds until it's answered right at every stage.
import type { LearnAnswer, StudyCard } from '../lib/types'
import { choicesFor } from './options'
import { shuffled } from './random'

export type LearnStage = 'mcq' | 'written' | 'done'
export interface LearnOptions { answer: LearnAnswer; roundSize: number; starredOnly: boolean }
export interface LearnState {
  kitId: string
  seed: string
  options: LearnOptions
  order: string[]
  initial: Record<string, LearnStage> // to tell started cards from untouched ones
  stage: Record<string, LearnStage>
  round: number
  roundIds: string[]
  pos: number
  roundResults: { id: string; correct: boolean }[]
}
export interface LearnItem { id: string; format: 'mcq' | 'written'; choices?: string[] }

export function eligibleForLearn(cards: StudyCard[], starredOnly: boolean) {
  return cards.filter((c) => c.type !== 'compare' && (!starredOnly || c.starred))
}

const choiceSeed = (s: LearnState) => `${s.seed}:${s.round}`

/** Next round: last round's misses first, then cards already started, then new ones. */
function pickRound(s: LearnState, missed: string[]): string[] {
  const left = s.order.filter((id) => s.stage[id] !== 'done')
  const missedSet = new Set(missed)
  const rank = (id: string) => (missedSet.has(id) ? 0 : s.stage[id] !== s.initial[id] ? 1 : 2)
  return left
    .map((id, i) => ({ id, i, r: rank(id) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, s.options.roundSize)
    .map((x) => x.id)
}

