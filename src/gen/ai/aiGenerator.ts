// AI card generator: classic pass first (sentences, summary, fallback cards), then Gemini questions per chunk via the proxy.
import type { Sentence, StudyCard } from '../../lib/types'
import type { AiQuestion } from '../../../shared/quiz'
import { classicGenerator, type CardGenerator } from '../generator'
import { chunkSentences, shortId } from './chunk'
import { callWithRetry, runPool, type Stop } from './pool'
import type { ProxyClient } from './proxyClient'
import { questionsToCards } from './toCards'

const CONCURRENCY = 2
const MAX_CARDS = 400

export function createAiGenerator(opts: { client: ProxyClient; session: Promise<string | null>; retryDelayMs?: number; sleep?: (ms: number) => Promise<void> }): CardGenerator {
  const retryDelay = opts.retryDelayMs ?? 2000
  return {
    name: 'Google Gemini via proxy, classic fallback',
    async generate(kitId, doc, progress) {
      const base = await classicGenerator.generate(kitId, doc, progress)
      const session = await opts.session
      if (session === null) return base // no AI: classic output and progress only
      const { chunks, leftover } = chunkSentences(base.sentences)
      const now = new Date()
      const byShortId = new Map<string, Sentence>(base.sentences.map((s) => [shortId(s), s]))

      const results: (StudyCard[] | null)[] = chunks.map(() => null)
      const stop: Stop = { stopped: false }
      let finished = 0

      const callChunk = (chunk: Sentence[]): Promise<AiQuestion[]> => {
        const payload = chunk.map((s) => ({ id: shortId(s), text: s.text }))
        return callWithRetry(() => opts.client.generate(session, payload), retryDelay, stop, opts.sleep)
      }

      // limit and auth errors stop starting new chunks (in-flight ones finish); other errors lose one chunk
      await runPool(chunks, CONCURRENCY, async (chunk, i) => {
        if (!stop.stopped) {
          try {
            const qs = await callChunk(chunk)
            if (qs.length) results[i] = questionsToCards(kitId, qs, byShortId, now)
          } catch { /* this chunk falls back to classic cards */ }
        }
        progress({ step: 'cards', text: `Writing questions with Google Gemini (${++finished} of ${chunks.length})`, done: finished, total: chunks.length })
      })

      const classicFor = (list: Sentence[]) => {
        const ids = new Set(list.map((s) => s.id))
        return base.cards.filter((c) => c.sourceSentenceId !== undefined && ids.has(c.sourceSentenceId))
      }
      const cards = [
        ...chunks.flatMap((c, i) => (results[i]?.length ? results[i]! : classicFor(c))),
        ...classicFor(leftover),
      ].slice(0, MAX_CARDS).map((c, n) => ({ ...c, id: `${kitId}:c${n}` }))

      const quizEnabled = base.quizEnabled || cards.some((c) => c.type === 'mcq')
      return { ...base, cards, quizEnabled, quizReason: quizEnabled ? undefined : base.quizReason }
    },
  }
}
