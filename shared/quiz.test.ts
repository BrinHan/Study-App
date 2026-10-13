import { expect, test } from 'vitest'
import { cleanText, validateQuestions } from './quiz'

const mcq = (o: Record<string, unknown>) => ({
  kind: 'mcq',
  question: "Which organelle produces most of a cell's ATP through aerobic respiration?",
  answer: 'mitochondrion',
  distractors: ['chloroplast', 'ribosome', 'Golgi apparatus'],
  distractorExplanations: ['Chloroplasts make sugar in photosynthesis.', 'Ribosomes build proteins, not ATP.', 'The Golgi sorts and ships proteins.'],
  explanation: 'The mitochondrion runs the electron transport chain that makes most ATP.',
  hint: 'Think about the powerhouse.',
  sourceIds: ['s3'],
  ...o,
})
const ids = new Set(['s1', 's2', 's3'])

test('cleanText strips control chars, markdown emphasis and extra whitespace', () => {
  expect(cleanText('  **ATP**\u0007 is   `made`\n here ')).toBe('ATP is made here')
  expect(cleanText(42)).toBe('')
})
test('keeps a valid mcq and a valid flashcard', () => {
  const out = validateQuestions({ questions: [mcq({}), { kind: 'flashcard', question: 'Why does the inner membrane fold into cristae?', answer: 'Folding increases surface area for the electron transport chain.', explanation: 'More membrane means more ATP synthase and transport proteins.', hint: 'Surface area', sourceIds: ['s1'] }] }, ids)
  expect(out.map((q) => q.kind)).toEqual(['mcq', 'flashcard'])
})
test('accepts a bare array as well as {questions}', () => { expect(validateQuestions([mcq({})], ids)).toHaveLength(1) })
test('drops non-objects, unknown kinds and free text (prompt-injection output)', () => {
  expect(validateQuestions('Sure! Here is a poem...', ids)).toEqual([])
  expect(validateQuestions({ questions: [{ kind: 'poem', text: 'x' }, null, 7] }, ids)).toEqual([])
})
test('drops when a sourceId is missing, unknown, or there are more than 3', () => {
  expect(validateQuestions([mcq({ sourceIds: [] })], ids)).toEqual([])
  expect(validateQuestions([mcq({ sourceIds: ['s9'] })], ids)).toEqual([])
  expect(validateQuestions([mcq({ sourceIds: ['s1', 's2', 's3', 's1'] })], ids)).toEqual([])
})
test('drops mcq without exactly 3 distractors or with duplicate choices (case-insensitive)', () => {
  expect(validateQuestions([mcq({ distractors: ['a', 'b'] })], ids)).toEqual([])
  expect(validateQuestions([mcq({ distractors: ['Mitochondrion', 'ribosome', 'Golgi apparatus'] })], ids)).toEqual([])
})
test('drops when the answer appears in the question', () => {
  expect(validateQuestions([mcq({ question: 'The mitochondrion makes ATP. Which organelle makes ATP?' })], ids)).toEqual([])
})
test('drops "all/none of the above" choices', () => {
  expect(validateQuestions([mcq({ distractors: ['chloroplast', 'ribosome', 'None of the above'] })], ids)).toEqual([])
})
test('drops an mcq whose answer is over 40 chars and over 2.5x the longest distractor', () => {
  expect(validateQuestions([mcq({ answer: 'the double-membraned mitochondrion organelle', distractors: ['ER', 'ribosome', 'vacuole'] })], ids)).toEqual([])
})
test('drops out-of-range lengths', () => {
  expect(validateQuestions([mcq({ question: 'Short?' })], ids)).toEqual([])
  expect(validateQuestions([mcq({ explanation: 'Too short.' })], ids)).toEqual([])
})
test('dedupes by normalized question text and caps at 25', () => {
  expect(validateQuestions([mcq({}), mcq({ question: (mcq({}).question as string).toUpperCase() })], ids)).toHaveLength(1)
  const many = Array.from({ length: 30 }, (_, i) => mcq({ question: `Question number ${i} about cellular respiration?` }))
  expect(validateQuestions(many, ids)).toHaveLength(25)
})
test('keeps distinct non-Latin questions (dedupe is not ASCII-only)', () => {
  const a = mcq({ question: '미토콘드리아는 세포에서 어떤 역할을 하나요?', answer: 'ATP 생산', distractors: ['단백질 합성', '빛 흡수', '유전 정보 저장'] })
  const b = mcq({ question: '리보솜은 세포에서 어떤 역할을 하나요?', answer: '단백질 합성', distractors: ['ATP 생산', '빛 흡수', '유전 정보 저장'] })
  expect(validateQuestions([a, b], ids)).toHaveLength(2)
})
test('keeps Devanagari questions that differ only by a combining mark (कि vs की)', () => {
  const d = { answer: 'समय', distractors: ['स्थान', 'भार', 'ऊर्जा'] }
  const a = mcq({ ...d, question: 'कि शब्द का अर्थ क्या होता है, बताइए?' })
  const b = mcq({ ...d, question: 'की शब्द का अर्थ क्या होता है, बताइए?' })
  expect(validateQuestions([a, b], ids)).toHaveLength(2)
})
