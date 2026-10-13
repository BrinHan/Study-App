// Pass 1 (per-page transcription with uncertainty markers) and pass 2 (whole-document clarify), then the final text.
import { SCAN, type ClarifyItem, type ImageMime, type Resolution } from '../../../shared/scan'
import type { PageImage } from '../../lib/pageImages'
import type { Progress } from '../generator'
import { applyResolutions, parseMarkers, type Marker, type ParsedPage } from './markers'
import { callWithRetry, runPool, type Stop } from './pool'
import { ProxyError, type ProxyClient } from './proxyClient'

const CONCURRENCY = 2
const MAX_CLARIFY_BYTES = 60_000 // proxy caps /clarify bodies at 64 KiB
const SLICE = 0x8000
const enc = new TextEncoder()

export type ScanFailReason = 'unavailable' | 'busy' | 'illegible'

export class ScanFailed extends Error {
  reason: ScanFailReason
  constructor(reason: ScanFailReason) {
    super(reason)
    this.reason = reason
  }
}

const FAIL_MESSAGES: Record<ScanFailReason, string> = {
  unavailable: 'AI reading isn’t available right now. Try again later, or paste the text instead.',
  busy: 'Margin has reached its AI reading limit for now. Try again in an hour, or paste the text instead.',
  illegible: 'Margin couldn’t read any notes in these pages. Make sure the photos are in focus and well lit, or paste the text instead.',
}
export const scanFailedMessage = (r: ScanFailReason) => FAIL_MESSAGES[r]

const LIMIT_CODES = new Set<string>(['budget', 'rate-limited', 'busy'])
const lostLine = (page: number) => `[Page ${page} couldn’t be read. Import it again to add it.]`

export async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += SLICE) bin += String.fromCharCode(...bytes.subarray(i, i + SLICE))
  return btoa(bin)
}

const itemsIn = (text: string, markers: Marker[]): ClarifyItem[] =>
  markers.filter((m) => text.includes(`⟦${m.id}:`)).map(({ id, kind, raw, guesses }) => ({ id, kind, raw, guesses }))

const fits = (text: string, markers: Marker[]) => {
  const items = itemsIn(text, markers)
  return text.length <= SCAN.maxClarifyChars && items.length <= SCAN.maxClarifyItems && enc.encode(JSON.stringify({ text, items })).length <= MAX_CLARIFY_BYTES
}

/** Longest prefix of text that fits, never ending inside a placeholder. */
function truncateToFit(text: string, markers: Marker[]): string {
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (fits(text.slice(0, mid), markers)) lo = mid
    else hi = mid - 1
  }
  const cut = text.slice(0, lo)
  const open = cut.lastIndexOf('⟦')
  return open > cut.lastIndexOf('⟧') ? cut.slice(0, open) : cut
}

// All pages (marker-free ones too) are sent as context, greedily packed in page order.
function clarifyChunks(pages: ParsedPage[], markers: Marker[]): { text: string; items: ClarifyItem[] }[] {
  const groups: string[] = []
  let cur = ''
  for (const p of pages) {
    const joined = cur ? `${cur}\n\n${p.text}` : p.text
    if (fits(joined, markers)) { cur = joined; continue }
    if (cur) groups.push(cur)
    cur = fits(p.text, markers) ? p.text : truncateToFit(p.text, markers)
  }
  if (cur) groups.push(cur)
  return groups.map((text) => ({ text, items: itemsIn(text, markers) })).filter((c) => c.items.length)
}

export async function transcribePages(o: {
  images: PageImage[]; client: ProxyClient; session: Promise<string | null>; progress: (p: Progress) => void
  retryDelayMs?: number; sleep?: (ms: number) => Promise<void>
}): Promise<{ pages: { page: number; text: string }[]; transcript: string; failedPages: number[] }> {
  const session = await o.session
  if (session === null) throw new ScanFailed('unavailable')
  const images = [...o.images].sort((a, b) => a.page - b.page)
  const results: ({ page: number; text: string } | null)[] = images.map(() => null)
  const errors: (string | null)[] = images.map(() => null) // error code per lost page; illegible pages aren't lost
  const stop: Stop = { stopped: false }
  let answered = 0
  let finished = 0

  await runPool(images, CONCURRENCY, async (img, i) => {
    if (stop.stopped) errors[i] = stop.code ?? 'stopped'
    else {
      try {
        const image = await blobToBase64(img.blob)
        const r = await callWithRetry(() => o.client.transcribe(session, { image, mimeType: img.mimeType as ImageMime }), o.retryDelayMs ?? 2000, stop, o.sleep)
        answered++
        if (r.legible && r.text) results[i] = { page: img.page, text: r.text }
      } catch (e) {
        errors[i] = e instanceof ProxyError ? e.code : 'error'
      }
    }
    o.progress({ step: 'read', text: `Reading handwriting with Google Gemini (${++finished} of ${images.length})` })
  })

  const read = results.filter((r): r is { page: number; text: string } => r !== null)
  if (!read.length) {
    // any answered page means the notes were illegible; otherwise only limits -> busy, anything else -> unavailable
    const limited = errors.every((c) => c !== null && LIMIT_CODES.has(c))
    throw new ScanFailed(answered ? 'illegible' : limited ? 'busy' : 'unavailable')
  }

  const { pages: parsed, markers } = parseMarkers(read)
  const resolutions = new Map<string, Resolution>()
  const chunks = markers.length ? clarifyChunks(parsed, markers) : []
  if (chunks.length) {
    o.progress({ step: 'read', text: 'Checking unclear words with Google Gemini' })
    await runPool(chunks, CONCURRENCY, async (c) => {
      try {
        for (const r of await o.client.clarify(session, c)) resolutions.set(r.id, r)
      } catch { /* unresolved rules apply */ }
    })
  }

  const pages = applyResolutions(parsed, markers, resolutions)
  const byPage = new Map(pages.map((p) => [p.page, p.text]))
  const blocks = images.flatMap((img, i) =>
    errors[i] !== null ? [lostLine(img.page)] : byPage.has(img.page) ? [`--- Page ${img.page} ---\n${byPage.get(img.page)}`] : [])
  const failedPages = images.filter((_, i) => errors[i] !== null).map((img) => img.page)
  return { pages, transcript: blocks.join('\n\n'), failedPages }
}
