import { expect, test } from 'vitest'
import sampleText from '../../../samples/cell-biology.md?raw'
import type { SourceDoc, Progress } from '../generator'
import { classicGenerator } from '../generator'
import { createAiGenerator } from './aiGenerator'
import { ProxyClient } from './proxyClient'

type Item = { id: string; text: string }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Mock fetch serving /session and /generate; counts and records calls. */
function fakeProxy(generate: (sentences: Item[], callNo: number) => Response) {
  const calls: Item[][] = []
  const f = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/session')) return json({ session: 'sess', expiresAt: Date.now() + 1e6 })
    const body = JSON.parse(String(init?.body)) as { sentences: Item[] }
    calls.push(body.sentences)
    return generate(body.sentences, calls.length)
  }) as unknown as typeof fetch & { generateCalls: number; calls: Item[][] }
  Object.defineProperty(f, 'generateCalls', { get: () => calls.length })
  f.calls = calls
  return f
}

const flash = (id: string) => ({
  kind: 'flashcard', question: `What does notes sentence ${id} explain about the cell?`, answer: 'the answer',
  explanation: 'The notes state this directly in the cited sentence.', hint: 'Think about the cell', sourceIds: [id],
})
const validFor = (sentences: Item[]) => json({ questions: sentences.slice(0, 25).map((s) => flash(s.id)) })

const aiGen = (f: typeof fetch, extra?: Partial<Parameters<typeof createAiGenerator>[0]>) => {
  const client = new ProxyClient('https://p', f)
  return createAiGenerator({ client, session: client.openSession('t').catch(() => null), retryDelayMs: 0, sleep: async () => {}, ...extra })
}

const docOf = (copies: number): SourceDoc => ({ kind: 'paste', title: 'x', pages: [Array(copies).fill(sampleText).join('\n\n').split(/\r?\n/)] })
const doc = docOf(1)
const twoChunkDoc = docOf(5) // ~235 sentences -> 2 chunks (the 150-sentence limit binds before the char limit)
const bigDoc = docOf(14) // ~660 sentences -> 5 chunks

// 2000 distinct sentences (> 8 chunks of 150). Repeating the sample doesn't work: classic's 400 cards then all land in the first 1200 sentences.
function bigDistinctDoc(): SourceDoc {
  const nouns = 'membrane nucleus ribosome mitochondrion chloroplast vacuole lysosome enzyme protein lipid receptor vesicle cytoskeleton filament chromosome polymerase ligand channel gradient pigment organelle substrate catalyst peptide nucleotide cytoplasm cisterna granule tubule matrix envelope pore'.split(' ')
  const adj = 'cellular active passive rough smooth central inner outer folded dense fluid selective stable rapid slow'.split(' ')
  const verbs = 'regulates transports stores binds converts shapes protects releases anchors signals'.split(' ')
  let seed = 12345
  const r = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  const pick = <T,>(a: T[]) => a[r(a.length)]
  const lines = Array.from({ length: 2000 }, (_, i) => `The ${pick(adj)} ${pick(nouns)} ${pick(verbs)} the ${pick(adj)} ${pick(nouns)} inside the ${pick(nouns)} of the ${pick(nouns)} number${i % 40}.`)
  return { kind: 'paste', title: 'x', pages: [lines] }
}

test('all chunks succeed: every card is an AI card with explanation and a real source', async () => {
  const out = await aiGen(fakeProxy(validFor)).generate('k', doc, () => {})
  expect(out.cards.length).toBeGreaterThan(0)
  expect(out.cards.every((c) => c.explanation)).toBe(true)
  expect(out.cards.every((c) => out.sentences.some((s) => s.id === c.sourceSentenceId))).toBe(true)
  expect(new Set(out.cards.map((c) => c.id)).size).toBe(out.cards.length)
  expect(out.cards.map((c) => c.id)).toEqual(out.cards.map((_, n) => `k:c${n}`))
})

test('a chunk that fails twice with 502 falls back to classic cards for exactly that chunk', async () => {
  // chunk 1 starts at s0; chunk 2 always fails with 502
  const f = fakeProxy((sentences) => (sentences[0].id === 's0' ? validFor(sentences) : json({ error: 'upstream' }, 502)))
  const out = await aiGen(f).generate('k', twoChunkDoc, () => {})
  expect(f.generateCalls).toBe(3) // chunk 1 once, chunk 2 twice
  const second = f.calls.find((c) => c[0].id !== 's0')!
  const secondIds = new Set(out.sentences.filter((s) => second.some((x) => x.id === `s${s.index}`)).map((s) => s.id))
  const inSecond = out.cards.filter((c) => secondIds.has(c.sourceSentenceId!))
  const inFirst = out.cards.filter((c) => !secondIds.has(c.sourceSentenceId!))
  expect(inSecond.length).toBeGreaterThan(0)
  expect(inSecond.every((c) => !c.explanation)).toBe(true)
  expect(inFirst.length).toBeGreaterThan(0)
  expect(inFirst.every((c) => c.explanation)).toBe(true)
})

test('a retryable error is retried once and then succeeds', async () => {
  const f = fakeProxy((sentences, n) => (n === 1 ? json({ error: 'busy' }, 503) : validFor(sentences)))
  const out = await aiGen(f).generate('k', doc, () => {})
  expect(f.generateCalls).toBe(2)
  expect(out.cards.every((c) => c.explanation)).toBe(true)
})

