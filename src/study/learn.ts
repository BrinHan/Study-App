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

export function startLearn(kitId: string, cards: StudyCard[], pool: StudyCard[], options: LearnOptions, seed: string): LearnState | null {
  const eligible = eligibleForLearn(cards, options.starredOnly)
  if (!eligible.length) return null
  const initial: Record<string, LearnStage> = {}
  for (const c of eligible) {
    initial[c.id] = options.answer === 'written' || !choicesFor(c, pool, seed) ? 'written' : 'mcq'
  }
  const s: LearnState = {
    kitId, seed, options, order: shuffled(eligible.map((c) => c.id), seed), initial, stage: { ...initial },
    round: 1, roundIds: [], pos: 0, roundResults: [],
  }
  return { ...s, roundIds: pickRound(s, []) }
}

/** The question to ask now, or null when the round (or the whole session) is over. */
export function currentItem(s: LearnState, pool: StudyCard[]): LearnItem | null {
  const id = s.roundIds[s.pos]
  if (!id) return null
  const stage = s.stage[id]
  if (stage === 'mcq') {
    const card = pool.find((c) => c.id === id)
    const choices = card && choicesFor(card, pool, choiceSeed(s))
    if (choices) return { id, format: 'mcq', choices }
  }
  return { id, format: 'written' }
}

