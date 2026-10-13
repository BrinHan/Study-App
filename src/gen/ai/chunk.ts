import type { Sentence } from '../../lib/types'
import { REQ } from '../../../shared/quiz'

export const MAX_CHUNKS = 8
export const MAX_BODY_BYTES = 60_000 // proxy caps /generate bodies at 64 KiB
const enc = new TextEncoder()
const EMPTY_BODY = enc.encode(JSON.stringify({ sentences: [] })).length

/** Short id sent to the proxy (matches REQ.idPattern); the full id stays on the client. */
export const shortId = (s: Sentence) => `s${s.index}`

/** Greedy in-order split under the proxy's per-request limits, body size included. Whatever doesn't fit in maxChunks is leftover. */
export function chunkSentences(
  sentences: Sentence[],
  maxChars: number = REQ.maxTotalChars,
  maxSentences: number = REQ.maxSentences,
  maxChunks: number = MAX_CHUNKS,
  maxBytes: number = MAX_BODY_BYTES,
): { chunks: Sentence[][]; leftover: Sentence[] } {
  const chunks: Sentence[][] = []
  let cur: Sentence[] = []
  let chars = 0
  let bytes = EMPTY_BODY
  let used = 0 // sentences placed in closed chunks
  for (const s of sentences) {
    const size = enc.encode(JSON.stringify({ id: shortId(s), text: s.text })).length + 1 // + comma
    if (cur.length && (cur.length >= maxSentences || chars + s.text.length > maxChars || bytes + size > maxBytes)) {
      chunks.push(cur)
      used += cur.length
      cur = []
      chars = 0
      bytes = EMPTY_BODY
      if (chunks.length >= maxChunks) return { chunks, leftover: sentences.slice(used) }
    }
    cur.push(s)
    chars += s.text.length
    bytes += size
  }
  if (cur.length) { chunks.push(cur); used += cur.length }
  return { chunks, leftover: sentences.slice(used) }
}
