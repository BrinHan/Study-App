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

