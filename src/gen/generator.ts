// Card generation: text -> sentences -> TF-IDF terms -> TextRank -> cloze/MCQ cards + summary.
// Runs inside the import worker. Everything here is plain arithmetic; no models are downloaded.
//
// SEAM FOR AN AI MODE: anything implementing `CardGenerator` can replace `classicGenerator`
// in worker.ts (e.g. a WebLLM generator). It receives the same SourceDoc and must return the
// same GenOutput, so storage, review and explanations keep working unchanged.

import nlp from 'compromise/two'
import { createEmptyCard } from 'ts-fsrs'
import type { Sentence, StudyCard, SummaryPoint } from '../lib/types'
import { tokenize, splitSentences, isHeading, cleanHeading, isUsableSentence, singular, endsSentence } from './text'

export interface SourceDoc {
  kind: 'pdf' | 'paste'
  title: string
  /** PDF: one array of text lines per page. Paste: a single array with all lines. */
  pages: string[][]
}

export type Progress =
  | { step: 'read'; text: string }
  | { step: 'key'; text: string }
  | { step: 'cards'; text: string; done: number; total: number }
  | { step: 'summary'; text: string }

export interface GenOutput {
  sentences: Sentence[]
  cards: StudyCard[]
  summary: SummaryPoint[]
  quizEnabled: boolean
  quizReason?: string
}

export interface CardGenerator {
  name: string
  generate(kitId: string, doc: SourceDoc, progress: (p: Progress) => void): GenOutput
}

export class GenError extends Error {
  code: 'too-little'
  constructor(code: 'too-little', message: string) {
    super(message)
    this.code = code
  }
}

export const MIN_SENTENCES_FOR_QUIZ = 10

// ---------- 1. Paragraphs with page numbers and topics

interface Paragraph { text: string; page?: number; topic: string }

function normLine(l: string) {
  return l.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
}

function toParagraphs(doc: SourceDoc): Paragraph[] {
  // Running headers/footers: short lines at the top or bottom of a page that repeat on many pages.
  const repeated = new Set<string>()
  if (doc.kind === 'pdf' && doc.pages.length >= 3) {
    const counts = new Map<string, number>()
    for (const page of doc.pages) {
      const lines = page.filter((l) => l.trim())
      const edges = [...lines.slice(0, 2), ...lines.slice(-2)].filter((l) => l.length <= 80).map(normLine)
      for (const l of new Set(edges)) counts.set(l, (counts.get(l) ?? 0) + 1)
    }
    for (const [l, n] of counts) if (l && n >= 3 && n >= doc.pages.length * 0.4) repeated.add(l)
  }

  const out: Paragraph[] = []
  let topic = doc.title
  doc.pages.forEach((lines, pi) => {
    const page = doc.kind === 'pdf' ? pi + 1 : undefined
    const kept = lines.map((l) => l.trim()).filter((l) => !(l && (repeated.has(normLine(l)) || /^(page\s*)?\d+(\s*of\s*\d+)?$/i.test(l))))
    const maxLen = Math.max(40, ...kept.map((l) => l.length))
    let buf = ''
    const flush = () => {
      const text = buf.replace(/\s+/g, ' ').trim()
      if (text) out.push({ text, page, topic })
      buf = ''
    }
    for (const line of kept) {
      if (!line) { flush(); continue }
      // A heading only counts between sentences, never in the middle of one.
      const between = !buf.trim() || endsSentence(buf.trim())
      if (between && isHeading(line)) { flush(); topic = cleanHeading(line); continue }
      if (/^[-*•]\s+/.test(line)) { flush(); buf = line.replace(/^[-*•]\s+/, ''); flush(); continue }
      // Re-join words hyphenated across a line break.
      buf = buf.endsWith('-') && /^[a-z]/.test(line) ? buf.slice(0, -1) + line : buf + ' ' + line
      // In PDFs a short line that ends a sentence usually ends the paragraph.
      if (doc.kind === 'pdf' && endsSentence(line) && line.length < maxLen * 0.8) flush()
    }
    flush()
  })
  return out
}

// ---------- 2. Candidate terms (noun phrases) per sentence via compromise POS tags

type Pos = 'name' | 'plural' | 'phrase' | 'noun'
interface Term { key: string; surface: Map<string, number>; pos: Pos; words: number; df: number; tf: number; sentences: number[]; score: number }

