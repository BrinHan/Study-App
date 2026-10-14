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

/**
 * Cards per type, in `types` order: an even split with remainders to the earliest types, except that
 * matching gets at least 4 (one group) when there are enough cards to leave one for every other type.
 */
function splitQuotas(n: number, types: QType[]): number[] {
  const m = types.indexOf('match')
  const others = types.length - 1
  const even = (count: number, k: number) => Array.from({ length: k }, (_, i) => Math.floor(count / k) + (i < count % k ? 1 : 0))
  if (m < 0 || Math.floor(n / types.length) >= 4 || n < 4 + others) return even(n, types.length)
  const rest = even(n - 4, others)
  return types.map((_, i) => (i === m ? 4 : rest[i < m ? i : i - 1]))
}

export function buildTest(cards: StudyCard[], pool: StudyCard[], opts: TestOptions, seed: string): TestQuestion[] {
  const types = QTYPE_ORDER.filter((t) => opts.types.includes(t))
  if (!types.length) return []
  const chosen = shuffled(eligibleForTest(cards, opts.starredOnly), seed).slice(0, Math.max(0, opts.count))
  const quotas = splitQuotas(chosen.length, types)
  let next = 0
  let carry: StudyCard[] = []
  const drafts: Draft[] = []
  const plain = types.find((t) => t !== 'match') as Exclude<QType, 'match'> | undefined

  for (const [i, t] of types.entries()) {
    const n = quotas[i]
    const slice = [...carry, ...chosen.slice(next, next + n)]
    next += n
    carry = []
    if (t === 'match') {
      const { groups, rest } = matchGroups(slice)
      for (const g of groups) drafts.push({ kind: 'match', cardIds: g.map((c) => c.id), terms: shuffled(g.map((c) => c.answer), `${seed}:${g[0].id}`) })
      carry = rest
    } else {
      for (const c of slice) drafts.push(draftFor(t, c, pool, seed))
    }
  }
  // Cards the last matching group couldn't take become the first other type, or written.
  for (const c of carry) drafts.push(draftFor(plain ?? 'written', c, pool, seed))

  return drafts
    .sort((a, b) => QTYPE_ORDER.indexOf(a.kind) - QTYPE_ORDER.indexOf(b.kind))
    .map((d, i) => ({ ...d, id: `q${i}` }) as TestQuestion)
}

const asText = (v: TestAnswers[string] | undefined) => (typeof v === 'string' ? v : '')

export function gradeTest(qs: TestQuestion[], answers: TestAnswers, cards: Map<string, StudyCard>, overrides: Set<string> = new Set()) {
  const results: QResult[] = []
  const add = (r: QResult) => results.push(overrides.has(`${r.qid}|${r.cardId}`) ? { ...r, correct: true } : r)
  const same = (a: string, b: string) => !!a && normalize(a) === normalize(b)
  for (const q of qs) {
    if (q.kind === 'match') {
      const picks = (typeof answers[q.id] === 'object' ? answers[q.id] : {}) as Record<string, string>
      for (const id of q.cardIds) {
        const given = picks[id] ?? ''
        add({ qid: q.id, cardId: id, kind: 'match', given, correct: same(given, cards.get(id)?.answer ?? '') })
      }
      continue
    }
    const card = cards.get(q.cardId)
    const given = asText(answers[q.id])
    if (q.kind === 'tf') add({ qid: q.id, cardId: q.cardId, kind: 'tf', given, correct: given === String(q.isTrue) })
    else if (q.kind === 'mcq') add({ qid: q.id, cardId: q.cardId, kind: 'mcq', given, correct: same(given, card?.answer ?? '') })
    else {
      const r = card ? checkTyped(given, card.answer) : 'wrong'
      add({ qid: q.id, cardId: q.cardId, kind: 'written', given, correct: r !== 'wrong', ...(r === 'close' ? { close: true } : {}) })
    }
  }
  return { results, score: results.filter((r) => r.correct).length, total: results.length }
}

export function answeredCount(qs: TestQuestion[], answers: TestAnswers) {
  let answered = 0
  let total = 0
  for (const q of qs) {
    if (q.kind === 'match') {
      const picks = (typeof answers[q.id] === 'object' ? answers[q.id] : {}) as Record<string, string>
      total += q.cardIds.length
      answered += q.cardIds.filter((id) => picks[id]).length
    } else {
      total++
      if (asText(answers[q.id]).trim()) answered++
    }
  }
  return { answered, total }
}
