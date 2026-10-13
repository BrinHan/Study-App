import { expect, test } from 'vitest'
import type { Sentence } from '../../lib/types'
import { chunkSentences, shortId } from './chunk'

const sent = (i: number, text: string): Sentence => ({ id: `k:s${i}`, kitId: 'k', text, paragraph: 1, index: i, topic: 't' })

test('splits by char and sentence limits, keeps order, caps at maxChunks with leftover', () => {
  const s = Array.from({ length: 10 }, (_, i) => sent(i, 'x'.repeat(100)))
  const r = chunkSentences(s, 250, 150, 3)
  expect(r.chunks.map((c) => c.length)).toEqual([2, 2, 2])
  expect(r.leftover.map((x) => x.index)).toEqual([6, 7, 8, 9])
})

test('sentence limit closes a chunk before the char limit', () => {
  const s = Array.from({ length: 7 }, (_, i) => sent(i, 'x'))
  const r = chunkSentences(s, 1000, 3, 8)
  expect(r.chunks.map((c) => c.length)).toEqual([3, 3, 1])
  expect(r.leftover).toEqual([])
})

test('empty input and exact fit', () => {
  expect(chunkSentences([])).toEqual({ chunks: [], leftover: [] })
  const s = Array.from({ length: 4 }, (_, i) => sent(i, 'x'.repeat(100)))
  const r = chunkSentences(s, 200, 150, 2)
  expect(r.chunks.map((c) => c.length)).toEqual([2, 2])
  expect(r.leftover).toEqual([])
})

test('shortId uses the sentence index', () => {
  expect(shortId(sent(12, 'x'))).toBe('s12')
})

test('chunks stay under the 60000-byte request body with long CJK sentences', () => {
  const s = Array.from({ length: 60 }, (_, i) => sent(i, '細'.repeat(900))) // 2700 bytes each; the char limit alone allows 26 per chunk
  const r = chunkSentences(s)
  const enc = new TextEncoder()
  for (const c of r.chunks) expect(enc.encode(JSON.stringify({ sentences: c.map((x) => ({ id: shortId(x), text: x.text })) })).length).toBeLessThanOrEqual(60000)
  expect(r.chunks.flat().length + r.leftover.length).toBe(60)
  expect(r.chunks[0].length).toBeGreaterThan(1)
})
