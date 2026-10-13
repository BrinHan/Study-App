// AI question schema and validator, shared by the app (src/) and the proxy (proxy/).

export interface McqQuestion { kind: 'mcq'; question: string; answer: string; distractors: [string, string, string]; distractorExplanations: [string, string, string]; explanation: string; hint: string; sourceIds: string[] }
export interface FlashQuestion { kind: 'flashcard'; question: string; answer: string; explanation: string; hint: string; sourceIds: string[] }
export type AiQuestion = McqQuestion | FlashQuestion
export interface GenerateRequest { sentences: { id: string; text: string }[] }
export interface GenerateResponse { questions: AiQuestion[] }
export type ProxyErrorCode = 'disabled' | 'forbidden' | 'bad-request' | 'too-large' | 'session' | 'rate-limited' | 'budget' | 'busy' | 'upstream' | 'not-found'

export const Q = { questionMin: 12, questionMax: 300, choiceMax: 120, flashAnswerMax: 300, explanationMin: 20, explanationMax: 600, wrongExplanationMax: 300, hintMax: 120, maxSourceIds: 3, maxPerChunk: 25 } as const
export const REQ = { maxSentences: 150, maxSentenceChars: 1000, maxTotalChars: 24000, idPattern: /^s\d{1,5}$/ } as const

const BANNED_CHOICE = /^(all|none) of the above$|^both .+ and .+$/i

/** Plain text only: no control chars, markdown emphasis or runs of whitespace. */
export function cleanText(s: unknown): string {
  if (typeof s !== 'string') return ''
  return s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim()
}

const inRange = (s: string, min: number, max: number) => s.length >= min && s.length <= max
const norm = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim()

function validateOne(r: unknown, validIds: ReadonlySet<string>): AiQuestion | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  const question = cleanText(o.question), answer = cleanText(o.answer)
  const explanation = cleanText(o.explanation), hint = cleanText(o.hint)
  if (!inRange(question, Q.questionMin, Q.questionMax)) return null
  if (!inRange(explanation, Q.explanationMin, Q.explanationMax) || !inRange(hint, 1, Q.hintMax)) return null
  if (answer.length >= 4 && question.toLowerCase().includes(answer.toLowerCase())) return null
  const ids = o.sourceIds
  if (!Array.isArray(ids) || !ids.length || ids.length > Q.maxSourceIds) return null
  if (!ids.every((id) => typeof id === 'string' && validIds.has(id))) return null
  const sourceIds = ids as string[]

  if (o.kind === 'flashcard') {
    if (!inRange(answer, 1, Q.flashAnswerMax)) return null
    return { kind: 'flashcard', question, answer, explanation, hint, sourceIds }
  }
  if (o.kind !== 'mcq') return null
  if (!inRange(answer, 1, Q.choiceMax)) return null
  if (!Array.isArray(o.distractors) || o.distractors.length !== 3) return null
  if (!Array.isArray(o.distractorExplanations) || o.distractorExplanations.length !== 3) return null
  const distractors = o.distractors.map(cleanText) as [string, string, string]
  const wrong = o.distractorExplanations.map(cleanText) as [string, string, string]
  if (!distractors.every((d) => inRange(d, 1, Q.choiceMax))) return null
  if (!wrong.every((w) => inRange(w, 1, Q.wrongExplanationMax))) return null
  const choices = [answer, ...distractors]
  if (new Set(choices.map((c) => c.toLowerCase())).size !== 4) return null
  if (choices.some((c) => BANNED_CHOICE.test(c))) return null
  // a much longer answer gives itself away
  if (answer.length > 40 && answer.length > 2.5 * Math.max(...distractors.map((d) => d.length))) return null
  return { kind: 'mcq', question, answer, distractors, distractorExplanations: wrong, explanation, hint, sourceIds }
}

/** Keeps only well-formed, deduped questions (max 25). Never throws; anything unexpected is dropped. */
export function validateQuestions(raw: unknown, validIds: ReadonlySet<string>): AiQuestion[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? (raw as { questions?: unknown }).questions : null
  if (!Array.isArray(list)) return []
  const out: AiQuestion[] = []
  const seen = new Set<string>()
  for (const r of list) {
    if (out.length >= Q.maxPerChunk) break
    let q: AiQuestion | null = null
    try { q = validateOne(r, validIds) } catch { /* drop */ }
    if (!q) continue
    const key = norm(q.question)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(q)
  }
  return out
}
