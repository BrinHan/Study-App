// Loading, answers, stats and source lookup. Pure functions over loaded data where possible.
import { addReview, allCards, allConfusions, allReviews, deleteReview, getSettings, listKits, listSessions, getSentence, putCard, sentencesForKit, uid } from './db'
import type { AnswerFormat, Kit, StudyCard, Review, Confusion, Settings, Sentence, StudyMode, StudySession } from './types'
import { applyAnswer } from '../study/mastery'
import { bestMatch } from '../gen/text'

// ---- Dates (local time)
const pad = (n: number) => String(n).padStart(2, '0')
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
/** "2026-10-30" -> local midnight of that day. */
export function parseDayKey(key: string) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const daysUntil = (key: string, now = new Date()) => Math.round((parseDayKey(key).getTime() - startOfDay(now).getTime()) / 86400000)

// ---- Loading everything at once is fine at concept scale (thousands of cards).
export interface StudyData { kits: Kit[]; cards: StudyCard[]; reviews: Review[]; confusions: Confusion[]; settings: Settings; sessions: StudySession[] }
export async function loadStudyData(): Promise<StudyData> {
  const [kits, cards, reviews, confusions, settings, sessions] = await Promise.all([listKits(), allCards(), allReviews(), allConfusions(), getSettings(), listSessions()])
  const ready = new Set(kits.filter((k) => k.status === 'ready').map((k) => k.id))
  return { kits, cards: cards.filter((c) => ready.has(c.kitId)), reviews, confusions, settings, sessions: sessions.filter((x) => ready.has(x.kitId)) }
}

export interface AnswerMeta { mode: StudyMode; format: AnswerFormat; picked?: string }

/**
 * Save one answer from any mode: update the card's mastery and add it to the answer log.
 * `replaces` is the review id of an answer being overridden ("I was right"); `card` must then be the card as it was before that answer.
 */
export async function recordAnswer(card: StudyCard, correct: boolean, meta: AnswerMeta, replaces?: string): Promise<{ card: StudyCard; reviewId: string }> {
  const updated = { ...card, progress: applyAnswer(card.progress, correct) }
  const reviewId = uid()
  await putCard(updated)
  if (replaces) await deleteReview(replaces)
  await addReview({ id: reviewId, cardId: card.id, kitId: card.kitId, topic: card.topic, mode: meta.mode, format: meta.format, pickedAnswer: meta.picked, correct, reviewedAt: Date.now() })
  return { card: updated, reviewId }
}

/** When each kit was last studied (its latest answer). */
export function lastActivity(d: StudyData): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of d.reviews) if (r.reviewedAt > (m.get(r.kitId) ?? 0)) m.set(r.kitId, r.reviewedAt)
  return m
}

/** Days until the kit's exam when it's 0–3 days away (time to take a practice test), else null. */
export function examNudge(kit: Pick<Kit, 'examDate'>, now = new Date()): number | null {
  if (!kit.examDate) return null
  const left = daysUntil(kit.examDate, now)
  return left >= 0 && left <= 3 ? left : null
}

/** Number of cards due on each of the next `days` days; day 0 is today's queue. */
export function forecast(d: StudyData, days = 7): number[] {
  const now = new Date()
  const out = new Array(days).fill(0)
  out[0] = todayQueue(d).length + laterToday(d, now).count
  const base = startOfDay(now)
  for (const c of d.cards) {
    if (c.fsrs.state === State.New) continue
    const i = Math.floor((startOfDay(c.fsrs.due).getTime() - base.getTime()) / 86400000)
    if (i >= 1 && i < days) out[i]++
  }
  return out
}

export const estMinutes = (n: number) => Math.max(1, Math.round((n * 12) / 60))

// ---- Stats
export function missesByCard(reviews: Review[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of reviews) if (!r.correct) m.set(r.cardId, (m.get(r.cardId) ?? 0) + 1)
  return m
}

export const recall = (rs: Review[]) => (rs.length ? rs.filter((r) => r.correct).length / rs.length : 0)

export function topicStats(reviews: Review[]) {
  const m = new Map<string, { kitId: string; topic: string; correct: number; total: number }>()
  for (const r of reviews) {
    const k = `${r.kitId}|${r.topic}`
    const s = m.get(k) ?? m.set(k, { kitId: r.kitId, topic: r.topic, correct: 0, total: 0 }).get(k)!
    s.total++
    if (r.correct) s.correct++
  }
  return m
}

/** Practice quiz: MCQ cards sampled with weight toward topics (and cards) with low accuracy. */
export function pickQuiz(cards: StudyCard[], reviews: Review[], n = 10): StudyCard[] {
  const stats = topicStats(reviews)
  const misses = missesByCard(reviews)
  const pool = cards.filter((c) => c.type === 'mcq').map((c) => {
    const s = stats.get(`${c.kitId}|${c.topic}`)
    const acc = s && s.total >= 2 ? s.correct / s.total : 0.6
    return { c, w: 1 + 3 * (1 - acc) + Math.min(2, misses.get(c.id) ?? 0) }
  })
  const out: StudyCard[] = []
  while (out.length < n && pool.length) {
    let r = Math.random() * pool.reduce((s, p) => s + p.w, 0)
    const i = pool.findIndex((p) => (r -= p.w) <= 0)
    out.push(pool.splice(i < 0 ? pool.length - 1 : i, 1)[0].c)
  }
  return out
}

// ---- Sources
export function cite(kit: Pick<Kit, 'sourceType' | 'fileName'> | undefined, s: Pick<Sentence, 'page' | 'paragraph'>) {
  if (kit?.sourceType === 'pdf' && s.page) return `${kit.fileName ?? 'PDF'}, page ${s.page}`
  return `Pasted notes, paragraph ${s.paragraph}`
}

/** The card's stored source sentence, or the best TF-IDF match in its kit if none is stored. */
export async function resolveSource(card: StudyCard, id = card.sourceSentenceId): Promise<{ sentence: Sentence; matched: boolean } | null> {
  const stored = id ? await getSentence(id) : undefined
  if (stored) return { sentence: stored, matched: false }
  const all = await sentencesForKit(card.kitId)
  const i = bestMatch(card.prompt.replace('_____', card.answer), all.map((s) => s.text))
  return i >= 0 ? { sentence: all[i], matched: true } : null
}

// ---- Last session, for the Session done screen
export interface SessionResult { cardId: string; rating: Grade; correct: boolean; picked?: string; newlyMastered: boolean }
export interface SessionSummary { mode: 'review' | 'quiz' | 'retry'; kitId?: string; results: SessionResult[]; endedEarly: boolean; notReached: number; notes: string[] }
let lastSession: SessionSummary | null = null
export const setLastSession = (s: SessionSummary) => { lastSession = s }
export const getLastSession = () => lastSession
