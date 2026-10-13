import { expect, test } from 'vitest'
import { classifyPicked, decidePdfScan } from './importer'

test('one pdf', () => { expect(classifyPicked([{ name: 'a.pdf', type: 'application/pdf' }])).toEqual({ kind: 'pdf', index: 0 }) })
test('photos sorted numerically by name', () => { expect(classifyPicked([{ name: 'IMG_10.jpg', type: 'image/jpeg' }, { name: 'IMG_2.jpg', type: 'image/jpeg' }])).toEqual({ kind: 'photos', order: [1, 0] }) })
test('heic with empty type counts as a photo', () => { expect(classifyPicked([{ name: 'n.HEIC', type: '' }]).kind).toBe('photos') })
test('pdf + photo, two pdfs, or nothing is invalid', () => {
  expect(classifyPicked([{ name: 'a.pdf', type: 'application/pdf' }, { name: 'b.jpg', type: 'image/jpeg' }])).toEqual({ kind: 'invalid' })
  expect(classifyPicked([{ name: 'a.pdf', type: 'application/pdf' }, { name: 'b.pdf', type: 'application/pdf' }])).toEqual({ kind: 'invalid' })
  expect(classifyPicked([])).toEqual({ kind: 'invalid' })
})

const base = { images: 0, skipped: 0, scannedLooking: false, configured: true, hasToken: true }
test('decidePdfScan: typed PDFs', () => {
  expect(decidePdfScan(base)).toBe('typed')
  expect(decidePdfScan({ ...base, configured: false })).toBe('typed')
})
test('decidePdfScan: nothing rendered but scanned-looking', () => {
  expect(decidePdfScan({ ...base, scannedLooking: true })).toBe('err-scanned')
  expect(decidePdfScan({ ...base, scannedLooking: true, configured: false })).toBe('err-offline')
})
test('decidePdfScan: too many low-text pages', () => {
  expect(decidePdfScan({ ...base, images: 20, skipped: 3, scannedLooking: true })).toBe('err-too-many')
  expect(decidePdfScan({ ...base, images: 20, skipped: 3 })).toBe('typed')
})
test('decidePdfScan: AI reading, required only for scanned-looking PDFs', () => {
  expect(decidePdfScan({ ...base, images: 4, scannedLooking: true })).toBe('scan-required')
  expect(decidePdfScan({ ...base, images: 2 })).toBe('scan-optional')
})
test('decidePdfScan: no token fails scanned PDFs but falls back to text for typed ones', () => {
  expect(decidePdfScan({ ...base, images: 4, scannedLooking: true, hasToken: false })).toBe('err-browser')
  expect(decidePdfScan({ ...base, images: 2, hasToken: false })).toBe('typed')
})
test('decidePdfScan: no token only matters once there are pages to read', () => {
  expect(decidePdfScan({ ...base, hasToken: false })).toBe('typed')
  expect(decidePdfScan({ ...base, scannedLooking: true, hasToken: false })).toBe('err-scanned')
  expect(decidePdfScan({ ...base, images: 20, skipped: 3, scannedLooking: true, hasToken: false })).toBe('err-too-many')
  expect(decidePdfScan({ ...base, images: 20, skipped: 3, hasToken: false })).toBe('typed')
})
