import { expect, test } from 'vitest'
import text from '../../samples/cell-biology.md?raw'
import { classicGenerator } from './generator'

test('classic generator makes cards and a summary from the sample notes', async () => {
  const out = await classicGenerator.generate('k1', { kind: 'paste', title: 'Cells', pages: [text.split(/\r?\n/)] }, () => {})
  expect(out.cards.length).toBeGreaterThan(10)
  expect(out.cards.every((c) => c.sourceSentenceId?.startsWith('k1:s'))).toBe(true)
  expect(out.summary.length).toBeGreaterThanOrEqual(4)
  expect(out.quizEnabled).toBe(true)
})
