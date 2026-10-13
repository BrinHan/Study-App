// Uncertainty markers from pass 1: parse into id'd placeholders for clarify, then apply resolutions to the markers only.
import type { Resolution } from '../../../shared/scan'

export interface Marker { id: string; page: number; kind: 'w' | 's'; raw: string; guesses: string[] }
export interface ParsedPage { page: number; text: string }

const MARKER = /⟦\?([ws]):([^|⟧⟦]{1,40})((?:\|[^|⟧⟦]{1,80}){0,3})⟧/g
const PLACEHOLDER = /⟦(u\d+):([^⟦⟧]*)⟧/g

// Brackets left over (malformed, unknown kind, or typed by the model) are removed and the inner text kept.
const strip = (s: string) => s.replace(/⟦\?[wsx]:/g, '').replace(/[⟦⟧]/g, '')

export function parseMarkers(pages: { page: number; text: string }[]): { pages: ParsedPage[]; markers: Marker[] } {
  const markers: Marker[] = []
  const out = pages.map(({ page, text }) => {
    let last = 0
    let res = ''
    for (const m of text.matchAll(MARKER)) {
      const id = `u${markers.length + 1}`
      markers.push({ id, page, kind: m[1] as 'w' | 's', raw: m[2], guesses: m[3] ? m[3].slice(1).split('|') : [] })
      res += strip(text.slice(last, m.index)) + `⟦${id}:${m[2]}⟧`
      last = m.index! + m[0].length
    }
    return { page, text: res + strip(text.slice(last)) }
  })
  return { pages: out, markers }
}

export function applyResolutions(pages: ParsedPage[], markers: Marker[], res: Map<string, Resolution>): { page: number; text: string }[] {
  const byId = new Map(markers.map((m) => [m.id, m]))
  return pages.map(({ page, text }) => {
    const annotated = new Set<string>()
    return {
      page,
      text: text.replace(PLACEHOLDER, (_, id: string, raw: string) => {
        const m = byId.get(id)
        if (!m) return raw
        const r = res.get(id)
        if (m.kind === 'w') return r ? (r.confidence === 'low' ? `${r.value} [?]` : r.value) : `${m.raw} [?]`
        if (!r || annotated.has(m.raw)) return m.raw
        annotated.add(m.raw)
        return r.confidence === 'low' ? `${m.raw} (possibly ${r.value})` : `${m.raw} (${r.value})`
      }),
    }
  })
}
