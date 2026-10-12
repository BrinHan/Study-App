// Import worker: runs card generation and writes the finished kit to IndexedDB in one
// transaction, so a cancelled or crashed import never leaves half a kit behind.
import { classicGenerator, GenError, type CardGenerator, type SourceDoc } from './gen/generator'
import { getDB, isQuotaError, StorageError } from './lib/db'
import type { Kit } from './lib/types'

// Swap this for another CardGenerator (e.g. a local-AI one) to change how cards are written.
const generator: CardGenerator = classicGenerator

export interface WorkerJob {
  kit: Kit
  doc: SourceDoc
  file?: { name: string; blob: Blob }
  simulateFull?: boolean
}

export type WorkerMsg =
  | { type: 'progress'; step: 'read' | 'key' | 'cards' | 'summary'; text: string }
  | { type: 'done'; cards: number; quizEnabled: boolean }
  | { type: 'error'; code: 'too-little' | 'storage-full' | 'storage-blocked' | 'unknown'; message: string }

const post = (m: WorkerMsg) => (self as unknown as Worker).postMessage(m)

self.onmessage = async (e: MessageEvent<WorkerJob>) => {
  const { kit, doc, file } = e.data
  try {
    const out = generator.generate(kit.id, doc, (p) => post({ type: 'progress', step: p.step, text: p.text }))
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
    })
    await tx.done
    post({ type: 'done', cards: out.cards.length, quizEnabled: out.quizEnabled })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof GenError) post({ type: 'error', code: err.code, message })
    else if (isQuotaError(err)) post({ type: 'error', code: 'storage-full', message })
    else if (err instanceof StorageError) post({ type: 'error', code: 'storage-blocked', message })
    else post({ type: 'error', code: 'unknown', message })
  }
}
