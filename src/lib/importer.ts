// Main-thread side of an import: reads the file, starts the worker, tracks progress and errors.
// One import runs at a time; screens subscribe to see it.
import type { SourceDoc } from '../gen/generator'
import type { WorkerJob, WorkerMsg } from '../worker'
import { deleteKit, putKit, uid, isQuotaError, StorageError } from './db'
import type { Kit } from './types'
import { notifyDataChanged } from './hooks'
import { mb } from '../ui'

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

const sim = new URLSearchParams(location.search).get('sim')

async function fail(kitId: string, error: ImportError) {
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
async function readPdf(file: File, kitId: string, onPage: (i: number, n: number) => void): Promise<string[][] | null> {
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const data = new Uint8Array(await file.arrayBuffer())
  const task = pdfjs.getDocument({ data })
  const pdf = await task.promise
  const pages: string[][] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    if (current?.kitId !== kitId) { await task.destroy(); return null } // cancelled
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
    page.cleanup()
  }
  await task.destroy()
  return pages
}

export async function startImport(input: { file: File } | { text: string; title: string }): Promise<string | null> {
  if (current?.status === 'running') return null
  const kitId = uid()
  const isPdf = 'file' in input
  const title = isPdf ? input.file.name.replace(/\.pdf$/i, '') : input.title.trim() || 'Pasted notes'
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

  // Checks that need no storage come first.
  if (isPdf) {
    const f = input.file
    if (f.size > MAX_PDF_BYTES) {
      update({ status: 'error', error: { code: 'too-big', message: `“${f.name}” is ${mb(f.size)} and the limit is ${mb(MAX_PDF_BYTES)}. Split it into smaller PDFs (most viewers can “Print to PDF” a page range), or copy the text and use Paste text.` } })
      return null
    }
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      update({ status: 'error', error: { code: 'not-pdf', message: `“${f.name}” isn’t a PDF. Choose a .pdf file, or open the document and paste its text instead.` } })
      return null
    }
  } else if (countWords(input.text) < MIN_PASTE_WORDS) {
    update({ status: 'error', error: { code: 'empty-paste', message: `That’s too little text to make cards from. Paste at least a paragraph of full sentences (${MIN_PASTE_WORDS}+ words).` } })
    return null
  }

  const kit: Kit = {
    id: kitId,
    title,
    sourceType: isPdf ? 'pdf' : 'paste',
    fileName: isPdf ? input.file.name : undefined,
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
  try {
    if (isPdf) {
      const pages = await readPdf(input.file, kitId, (i, n) => stepTo('read', `Reading page ${i} of ${n}`))
      if (!pages) return null
      const chars = pages.flat().join('').replace(/\s/g, '').length
      if (chars < Math.max(200, pages.length * 30)) {
        await fail(kitId, { code: 'scanned', message: `“${input.file.name}” looks like a scanned PDF: ${pages.length === 1 ? 'its page holds' : `its ${pages.length} pages hold`} pictures of text, not text Margin can read. Run it through OCR first (“Recognize text” in many PDF apps), or paste the text instead.` })
        return null
      }
      kit.pageCount = pages.length
      doc = { kind: 'pdf', title, pages }
    } else {
      doc = { kind: 'paste', title, pages: [input.text.split(/\r?\n/)] }
    }
  } catch (e) {
    const name = (e as { name?: string })?.name
    await fail(kitId, name === 'PasswordException'
      ? { code: 'password', message: 'This PDF is password-protected. Open it, save an unlocked copy, and import that copy.' }
      : { code: 'not-pdf', message: 'This file couldn’t be opened as a PDF; it may be damaged. Re-save it from the app that made it, or paste the text instead.' })
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
  const job: WorkerJob = { kit, doc, file: isPdf ? { name: input.file.name, blob: input.file } : undefined, simulateFull: sim === 'full' }
  w.postMessage(job)
  return kitId
}
