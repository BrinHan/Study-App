// Test: a graded sheet of True/False, multiple-choice, matching and written questions.
import type { StudyCard } from '../lib/types'
import { checkTyped, normalize } from './answer'
import { choicesFor } from './options'
import { shuffled } from './random'

export type QType = 'tf' | 'mcq' | 'match' | 'written'
export const QTYPE_ORDER: QType[] = ['tf', 'mcq', 'match', 'written']
export interface TestOptions { count: number; types: QType[]; starredOnly: boolean }
export type TestQuestion =
  | { kind: 'tf'; id: string; cardId: string; statement: string; shown: string; isTrue: boolean }
  | { kind: 'mcq'; id: string; cardId: string; choices: string[] }
  | { kind: 'match'; id: string; cardIds: string[]; terms: string[] }
  | { kind: 'written'; id: string; cardId: string }
/** Answers by question id; a matching question maps each card id to the picked term. */
export type TestAnswers = Record<string, string | Record<string, string>>
export interface QResult { qid: string; cardId: string; kind: QType; given: string; correct: boolean; close?: boolean }

type Draft = TestQuestion extends infer Q ? (Q extends TestQuestion ? Omit<Q, 'id'> : never) : never

export const eligibleForTest = (cards: StudyCard[], starredOnly = false) =>
  cards.filter((c) => c.type !== 'compare' && (!starredOnly || c.starred))

/** Split cards into matching groups of 4–5 with distinct answers; the rest are returned as leftovers. */
function matchGroups(cards: StudyCard[]): { groups: StudyCard[][]; rest: StudyCard[] } {
  const max = Math.floor(cards.length / 4)
  if (!max) return { groups: [], rest: cards }
  const cap = Math.min(5, Math.ceil(cards.length / max))
  const groups: StudyCard[][] = Array.from({ length: max }, () => [])
  const rest: StudyCard[] = []
  for (const c of cards) {
    const g = groups.find((g) => g.length < cap && !g.some((x) => normalize(x.answer) === normalize(c.answer)))
    if (g) g.push(c)
    else rest.push(c)
  }
  for (const g of groups.filter((g) => g.length < 4)) rest.push(...g)
  return { groups: groups.filter((g) => g.length >= 4), rest }
}

function draftFor(kind: Exclude<QType, 'match'>, card: StudyCard, pool: StudyCard[], seed: string): Draft {
  if (kind === 'written') return { kind, cardId: card.id }
  const choices = choicesFor(card, pool, seed)
  if (!choices) return { kind: 'written', cardId: card.id }
  if (kind === 'mcq') return { kind, cardId: card.id, choices }
  const isTrue = shuffled([true, false], `${seed}:${card.id}`)[0]
  const shown = isTrue ? card.answer : choices.find((c) => c !== card.answer)!
  return { kind, cardId: card.id, statement: card.prompt.replace('_____', shown), shown, isTrue }
}

