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

function promote(stage: LearnStage, answer: LearnAnswer): LearnStage {
  if (stage === 'mcq') return answer === 'mixed' ? 'written' : 'done'
  return 'done'
}

export function answerItem(s: LearnState, correct: boolean): LearnState {
  const id = s.roundIds[s.pos]
  if (!id) return s
  const stage = correct ? { ...s.stage, [id]: promote(s.stage[id], s.options.answer) } : s.stage
  return { ...s, stage, pos: s.pos + 1, roundResults: [...s.roundResults, { id, correct }] }
}

export function nextRound(s: LearnState): LearnState {
  const missed = s.roundResults.filter((r) => !r.correct).map((r) => r.id)
  return { ...s, round: s.round + 1, roundIds: pickRound(s, missed), pos: 0, roundResults: [] }
}

export const isFinished = (s: LearnState) => s.order.every((id) => s.stage[id] === 'done')

export function learnStats(s: LearnState) {
  return { done: s.order.filter((id) => s.stage[id] === 'done').length, total: s.order.length }
}

/** 0–1 across the session; a card that's past multiple choice but not yet typed counts half. */
export function learnProgress(s: LearnState): number {
  if (!s.order.length) return 0
  const credit = s.order.reduce((sum, id) => sum + (s.stage[id] === 'done' ? 1 : s.stage[id] !== s.initial[id] ? 0.5 : 0), 0)
  return credit / s.order.length
}

/** Drop cards that were deleted since the session was saved; null when none are left. */
export function pruneLearn(s: LearnState, ids: Set<string>): LearnState | null {
  const order = s.order.filter((id) => ids.has(id))
  if (!order.length) return null
  if (order.length === s.order.length) return s
  const roundResults = s.roundResults.filter((r) => ids.has(r.id))
  const roundIds = s.roundIds.filter((id) => ids.has(id))
  const pruned = { ...s, order, roundIds, roundResults, pos: roundResults.length }
  return roundIds.length || isFinished(pruned) ? pruned : nextRound(pruned)
}
