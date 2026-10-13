// Import worker: runs card generation and writes the finished kit to IndexedDB in one
// transaction, so a cancelled or crashed import never leaves half a kit behind.
import { classicGenerator, GenError, type CardGenerator, type SourceDoc } from './gen/generator'
import { ProxyClient } from './gen/ai/proxyClient'
import { createAiGenerator } from './gen/ai/aiGenerator'
import { ScanFailed, scanFailedMessage, transcribePages } from './gen/ai/transcribe'
import type { PageImage } from './lib/pageImages'
import { getDB, isQuotaError, StorageError } from './lib/db'
import type { Kit } from './lib/types'

export interface WorkerJob {
  kit: Kit
  doc: SourceDoc
  file?: { name: string; blob: Blob }
  simulateFull?: boolean
  ai?: { proxyUrl: string; turnstileToken: string }
  scan?: { images: PageImage[]; required: boolean } // requires ai
}

export type WorkerMsg =
  | { type: 'progress'; step: 'read' | 'key' | 'cards' | 'summary'; text: string }
  | { type: 'done'; cards: number; quizEnabled: boolean }
  | { type: 'error'; code: 'too-little' | 'scanned' | 'storage-full' | 'storage-blocked' | 'unknown'; message: string }

const post = (m: WorkerMsg) => (self as unknown as Worker).postMessage(m)

self.onmessage = async (e: MessageEvent<WorkerJob>) => {
  const { kit, doc, file, ai, scan } = e.data
  try {
    // Swap this for another CardGenerator (e.g. a local-AI one) to change how cards are written.
    let generator: CardGenerator = classicGenerator
    let transcript: string | undefined
    let readLabel: string | undefined // replaces the generator's read step after AI reading
    if (ai) {
      const client = new ProxyClient(ai.proxyUrl)
      const session = client.openSession(ai.turnstileToken).catch(() => null)
      if (scan) {
        try {
          const read = await transcribePages({ images: scan.images, client, session, progress: (p) => post({ type: 'progress', step: p.step, text: p.text }) })
          for (const { page, text } of read.pages) doc.pages[page - 1] = text.split('\n')
          transcript = read.transcript
          const total = doc.pages.length
          const lost = read.failedPages.length
          readLabel = lost ? `Read ${total - lost} of ${total} pages (${lost} couldn’t be read)` : `Read ${total} pages`
          post({ type: 'progress', step: 'read', text: readLabel })
        } catch (err) {
          if (scan.required || !(err instanceof ScanFailed)) throw err // otherwise keep the typed text
        }
      }
      generator = createAiGenerator({ client, session })
    }
    const out = await generator.generate(kit.id, doc, (p) => post({ type: 'progress', step: p.step, text: p.step === 'read' && readLabel ? readLabel : p.text }))
    if (e.data.simulateFull) throw new StorageError('full', 'Storage full (simulated)')
    const db = await getDB()
    const tx = db.transaction(['kits', 'sentences', 'cards', 'files'], 'readwrite')
    for (const s of out.sentences) tx.objectStore('sentences').put(s)
    for (const c of out.cards) tx.objectStore('cards').put(c)
    if (file) tx.objectStore('files').put({ kitId: kit.id, name: file.name, size: file.blob.size, blob: file.blob })
    tx.objectStore('kits').put({
      ...kit,
      status: 'ready',
      summary: out.summary,
      quizEnabled: out.quizEnabled,
      quizReason: out.quizReason,
      sentenceCount: out.sentences.length,
      ...(transcript ? { transcript } : {}),
    })
    await tx.done
    post({ type: 'done', cards: out.cards.length, quizEnabled: out.quizEnabled })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof ScanFailed) post({ type: 'error', code: 'scanned', message: scanFailedMessage(err.reason) })
    else if (err instanceof GenError) post({ type: 'error', code: err.code, message })
    else if (isQuotaError(err)) post({ type: 'error', code: 'storage-full', message })
    else if (err instanceof StorageError) post({ type: 'error', code: 'storage-blocked', message })
    else post({ type: 'error', code: 'unknown', message })
  }
}