const GENERIC = new Set(
  'example way number part thing kind type lot use time case form fact result amount order level area figure table chapter section page step point others something one ones lack role group set series variety range end side term words word name idea reason addition instance study place unit half middle inside outside lot bit'.split(' '),
)

function termKey(phrase: string) {
  const w = phrase.toLowerCase().split(' ')
  w[w.length - 1] = singular(w[w.length - 1])
  return w.join(' ')
}

type Tok = { text: string; tags: string[]; post?: string }

const isNoun = (t: Tok, prev?: Tok, next?: Tok) =>
  (t.tags.includes('Noun') && !t.tags.includes('Pronoun') && !t.tags.includes('Value')) ||
  // compromise tags "active transport" / "electron transport chain" with a verb in the middle;
  // treat that verb as part of the noun phrase.
  (t.tags.includes('Infinitive') && !!prev && (prev.tags.includes('Adjective') || (prev.tags.includes('Singular') && !!next?.tags.includes('Noun'))))

const isAdj = (t: Tok) => t.tags.includes('Adjective') && !t.tags.includes('Value') && !t.tags.includes('Superlative') && !t.tags.includes('Comparative')

function extractPhrases(sentence: string): { text: string; pos: Pos }[] {
  const toks: Tok[] = (nlp(sentence).json() as { terms: Tok[] }[]).flatMap((s) => s.terms)
  const out: { text: string; pos: Pos }[] = []
  let run: Tok[] = []
  const end = () => {
    while (run.length && !isNoun(run[run.length - 1], run[run.length - 2])) run.pop()
    while (run.length > 3) run.shift()
    const words = run.map((t) => t.text.replace(/[^\p{L}\p{N}'-]/gu, '')).filter(Boolean)
    if (words.length && !(words.length === 1 && GENERIC.has(words[0].toLowerCase())) && words.join(' ').length >= 3) {
      const tags = run.flatMap((t) => t.tags)
      const pos: Pos = tags.includes('ProperNoun') ? 'name' : words.length > 1 ? 'phrase' : run[run.length - 1].tags.includes('Plural') ? 'plural' : 'noun'
      out.push({ text: words.join(' '), pos })
    }
    run = []
  }
  toks.forEach((t, i) => {
    const ok = isNoun(t, run[run.length - 1], toks[i + 1]) || isAdj(t)
    if (ok) run.push(t)
    else end()
    if (/[,;:()]/.test(t.post ?? '')) end()
  })
  end()
  return out
}

// ---------- 3. TextRank over sentences (sparse cosine similarity, inverted index)

function textRank(tokens: string[][]): number[] {
  const n = tokens.length
  if (n === 0) return []
  const df = new Map<string, number>()
  for (const d of tokens) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
  // Words in 1 sentence add nothing; words in >25% of sentences add noise and cost.
  const useful = (t: string) => { const d = df.get(t)!; return d > 1 && d <= Math.max(2, n * 0.25) }
  const vecs = tokens.map((d) => {
    const v = new Map<string, number>()
    for (const t of d) if (useful(t)) v.set(t, (v.get(t) ?? 0) + 1)
    let norm = 0
    for (const [t, c] of v) { const w = c * Math.log(n / df.get(t)!); v.set(t, w); norm += w * w }
    norm = Math.sqrt(norm) || 1
    for (const [t, w] of v) v.set(t, w / norm)
    return v
  })
  const index = new Map<string, number[]>()
  vecs.forEach((v, i) => { for (const t of v.keys()) (index.get(t) ?? index.set(t, []).get(t)!).push(i) })

  const edges: { j: number; w: number }[][] = []
  const acc = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const touched: number[] = []
    for (const [t, w] of vecs[i]) for (const j of index.get(t)!) {
      if (j === i) continue
      if (acc[j] === 0) touched.push(j)
      acc[j] += w * vecs[j].get(t)!
    }
    const list = touched.map((j) => ({ j, w: acc[j] })).filter((e) => e.w > 0.05).sort((a, b) => b.w - a.w).slice(0, 20)
    for (const j of touched) acc[j] = 0
    edges.push(list)
  }
  const outSum = edges.map((l) => l.reduce((s, e) => s + e.w, 0))
  let rank = new Float64Array(n).fill(1 / n)
  for (let it = 0; it < 30; it++) {
    const next = new Float64Array(n).fill((1 - 0.85) / n)
    for (let i = 0; i < n; i++) {
      if (!outSum[i]) continue
      for (const e of edges[i]) next[e.j] += (0.85 * rank[i] * e.w) / outSum[i]
    }
    rank = next
  }
  return Array.from(rank)
}

// ---------- 4. Assemble

function hintFor(answer: string, pos: Pos) {
  const words = answer.split(' ').length
  const kind = { name: 'a name', plural: 'a plural noun', phrase: 'a noun phrase', noun: 'a noun' }[pos]
  return `Starts with “${answer[0].toUpperCase()}” · ${words} word${words > 1 ? 's' : ''} · ${kind}`
}

function findSurface(sentence: string, term: Term): { start: number; text: string } | null {
  const forms = [...term.surface.keys()].sort((a, b) => b.length - a.length)
  for (const f of forms) {
    const m = new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').exec(sentence)
    // "Facilitated _____" reads as a broken compound: skip a blank right after a capitalised opener
    // unless that opener is a plain determiner or preposition.
    if (m && /^[A-Z][a-z]+\s$/.test(sentence.slice(0, m.index)) && !OPENERS.test(sentence.slice(0, m.index).trim())) continue
    if (m) return { start: m.index, text: m[0] }
  }
  return null
}

const OPENERS = /^(The|A|An|This|That|These|Those|Each|Every|Some|Most|All|In|During|Inside|After|Before|When|Without|With|Both|Its|Their)$/

/** "Cell ATP" -> "cell ATP": lower-case words but keep acronyms like ATP, DNA, NADPH. */
const lowerKeepAcronyms = (s: string) => s.split(' ').map((w) => (/^[A-Z0-9-]{2,}s?$/.test(w) ? w : w.toLowerCase())).join(' ')
/** How a term is shown as an option: names keep their case, everything else is lower-cased. */
const optionText = (text: string, pos: Pos) => (pos === 'name' ? text : lowerKeepAcronyms(text))

const display = (t: Term) => [...t.surface.entries()].sort((a, b) => b[1] - a[1])[0][0]

export const classicGenerator: CardGenerator = {
  name: 'classic (TF-IDF + TextRank)',
  generate(kitId, doc, progress) {
    const paragraphs = toParagraphs(doc)
    progress({ step: 'read', text: doc.kind === 'pdf' ? `Read ${doc.pages.length} pages` : `Read ${paragraphs.length} paragraphs` })

    // Sentences, each keeping page + paragraph number.
    const sentences: Sentence[] = []
    paragraphs.forEach((p, pi) => {
      for (const text of splitSentences(p.text)) {
        if (!isUsableSentence(text)) continue
        sentences.push({ id: `${kitId}:s${sentences.length}`, kitId, text, page: p.page, paragraph: pi + 1, index: sentences.length, topic: p.topic })
      }
    })
    if (sentences.length === 0) {
      throw new GenError('too-little', 'No complete sentences were found. Margin needs full sentences (6–55 words, ending in a period) to make cards.')
    }

    // TF-IDF over candidate terms: score = (1 + log tf) * log(1 + N / df), multi-word phrases x1.3.
    const N = sentences.length
    const terms = new Map<string, Term>()
    const sentenceTerms: string[][] = []
    sentences.forEach((s, i) => {
      const keys: string[] = []
      for (const ph of extractPhrases(s.text)) {
        const key = termKey(ph.text)
        let t = terms.get(key)
        if (!t) terms.set(key, (t = { key, surface: new Map(), pos: ph.pos, words: key.split(' ').length, df: 0, tf: 0, sentences: [], score: 0 }))
        t.surface.set(ph.text, (t.surface.get(ph.text) ?? 0) + 1)
        t.tf++
        if (t.sentences[t.sentences.length - 1] !== i) { t.sentences.push(i); t.df++ }
        keys.push(key)
      }
      sentenceTerms.push(keys)
    })
    for (const t of terms.values()) t.score = (1 + Math.log(t.tf)) * Math.log(1 + N / t.df) * (t.words > 1 ? 1.3 : 1)
    const ranked = [...terms.values()].sort((a, b) => b.score - a.score)
    const top = ranked.slice(0, Math.min(150, Math.max(15, Math.round(ranked.length * 0.25))))
    const topSet = new Set(top.map((t) => t.key))

    const rank = textRank(sentences.map((s) => tokenize(s.text)))
    const byRank = sentences.map((_, i) => i).sort((a, b) => rank[b] - rank[a])
    const candidates = byRank.filter((i) => sentenceTerms[i].some((k) => topSet.has(k)))
    const keyCount = Math.min(candidates.length, Math.max(10, Math.min(400, Math.round(N * 0.7))))
    const keyIdx = candidates.slice(0, keyCount).sort((a, b) => a - b)
    progress({ step: 'key', text: `Found ${keyIdx.length} key sentences` })

    // Where each term is best explained: its highest-ranked sentence.
    const bestSentence = (t: Term) => t.sentences.reduce((b, i) => (rank[i] > rank[b] ? i : b), t.sentences[0])

    const quizEnabled = N >= MIN_SENTENCES_FOR_QUIZ && top.length >= 4
    const quizReason = quizEnabled
      ? undefined
      : N < MIN_SENTENCES_FOR_QUIZ
        ? `Only ${N} usable sentence${N === 1 ? '' : 's'} found. A quiz needs at least ${MIN_SENTENCES_FOR_QUIZ} so the wrong options can come from your own notes, so flashcards were made instead.`
        : `Only ${top.length} distinct terms found, which isn’t enough wrong options for a quiz. Flashcards were made instead.`

    const used = new Map<string, number>()
    const cards: StudyCard[] = []
    const now = new Date()
    keyIdx.forEach((si, n) => {
      if (n % 25 === 0) progress({ step: 'cards', text: `Writing cards (${n} of ~${keyIdx.length})`, done: n, total: keyIdx.length })
      const s = sentences[si]
      // Blank the highest-scoring term, spreading answers across terms.
      const options = [...new Set(sentenceTerms[si])].filter((k) => topSet.has(k)).map((k) => terms.get(k)!)
      options.sort((a, b) => b.score / (1 + 0.7 * (used.get(b.key) ?? 0)) - a.score / (1 + 0.7 * (used.get(a.key) ?? 0)))
      for (const term of options) {
        const hit = findSurface(s.text, term)
        if (!hit) continue
        used.set(term.key, (used.get(term.key) ?? 0) + 1)
        const prompt = s.text.slice(0, hit.start) + '_____' + s.text.slice(hit.start + hit.text.length)
        // Options are shown in lower case (except names) so capitalisation doesn't give the answer away.
        const answer = optionText(hit.text, term.pos)
        const base = { id: `${kitId}:c${cards.length}`, kitId, prompt, answer, sourceSentenceId: s.id, hint: hintFor(answer, term.pos), topic: s.topic, fsrs: createEmptyCard(now) }

        if (quizEnabled) {
          // Distractors: other key terms of similar kind and length that are not in this sentence.
          const inSentence = new Set(sentenceTerms[si])
          const pool = top
            .filter((t) => t.key !== term.key && !inSentence.has(t.key) && !t.key.includes(term.key) && !term.key.includes(t.key))
            .map((t) => ({ t, cost: Math.abs(t.key.length - term.key.length) / Math.max(t.key.length, term.key.length) + Math.abs(t.words - term.words) * 0.5 + (t.pos === term.pos ? 0 : 1) + ((t.key.length * 7 + si) % 5) * 0.01 }))
            .sort((a, b) => a.cost - b.cost)
            .slice(0, 3)
          if (pool.length === 3) {
            const distractors = pool.map(({ t }) => optionText(display(t), t.pos))
            cards.push({ ...base, type: 'mcq', distractors, distractorSources: pool.map(({ t }, k) => ({ term: distractors[k], sentenceId: sentences[bestSentence(t)].id })) })
            break
          }
        }
        cards.push({ ...base, type: 'cloze' })
        break
      }
    })

    // Summary: top-ranked sentences, skipping near-duplicates, in reading order.
    const want = Math.min(N, Math.max(4, Math.min(6, Math.round(N / 15))))
    const chosen: number[] = []
    const sets = new Map<number, Set<string>>()
    const tokset = (i: number) => sets.get(i) ?? sets.set(i, new Set(tokenize(sentences[i].text))).get(i)!
    for (const i of byRank) {
      if (chosen.length >= want) break
      const a = tokset(i)
      const dup = chosen.some((j) => { const b = tokset(j); let inter = 0; for (const t of a) if (b.has(t)) inter++; return inter / (a.size + b.size - inter || 1) > 0.5 })
      if (!dup) chosen.push(i)
    }
    const summary = chosen.sort((a, b) => a - b).map((i) => ({ sentenceId: sentences[i].id, text: sentences[i].text, page: sentences[i].page, paragraph: sentences[i].paragraph }))
    progress({ step: 'summary', text: `Summary: ${summary.length} points` })

    return { sentences, cards, summary, quizEnabled, quizReason }
  },
}
