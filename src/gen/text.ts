// Plain-text helpers shared by the generator (worker) and the explanation fallback (UI).

const STOP = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both but by can
  could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it
  its itself just me more most my no nor not now of off on once only or other our out over own same she should so some such than
  that the their them then there these they this those through to too under until up very was we were what when where which while
  who whom why will with would you your yours called known often usually many much may might must one two three within without
  however therefore thus such per via upon onto across along around among`.split(/\s+/),
)

/** Crude plural stripping shared by tokens and term keys: "membranes" -> "membrane", keeps "glass", "nucleus". */
export const singular = (w: string) => (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w)

const SENTENCE_END = /[.!?]["”')\]]?$/
export const endsSentence = (s: string) => SENTENCE_END.test(s)

export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const m of text.toLowerCase().matchAll(/[a-z][a-z'-]+/g)) {
    const w = m[0].replace(/'s$/, '')
    if (w.length < 3 || STOP.has(w)) continue
    out.push(singular(w))
  }
  return out
}

/** Term-frequency vector with idf weights; used for cosine similarity. */
function tfidfVector(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const v = new Map<string, number>()
  for (const t of tokens) v.set(t, (v.get(t) ?? 0) + 1)
  for (const [t, n] of v) v.set(t, n * (idf.get(t) ?? 0))
  return v
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0
  for (const [t, x] of a) {
    na += x * x
    const y = b.get(t)
    if (y) dot += x * y
  }
  for (const y of b.values()) nb += y * y
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

function idfFor(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>()
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
  const idf = new Map<string, number>()
  for (const [t, n] of df) idf.set(t, Math.log(docs.length / n) + 1)
  return idf
}

/** Index of the best-matching sentence for a query, or -1. TF-IDF cosine similarity. */
export function bestMatch(query: string, sentences: string[]): number {
  const docs = sentences.map(tokenize)
  const idf = idfFor(docs)
  const q = tfidfVector(tokenize(query), idf)
  let best = -1, bestScore = 0
  docs.forEach((d, i) => {
    const s = cosine(q, tfidfVector(d, idf))
    if (s > bestScore) [best, bestScore] = [i, s]
  })
  return best
}

const ABBREV = /\b(e\.g|i\.e|etc|vs|fig|figs|approx|dr|mr|mrs|ms|prof|st|no|vol|ch|sec|al|ca|cf)\./gi

export function splitSentences(paragraph: string): string[] {
  const guarded = paragraph.replace(ABBREV, (m) => m.slice(0, -1) + '\u0000').replace(/(\d)\.(\d)/g, '$1\u0000$2')
  return guarded
    .split(/(?<=[.!?]["”')\]]?)\s+(?=["“(]?[A-Z0-9])/)
    .map((s) => s.replace(/\u0000/g, '.').trim())
    .filter(Boolean)
}

export function isHeading(line: string): boolean {
  const t = line.replace(/^#+\s*/, '').trim()
  if (/^#+\s/.test(line)) return t.length > 0
  if (t.length < 3 || t.length > 80) return false
  if (/[.,;!?]$/.test(t)) return false
  const words = t.split(/\s+/)
  if (words.length > 10) return false
  const letters = t.replace(/[^A-Za-z]/g, '').length
  if (letters / t.length < 0.5) return false
  return /^(\d+(\.\d+)*\.?\s+)?[A-Z]/.test(t)
}

export function cleanHeading(line: string) {
  return line.replace(/^#+\s*/, '').replace(/^\d+(\.\d+)*\.?\s+/, '').trim()
}

/** Sentences we refuse to make cards from: headers, page numbers, references, fragments. */
export function isUsableSentence(s: string): boolean {
  const words = s.split(/\s+/).length
  if (words < 6 || words > 55) return false
  if (!endsSentence(s)) return false
  const letters = s.replace(/[^A-Za-z]/g, '').length
  if (letters / s.length < 0.6) return false
  if (/^(page|figure|fig\.|table|source|copyright|©)\b/i.test(s)) return false
  if (/https?:\/\/|www\./i.test(s)) return false
  return true
}
