import { expect, test } from 'vitest'
import type { Resolution } from '../../../shared/scan'
import { applyResolutions, parseMarkers, type Marker } from './markers'

const res = (markers: Marker[], value: string, confidence: Resolution['confidence']) =>
  new Map<string, Resolution>(markers.map((m) => [m.id, { id: m.id, value, confidence }]))

test('symbol resolved high: first occurrence annotated, later bare', () => {
  const { pages, markers } = parseMarkers([{ page: 1, text: 'Sublimation: ⟦?s:E|energy of sublimation|electric field⟧ = ΔH. Then ⟦?s:E|energy of sublimation⟧ rises.' }])
  const r = (m: Marker) => [m.id, { id: m.id, value: 'energy of sublimation', confidence: 'high' as const }] as const
  expect(applyResolutions(pages, markers, new Map(markers.map(r)))[0].text).toBe('Sublimation: E (energy of sublimation) = ΔH. Then E rises.')
})

test('word high and medium confidence use the resolved value', () => {
  const { pages, markers } = parseMarkers([{ page: 1, text: 'The ⟦?w:mitochondria|mitochandria⟧ makes ATP' }])
  expect(applyResolutions(pages, markers, res(markers, 'mitochondria', 'high'))[0].text).toBe('The mitochondria makes ATP')
  expect(applyResolutions(pages, markers, res(markers, 'mitochondria', 'medium'))[0].text).toBe('The mitochondria makes ATP')
})

test('word low confidence keeps a visible [?]', () => {
  const { pages, markers } = parseMarkers([{ page: 1, text: 'The ⟦?w:mitochondria|mitochandria⟧ makes ATP' }])
  expect(applyResolutions(pages, markers, res(markers, 'mitochondria', 'low'))[0].text).toBe('The mitochondria [?] makes ATP')
})

test('unresolved: word -> raw + [?], symbol -> bare', () => {
  const { pages, markers } = parseMarkers([{ page: 1, text: 'A ⟦?w:mitochandria|mitochondria⟧ and ⟦?s:E|energy⟧ and ⟦?w:zzz⟧' }])
  expect(applyResolutions(pages, markers, new Map())[0].text).toBe('A mitochandria [?] and E and zzz [?]')
})

test('symbol low -> "k (possibly rate constant)"', () => {
  const { pages, markers } = parseMarkers([{ page: 1, text: 'rate = ⟦?s:k|rate constant⟧ [A]' }])
  expect(applyResolutions(pages, markers, res(markers, 'rate constant', 'low'))[0].text).toBe('rate = k (possibly rate constant) [A]')
})

test('placeholders carry ids and raw for clarify', () => {
  const { pages, markers } = parseMarkers([{ page: 1, text: 'Sublimation: ⟦?s:E|energy of sublimation|electric field⟧ = ΔH' }])
  expect(pages[0].text).toContain('⟦u1:E⟧')
  expect(markers[0]).toEqual({ id: 'u1', page: 1, kind: 's', raw: 'E', guesses: ['energy of sublimation', 'electric field'] })
})

test('malformed and unknown markers are stripped to inner text', () => {
  const { pages, markers } = parseMarkers([{ page: 1, text: 'a ⟦?w:abc b ⟦?x:zz⟧ c ⟧' }])
  expect(markers).toEqual([])
  expect(applyResolutions(pages, [], new Map())[0].text).toBe('a abc b zz c ')
})

test('ids are unique across pages and annotation is per page', () => {
  const { pages, markers } = parseMarkers([
    { page: 1, text: 'x ⟦?s:E|energy⟧' },
    { page: 2, text: 'y ⟦?s:E|energy⟧ z ⟦?w:cat|cot⟧' },
  ])
  expect(markers.map((m) => m.id)).toEqual(['u1', 'u2', 'u3'])
  expect(markers.map((m) => m.page)).toEqual([1, 2, 2])
  const out = applyResolutions(pages, markers, res(markers, 'energy', 'high'))
  expect(out[0].text).toBe('x E (energy)')
  expect(out[1].text).toBe('y E (energy) z energy')
})

test('placeholder text typed by the model outside markers is not trusted', () => {
  const { pages, markers } = parseMarkers([{ page: 1, text: 'sneaky ⟦u9:evil⟧ ok' }])
  expect(markers).toEqual([])
  expect(applyResolutions(pages, markers, new Map())[0].text).toBe('sneaky u9:evil ok')
})
