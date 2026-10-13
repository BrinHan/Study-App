import { expect, test } from 'vitest'
import { cleanMultiline, sniffImage, validateResolutions, validateTranscription, type ClarifyItem } from './scan'

test('cleanMultiline keeps single and double newlines and collapses 3+', () => {
  expect(cleanMultiline('a\nb')).toBe('a\nb')
  expect(cleanMultiline('a\n\nb')).toBe('a\n\nb')
  expect(cleanMultiline('a\n\n\n\nb')).toBe('a\n\nb')
  expect(cleanMultiline('a\u0000  b\t\tc\r\nd **x**')).toBe('a b c\nd x')
  expect(cleanMultiline(5)).toBe('')
})

test('sniffImage recognises magic bytes', () => {
  expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg')
  expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe('image/png')
  expect(sniffImage(new TextEncoder().encode('RIFF\u0001\u0002\u0003\u0004WEBP'))).toBe('image/webp')
  expect(sniffImage(new TextEncoder().encode('RIFF\u0001\u0002\u0003\u0004WAVE'))).toBeNull()
  expect(sniffImage(new TextEncoder().encode('%PDF-1.7 abcd'))).toBeNull()
  expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull()
})

test('validateTranscription', () => {
  expect(validateTranscription({ text: 'a\nb', legible: true })).toEqual({ text: 'a\nb', legible: true })
  expect(validateTranscription({ text: 'junk', legible: false })).toEqual({ text: '', legible: false })
  expect(validateTranscription({ text: '⟦?w:a|b⟧ '.repeat(200), legible: true })).not.toBeNull()
  expect(validateTranscription({ text: '⟦?w:a|b⟧ '.repeat(201), legible: true })).toBeNull()
  expect(validateTranscription({ text: 'x', legible: 'yes' })).toBeNull()
  expect(validateTranscription({ text: 5, legible: true })).toBeNull()
  expect(validateTranscription({ text: 'x'.repeat(8001), legible: true })).toBeNull()
  expect(validateTranscription('text')).toBeNull()
  expect(validateTranscription(null)).toBeNull()
})

const items: ClarifyItem[] = [{ id: 'u1', kind: 'w', raw: 'x', guesses: [] }, { id: 'u2', kind: 's', raw: 'E', guesses: [] }]
test('validateResolutions filters', () => {
  const r = (id: string, value: unknown, confidence: unknown = 'high') => ({ id, value, confidence })
  expect(validateResolutions({ resolutions: [r('u1', 'enthalpy'), r('u2', 'energy of sublimation', 'low')] }, items)).toEqual([r('u1', 'enthalpy'), r('u2', 'energy of sublimation', 'low')])
  expect(validateResolutions({ resolutions: [r('u9', 'a')] }, items)).toEqual([])
  expect(validateResolutions({ resolutions: [r('u1', 'first'), r('u1', 'second')] }, items)).toEqual([r('u1', 'first')])
  expect(validateResolutions({ resolutions: [r('u1', '  ')] }, items)).toEqual([])
  expect(validateResolutions({ resolutions: [r('u1', 'one two three four five')] }, items)).toEqual([])
  expect(validateResolutions({ resolutions: [r('u2', 'one two three four five six')] }, items)).toHaveLength(1)
  expect(validateResolutions({ resolutions: [r('u1', 'ok', 'certain')] }, items)).toEqual([])
  expect(validateResolutions({ resolutions: [r('u2', 'x'.repeat(81))] }, items)).toEqual([])
  expect(validateResolutions({ resolutions: [r('u1', 'x'.repeat(41))] }, items)).toEqual([])
  expect(validateResolutions('nope', items)).toEqual([])
})