test('budget (503 budget) on chunk 1 stops calling the proxy; all chunks use classic cards', async () => {
  const f = fakeProxy(() => json({ error: 'budget' }, 503))
  const out = await aiGen(f, { retryDelayMs: 0 }).generate('k', bigDoc, () => {})
  expect(f.generateCalls).toBeLessThanOrEqual(2) // concurrency 2: at most the two in-flight calls
  expect(out.cards.length).toBeGreaterThan(0)
  expect(out.cards.every((c) => !c.explanation)).toBe(true)
})

test('bad-request on one chunk falls back to classic cards for that chunk only', async () => {
  const f = fakeProxy((sentences) => (sentences[0].id === 's0' ? json({ error: 'bad-request' }, 400) : validFor(sentences)))
  const out = await aiGen(f).generate('k', bigDoc, () => {})
  expect(f.generateCalls).toBe(5) // every chunk is still sent, the bad one once
  const first = new Set(f.calls.find((c) => c[0].id === 's0')!.map((x) => `k:${x.id}`))
  const inFirst = out.cards.filter((c) => first.has(c.sourceSentenceId!))
  const rest = out.cards.filter((c) => !first.has(c.sourceSentenceId!))
  expect(inFirst.length).toBeGreaterThan(0)
  expect(inFirst.every((c) => !c.explanation)).toBe(true)
  expect(rest.length).toBeGreaterThan(0)
  expect(rest.every((c) => c.explanation)).toBe(true)
})

test('session null -> no Gemini progress text', async () => {
  const seen: string[] = []
  await aiGen(fakeProxy(validFor), { session: Promise.resolve(null) }).generate('k', bigDoc, (p) => seen.push(p.text))
  expect(seen.length).toBeGreaterThan(0)
  expect(seen.some((t) => t.includes('Gemini'))).toBe(false)
})

test('session resolving to null -> classic output unchanged, no /generate calls', async () => {
  const f = fakeProxy(validFor)
  const out = await aiGen(f, { session: Promise.resolve(null) }).generate('k', doc, () => {})
  const classic = await classicGenerator.generate('k', doc, () => {})
  expect(f.generateCalls).toBe(0)
  const brief = (cs: typeof out.cards) => cs.map((c) => [c.id, c.type, c.prompt, c.answer, c.sourceSentenceId])
  expect(brief(out.cards)).toEqual(brief(classic.cards))
  expect(out.sentences).toEqual(classic.sentences)
  expect(out.summary).toEqual(classic.summary)
  expect(out.quizEnabled).toBe(classic.quizEnabled)
})

test('50-page document: at most 8 /generate calls, leftover gets classic cards, <= 400 cards', async () => {
  const f = fakeProxy(validFor)
  const out = await aiGen(f).generate('k', bigDistinctDoc(), () => {})
  // guard: the document really does overflow 8 chunks, so the leftover path is exercised
  expect(out.sentences.length).toBeGreaterThan(8 * 150)
  expect(f.generateCalls).toBe(8)
  expect(out.cards.length).toBeLessThanOrEqual(400)
  expect(out.cards.some((c) => !c.explanation)).toBe(true)
})

test('client drops proxy questions that fail validation (defense in depth)', async () => {
  const bad = { ...flash('s99999'), question: 'What does a made-up sentence say about cells?' } // id was never sent
  const noExplanation = { ...flash('s0'), question: 'Which organelle does the notes sentence zero describe?', explanation: 'short' }
  const f = fakeProxy((sentences) => json({ questions: [flash(sentences[0].id), bad, noExplanation] }))
  const out = await aiGen(f).generate('k', doc, () => {})
  expect(out.cards).toHaveLength(1)
  expect(out.cards[0].explanation).toBeTruthy()
  expect(out.cards[0].sourceSentenceId).toBe('k:s0')
})

test('mcq questions map to mcq cards and enable the quiz; flashcards map to cloze', async () => {
  const mcq = (id: string) => ({
    kind: 'mcq', question: `Which statement matches notes sentence ${id}?`, answer: 'Right one',
    distractors: ['Wrong one', 'Wrong two', 'Wrong three'], distractorExplanations: ['Not in the notes.', 'Not in the notes.', 'Not in the notes.'],
    explanation: 'The notes state this directly in the cited sentence.', hint: 'Recall the notes', sourceIds: [id],
  })
  const f = fakeProxy((sentences) => json({ questions: [mcq(sentences[0].id), flash(sentences[1].id)] }))
  const out = await aiGen(f).generate('k', doc, () => {})
  expect(out.cards.map((c) => c.type)).toEqual(['mcq', 'cloze'])
  expect(out.cards[0].distractors).toHaveLength(3)
  expect(out.cards[0].distractorExplanations).toHaveLength(3)
  expect(out.cards[0].distractorSources).toBeUndefined()
  expect(out.quizEnabled).toBe(true)
  expect(out.quizReason).toBeUndefined()
})

test('progress text names Google Gemini', async () => {
  const seen: Progress[] = []
  await aiGen(fakeProxy(validFor)).generate('k', bigDoc, (p) => seen.push(p))
  const cards = seen.filter((p): p is Extract<Progress, { step: 'cards' }> => p.step === 'cards' && p.text.includes('Gemini'))
  expect(cards.length).toBeGreaterThan(0)
  expect(cards[cards.length - 1].text).toBe(`Writing questions with Google Gemini (${cards.length} of ${cards.length})`)
  expect(cards[cards.length - 1].done).toBe(cards[cards.length - 1].total)
})
