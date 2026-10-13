import { cleanText } from './quiz'

export const SCAN = { maxImageB64: 1_900_000, maxPageText: 8000, maxMarkersPerPage: 200, maxClarifyChars: 24000, maxClarifyItems: 100, maxValue: 80, maxWordValue: 40 } as const
export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp'
export interface TranscribeRequest { image: string; mimeType: ImageMime }
export interface TranscribeResponse { text: string; legible: boolean }
export interface ClarifyItem { id: string; kind: 'w' | 's'; raw: string; guesses: string[] }
export interface ClarifyRequest { text: string; items: ClarifyItem[] }
export interface Resolution { id: string; value: string; confidence: 'high' | 'medium' | 'low' }
export interface ClarifyResponse { resolutions: Resolution[] }

export const IMAGE_MIMES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp']
export const ITEM_ID = /^u\d{1,4}$/
const CONFIDENCE: readonly string[] = ['high', 'medium', 'low']

// Like cleanText but keeps line structure (max one blank line)
export function cleanMultiline(s: unknown): string {
  if (typeof s !== 'string') return ''
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .split('\n')
    .map((l) => l.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function sniffImage(b: Uint8Array): ImageMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  const at = (o: number, s: string) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0))
  if (b.length >= 12 && at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp'
  return null
}

export function validateTranscription(raw: unknown): TranscribeResponse | null {
  if (!raw || typeof raw !== 'object') return null
  const { text, legible } = raw as { text?: unknown; legible?: unknown }
  if (typeof legible !== 'boolean' || typeof text !== 'string') return null
  if (!legible) return { text: '', legible: false }
  const clean = cleanMultiline(text)
  if (clean.length > SCAN.maxPageText) return null
  if ((clean.match(/⟦\??/g)?.length ?? 0) > SCAN.maxMarkersPerPage) return null
  return { text: clean, legible }
}

export function validateResolutions(raw: unknown, items: ClarifyItem[]): Resolution[] {
  const list = (raw as { resolutions?: unknown } | null)?.resolutions
  if (!Array.isArray(list)) return []
  const kinds = new Map(items.map((i) => [i.id, i.kind]))
  const seen = new Set<string>()
  const out: Resolution[] = []
  for (const r of list) {
    if (!r || typeof r !== 'object') continue
    const { id, value, confidence } = r as { id?: unknown; value?: unknown; confidence?: unknown }
    if (typeof id !== 'string' || !kinds.has(id) || seen.has(id)) continue
    seen.add(id)
    const v = cleanText(value)
    if (v.length < 1 || v.length > SCAN.maxValue) continue
    if (kinds.get(id) === 'w' && (v.length > SCAN.maxWordValue || v.split(' ').length > 4)) continue
    if (typeof confidence !== 'string' || !CONFIDENCE.includes(confidence)) continue
    out.push({ id, value: v, confidence: confidence as Resolution['confidence'] })
  }
  return out
}
