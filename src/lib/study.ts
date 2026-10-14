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

export function formatInterval(ms: number) {
  const min = ms / 60000
  if (min < 60) return `${Math.max(1, Math.round(min))} min`
  const h = min / 60
  if (h < 24) return `${Math.round(h)} h`
  const d = h / 24
  if (d < 30) return `${Math.round(d)} d`
  if (d < 365) return `${Math.round(d / 30)} mo`
  return `${(d / 365).toFixed(1)} yr`
}

export function nextIntervals(card: StudyCard, now = new Date()): Record<Grade, string> {
  const p = scheduler.repeat(card.fsrs, now)
  const out = {} as Record<Grade, string>
  for (const g of [1, 2, 3, 4] as Grade[]) out[g] = formatInterval(p[g].card.due.getTime() - now.getTime())
  return out
}

export function applyRating(card: StudyCard, rating: Grade, now = new Date()): StudyCard {
  const { card: next } = scheduler.next(card.fsrs, now, rating)
  return { ...card, fsrs: next, introducedOn: card.introducedOn ?? dayKey(now) }
}

// ---- Loading everything at once is fine at concept scale (thousands of cards).
export interface StudyData { kits: Kit[]; cards: StudyCard[]; reviews: Review[]; confusions: Confusion[]; settings: Settings }
export async function loadStudyData(): Promise<StudyData> {
  const [kits, cards, reviews, confusions, settings] = await Promise.all([listKits(), allCards(), allReviews(), allConfusions(), getSettings()])
  const ready = new Set(kits.filter((k) => k.status === 'ready').map((k) => k.id))
  return { kits, cards: cards.filter((c) => ready.has(c.kitId)), reviews, confusions, settings }
}

/**
 * Today's queue: due learning/review cards, then extra cards for upcoming exams (so every card is
 * seen at least twice before the exam), then new cards up to the daily limit.
 */
export function buildQueue(d: StudyData, now = new Date()): StudyCard[] {
  const today = dayKey(now)
  const cards = d.cards
  const dayStart = startOfDay(now).getTime()
  const seenToday = new Set(d.reviews.filter((r) => r.reviewedAt >= dayStart).map((r) => r.cardId))
  const due = cards
    .filter((c) => c.fsrs.state !== State.New && c.fsrs.due <= now)
    .sort((a, b) => a.fsrs.state - b.fsrs.state || a.fsrs.due.getTime() - b.fsrs.due.getTime())
  const chosen = new Set(due.map((c) => c.id))

  const extra: StudyCard[] = []
  const examKits = d.kits.filter((k) => k.examDate && daysUntil(k.examDate, now) >= 1)
  const byKit = new Map<string, StudyCard[]>()
  if (examKits.length) for (const c of cards) (byKit.get(c.kitId) ?? byKit.set(c.kitId, []).get(c.kitId)!).push(c)
  for (const kit of examKits) {
    const left = daysUntil(kit.examDate!, now)
    const behind = (byKit.get(kit.id) ?? []).filter((c) => c.fsrs.reps < 2 && !chosen.has(c.id) && !seenToday.has(c.id))
    const viewsNeeded = behind.reduce((s, c) => s + (2 - c.fsrs.reps), 0)
    const quota = Math.ceil(viewsNeeded / left)
    behind.sort((a, b) => b.fsrs.reps - a.fsrs.reps).slice(0, quota).forEach((c) => { extra.push(c); chosen.add(c.id) })
  }

  const introducedToday = d.cards.filter((c) => c.introducedOn === today).length
  const newLeft = Math.max(0, d.settings.newPerDay - introducedToday)
  const order = new Map(d.kits.map((k, i) => [k.id, i]))
  const fresh = cards
    .filter((c) => c.fsrs.state === State.New && !chosen.has(c.id))
    .sort((a, b) => (order.get(b.kitId)! - order.get(a.kitId)!) || byId.compare(a.id, b.id))
    .slice(0, newLeft)
  return [...due, ...extra, ...fresh]
}

const byId = new Intl.Collator(undefined, { numeric: true })

// One queue per loaded StudyData: screens ask for it (and per-kit slices) many times per render.
const queueCache = new WeakMap<StudyData, StudyCard[]>()
export function todayQueue(d: StudyData): StudyCard[] {
  let q = queueCache.get(d)
  if (!q) queueCache.set(d, (q = buildQueue(d)))
  return q
}

/** A kit's share of today's queue (the daily new-card limit is shared across kits). */
export const kitQueue = (d: StudyData, kitId: string) => todayQueue(d).filter((c) => c.kitId === kitId)

export function dueByKit(d: StudyData): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of todayQueue(d)) m.set(c.kitId, (m.get(c.kitId) ?? 0) + 1)
  return m
}

/** Cards that become due later today (learning steps), for the "all caught up" message. */
export function laterToday(d: StudyData, now = new Date()) {
  const end = addDays(now, 1)
  const soon = d.cards.filter((c) => c.fsrs.state !== State.New && c.fsrs.due > now && c.fsrs.due < end)
  const next = soon.reduce<Date | null>((m, c) => (!m || c.fsrs.due < m ? c.fsrs.due : m), null)
  return { count: soon.length, next }
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
