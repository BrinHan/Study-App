// Main-thread side of an import: reads the file, starts the worker, tracks progress and errors.
// One import runs at a time; screens subscribe to see it.
import type { SourceDoc } from '../gen/generator'
import type { WorkerJob, WorkerMsg } from '../worker'
import { deleteKit, putKit, uid, isQuotaError, StorageError } from './db'
import type { Kit } from './types'
import { notifyDataChanged } from './hooks'
import { mb } from '../ui'
import { AI_PROXY_URL, TURNSTILE_SITEKEY, aiConfigured } from './config'
import { getTurnstileToken } from './turnstile'
import { OCR, ScanError, canvasToJpeg, pagesNeedingOcr, photoToPage, type PageImage } from './pageImages'

export const MAX_PDF_BYTES = 10 * 1024 * 1024
export const MIN_PASTE_WORDS = 20
export const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0)

export type ImportErrorCode =
  | 'too-big' | 'not-pdf' | 'password' | 'scanned' | 'too-little' | 'empty-paste' | 'storage-full' | 'storage-blocked' | 'unknown'

export interface ImportError { code: ImportErrorCode; message: string }

export type StepState = 'todo' | 'active' | 'done'
export interface ImportState {
  kitId: string
  title: string
  source: 'pdf' | 'paste'
  steps: { key: 'read' | 'key' | 'cards' | 'summary'; label: string; state: StepState }[]
  status: 'running' | 'done' | 'error' | 'cancelled'
  error?: ImportError
  result?: { cards: number; quizEnabled: boolean; ms: number }
}

let current: ImportState | null = null
let worker: Worker | null = null
const listeners = new Set<(s: ImportState | null) => void>()

