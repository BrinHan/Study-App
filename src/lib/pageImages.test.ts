import { expect, test } from 'vitest'
import { fitWithin, pagesNeedingOcr } from './pageImages'

test('pagesNeedingOcr picks pages under 30 non-space chars', () => {
  expect(pagesNeedingOcr([['x'.repeat(40)], ['  a b  '], [], ['y'.repeat(30)]])).toEqual([2, 3])
})

test('fitWithin keeps aspect, never upscales', () => {
  expect(fitWithin(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 })
  expect(fitWithin(3000, 4000, 1600)).toEqual({ w: 1200, h: 1600 })
  expect(fitWithin(800, 600, 1600)).toEqual({ w: 800, h: 600 })
})