export const getImport = () => current
export function subscribeImport(fn: (s: ImportState | null) => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
function set(s: ImportState | null) {
  current = s
  listeners.forEach((fn) => fn(s))
}
function update(patch: Partial<ImportState>) {
  if (current) set({ ...current, ...patch })
}
function stepTo(key: ImportState['steps'][number]['key'], label: string) {
  if (!current) return
  const idx = current.steps.findIndex((s) => s.key === key)
  update({ steps: current.steps.map((s, i) => (i < idx ? { ...s, state: 'done' } : i === idx ? { ...s, label, state: 'active' } : s)) })
}

export function dismissImport() {
  if (current?.status !== 'running') set(null)
}

const sim = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('sim') : null

async function fail(kitId: string, error: ImportError) {
  if (current?.kitId !== kitId) { // a late error from a cancelled import must not touch the newer one
    try { await deleteKit(kitId) } catch { /* already gone */ }
    return
  }
  worker?.terminate()
  worker = null
  try { await deleteKit(kitId) } catch { /* storage itself may be the problem */ }
  update({ status: 'error', error })
  notifyDataChanged()
}

export async function cancelImport() {
  if (!current || current.status !== 'running') return
  const id = current.kitId
  worker?.terminate()
  worker = null
  set(null)
  await deleteKit(id).catch(() => {})
  notifyDataChanged()
}

/** Read text lines per page with pdf.js, which is loaded only when a PDF is imported. */
async function readPdf(file: File, kitId: string, onPage: (i: number, n: number) => void, opts: { render?: boolean } = {}): Promise<{ pages: string[][]; images: PageImage[]; skippedOcrPages: number } | null> {
  const render = opts.render ?? true
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const data = new Uint8Array(await file.arrayBuffer())
  const task = pdfjs.getDocument({ data })
  const pdf = await task.promise
  const pages: string[][] = []
  const images: PageImage[] = []
  let lowText = 0
  let skippedOcrPages = 0
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      if (current?.kitId !== kitId) return null // cancelled
      onPage(i, pdf.numPages)
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const lines: string[] = []
      let line = ''
      let lastY: number | null = null
      for (const item of content.items) {
        if (!('str' in item)) continue
        const y = item.transform[5]
        if (lastY !== null && Math.abs(y - lastY) > 2 && line) { lines.push(line); line = '' }
        line += line && !line.endsWith(' ') && item.str && !item.str.startsWith(' ') ? ' ' + item.str : item.str
        lastY = y
        if (item.hasEOL) { lines.push(line); line = ''; lastY = null }
      }
      if (line) lines.push(line)
      lines.push('') // a page break ends a paragraph
      pages.push(lines)
      if (pagesNeedingOcr([lines]).length) {
        if (!render || ++lowText > OCR.maxPages) skippedOcrPages += render ? 1 : 0
        else {
          const base = page.getViewport({ scale: 1 })
          const k = OCR.maxSide / Math.max(base.width, base.height) // longest side lands on maxSide
          const blob = await canvasToJpeg(async (ctx, w) => {
            await page.render({ canvas: ctx.canvas, canvasContext: ctx, viewport: page.getViewport({ scale: w / base.width }) }).promise
          }, base.width * k, base.height * k)
          images.push({ page: i, blob, mimeType: 'image/jpeg' })
        }
      }
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  return { pages, images, skippedOcrPages }
}

export type PdfScanVerdict = 'typed' | 'scan-required' | 'scan-optional' | 'err-too-many' | 'err-offline' | 'err-scanned' | 'err-browser'

/** What to do with a PDF after reading it. `images` = low-text pages rendered, `skipped` = qualifying pages beyond the cap. */
export function decidePdfScan(o: { images: number; skipped: number; scannedLooking: boolean; configured: boolean; hasToken: boolean }): PdfScanVerdict {
  if (o.images === 0) return !o.scannedLooking ? 'typed' : o.configured ? 'err-scanned' : 'err-offline'
  if (o.skipped > 0) return o.scannedLooking ? 'err-too-many' : 'typed'
  if (!o.hasToken) return o.scannedLooking ? 'err-browser' : 'typed'
  return o.scannedLooking ? 'scan-required' : 'scan-optional'
}

export type ImportInput = { file: File } | { photos: File[] } | { invalid: true } | { text: string; title: string }

const NEEDS_ONLINE = `needs an internet connection${AI_PROXY_URL ? '' : ', and AI reading isn’t set up on this copy of Margin'}. Paste the text instead, or try again online.`
const NO_TOKEN = 'Margin couldn’t confirm this browser for AI reading. Try again in a moment.'

export async function startImport(input: ImportInput): Promise<string | null> {
  if (current?.status === 'running') return null
  const kitId = uid()
  const file = 'file' in input ? input.file : null
  const photos = 'photos' in input ? input.photos : null
  const text = 'text' in input ? input : null
  const isPdf = !text // a PDF, photos, or an invalid pick (reported as a PDF import)
  const title = file ? file.name.replace(/\.pdf$/i, '')
    : photos ? `${photos[0].name.replace(/\.[^.]+$/, '')}${photos.length > 1 ? ` +${photos.length - 1} more` : ''}`
    : text ? text.title.trim() || 'Pasted notes' : 'Notes'
  set({
    kitId,
    title,
    source: isPdf ? 'pdf' : 'paste',
    status: 'running',
    steps: [
      { key: 'read', label: isPdf ? 'Read pages' : 'Read paragraphs', state: 'active' },
      { key: 'key', label: 'Find key sentences', state: 'todo' },
      { key: 'cards', label: 'Write cards', state: 'todo' },
      { key: 'summary', label: 'Write summary', state: 'todo' },
    ],
  })
  // Runs while the PDF is read; resolves at once (and never blocks) when AI isn't configured.
  const tokenP = aiConfigured() ? getTurnstileToken(TURNSTILE_SITEKEY!) : Promise.resolve(null)
  const reject = (code: ImportErrorCode, message: string) => { update({ status: 'error', error: { code, message } }); return null }

  // Checks that need no storage come first.
  if ('invalid' in input) return reject('not-pdf', 'Choose one PDF, or one or more photos of your notes, not both.')
  if (file) {
    if (file.size > MAX_PDF_BYTES) {
      return reject('too-big', `“${file.name}” is ${mb(file.size)} and the limit is ${mb(MAX_PDF_BYTES)}. Split it into smaller PDFs (most viewers can “Print to PDF” a page range), or copy the text and use Paste text.`)
    }
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      return reject('not-pdf', `“${file.name}” isn’t a PDF. Choose a .pdf file, or open the document and paste its text instead.`)
    }
  } else if (photos) {
    if (photos.length > OCR.maxPages) return reject('not-pdf', `That’s ${photos.length} photos; the limit is ${OCR.maxPages} per import. Split them into several imports.`)
    const big = photos.find((f) => f.size > OCR.maxPhotoBytes)
    if (big) return reject('too-big', `“${big.name}” is ${mb(big.size)} and the limit is ${mb(OCR.maxPhotoBytes)} per photo. Retake it at a lower resolution, or paste the text instead.`)
    if (!aiConfigured()) return reject('scanned', `Reading photos of notes ${NEEDS_ONLINE}`)
  } else if (text && countWords(text.text) < MIN_PASTE_WORDS) {
    return reject('empty-paste', `That’s too little text to make cards from. Paste at least a paragraph of full sentences (${MIN_PASTE_WORDS}+ words).`)
  }

  const kit: Kit = {
    id: kitId,
    title,
    sourceType: isPdf ? 'pdf' : 'paste',
    fileName: file ? file.name : photos ? title : undefined,
    createdAt: Date.now(),
    status: 'building',
    quizEnabled: false,
    summary: [],
    sentenceCount: 0,
  }
  try {
    await putKit(kit)
  } catch (e) {
    update({
      status: 'error',
      error: isQuotaError(e)
        ? { code: 'storage-full', message: 'Your device has no room for a new kit.' }
        : { code: 'storage-blocked', message: e instanceof StorageError ? 'This browser is blocking storage, so nothing can be saved.' : String(e) },
    })
    return null
  }
  notifyDataChanged()

  const t0 = performance.now()
  let doc: SourceDoc
  let images: PageImage[] = []
  let scanRequired = !!photos // photos must be read; a typed PDF's low-text pages are a bonus
  try {
    if (file) {
      const read = await readPdf(file, kitId, (i, n) => stepTo('read', `Reading page ${i} of ${n}`), { render: aiConfigured() })
      if (!read) return null
      const { pages, skippedOcrPages } = read
      images = read.images
      const chars = pages.flat().join('').replace(/\s/g, '').length
      const scannedLooking = chars < Math.max(200, pages.length * 30)
      // the token has been loading while the PDF was read
      const hasToken = images.length > 0 && !!(await tokenP)
      if (current?.kitId !== kitId) return null // cancelled while waiting
      const verdict = decidePdfScan({ images: images.length, skipped: skippedOcrPages, scannedLooking, configured: aiConfigured(), hasToken })
      if (verdict === 'err-too-many') {
        await fail(kitId, { code: 'too-big', message: `This PDF has ${images.length + skippedOcrPages} scanned pages; Margin reads up to ${OCR.maxPages} per import. Split it and import the parts.` })
        return null
      }
      if (verdict === 'err-scanned' || verdict === 'err-offline') {
        await fail(kitId, {
          code: 'scanned',
          message: verdict === 'err-scanned'
            ? `“${file.name}” looks like a scanned PDF: ${pages.length === 1 ? 'its page holds' : `its ${pages.length} pages hold`} pictures of text, not text Margin can read. Run it through OCR first (“Recognize text” in many PDF apps), or paste the text instead.`
            : `“${file.name}” has scanned or handwritten pages. Reading them ${NEEDS_ONLINE}`,
        })
        return null
      }
      if (verdict === 'err-browser') {
        await fail(kitId, { code: 'scanned', message: NO_TOKEN })
        return null
      }
      if (verdict === 'typed') images = [] // a typed PDF with a few figure or blank pages, or no token: use its text only
      scanRequired = verdict === 'scan-required'
      kit.pageCount = pages.length
      doc = { kind: 'pdf', title, pages }
    } else if (photos) {
      for (let i = 0; i < photos.length; i++) {
        if (current?.kitId !== kitId) return null // cancelled
        stepTo('read', `Preparing photo ${i + 1} of ${photos.length}`)
        images.push(await photoToPage(photos[i], i + 1))
      }
      kit.pageCount = photos.length
      doc = { kind: 'pdf', title, pages: photos.map(() => []) }
    } else {
      doc = { kind: 'paste', title, pages: [text!.text.split(/\r?\n/)] }
    }
  } catch (e) {
    if (e instanceof ScanError) {
      await fail(kitId, e.code === 'too-big'
        ? { code: 'too-big', message: `One of these photos is over the ${mb(OCR.maxPhotoBytes)} limit. Retake it at a lower resolution, or paste the text instead.` }
        : e.code === 'heic'
          ? { code: 'not-pdf', message: 'This photo is HEIC, which this browser can’t open. Export it as JPEG (on iPhone: Settings → Camera → Formats → Most Compatible) and try again.' }
          : { code: 'not-pdf', message: 'One of these photos couldn’t be opened. Try exporting it as JPEG and import again.' })
      return null
    }
    const name = (e as { name?: string })?.name
    await fail(kitId, name === 'PasswordException'
      ? { code: 'password', message: 'This PDF is password-protected. Open it, save an unlocked copy, and import that copy.' }
      : { code: 'not-pdf', message: 'This file couldn’t be opened as a PDF; it may be damaged. Re-save it from the app that made it, or paste the text instead.' })
    return null
  }

  const token = await tokenP
  if (current?.kitId !== kitId) return null // cancelled while waiting
  if (photos && !token) {
    await fail(kitId, { code: 'scanned', message: NO_TOKEN })
    return null
  }
  const w = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' })
  worker = w
  w.onmessage = (e: MessageEvent<WorkerMsg>) => {
    const m = e.data
    if (m.type === 'progress') stepTo(m.step, m.text)
    else if (m.type === 'done') {
      w.terminate()
      worker = null
      update({ status: 'done', steps: current!.steps.map((s) => ({ ...s, state: 'done', label: s.key === 'cards' ? `Wrote ${m.cards} cards` : s.label })), result: { cards: m.cards, quizEnabled: m.quizEnabled, ms: performance.now() - t0 } })
      notifyDataChanged()
    } else {
      fail(kitId, {
        code: m.code,
        message: m.code === 'storage-full' ? 'Your device ran out of room while saving the cards.' : m.code === 'storage-blocked' ? 'This browser is blocking storage, so the cards couldn’t be saved.' : m.message,
      })
    }
  }
  w.onerror = (e) => { fail(kitId, { code: 'unknown', message: `The import stopped unexpectedly (${e.message || 'worker error'}).` }) }
  const job: WorkerJob = {
    kit, doc, file: file ? { name: file.name, blob: file } : undefined, simulateFull: sim === 'full',
    ai: token ? { proxyUrl: AI_PROXY_URL!, turnstileToken: token } : undefined,
    scan: images.length > 0 ? { images, required: scanRequired } : undefined,
  }
  w.postMessage(job)
  return kitId
}

const isPdfLike = (f: { name: string; type: string }) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
const isPhotoLike = (f: { name: string; type: string }) => /^image\/(jpeg|png|webp|hei[cf])$/.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)

/** One PDF, or one or more photos (in natural name order); anything else is invalid. */
export function classifyPicked(files: { name: string; type: string }[]): { kind: 'pdf'; index: number } | { kind: 'photos'; order: number[] } | { kind: 'invalid' } {
  if (files.length === 1 && isPdfLike(files[0])) return { kind: 'pdf', index: 0 }
  if (files.length > 0 && files.every((f) => !isPdfLike(f) && isPhotoLike(f))) {
    const order = files.map((_, i) => i).sort((a, b) => files[a].name.localeCompare(files[b].name, undefined, { numeric: true }))
    return { kind: 'photos', order }
  }
  return { kind: 'invalid' }
}
