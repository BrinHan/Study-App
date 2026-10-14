// IndexedDB access. Used by the UI and by the import worker (idb works in both).
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Kit, Sentence, StudyCard, Review, Confusion, StoredFile, Settings, StudySession } from './types'
import { DEFAULT_SETTINGS } from './types'
import { newProgress, progressFromFsrs } from '../study/mastery'

interface MarginDB extends DBSchema {
  kits: { key: string; value: Kit }
  sentences: { key: string; value: Sentence; indexes: { kitId: string } }
  cards: { key: string; value: StudyCard; indexes: { kitId: string } }
  reviews: { key: string; value: Review; indexes: { kitId: string; reviewedAt: number } }
  confusions: { key: string; value: Confusion; indexes: { kitId: string } }
  files: { key: string; value: StoredFile }
  sessions: { key: string; value: StudySession; indexes: { kitId: string } }
  meta: { key: string; value: unknown }
}

export type DB = IDBPDatabase<MarginDB>
export type StorageProblem = 'blocked' | 'full'

export class StorageError extends Error {
  code: StorageProblem
  constructor(code: StorageProblem, message: string) {
    super(message)
    this.code = code
  }
}

// ?sim=blocked or ?sim=full shows those states without a private window or a full disk.
const sim = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('sim') : null

export function isQuotaError(e: unknown): boolean {
  const name = (e as { name?: string })?.name
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || (e instanceof StorageError && e.code === 'full')
}

let dbPromise: Promise<DB> | null = null

export function getDB(): Promise<DB> {
  if (sim === 'blocked') return Promise.reject(new StorageError('blocked', 'Storage blocked (simulated)'))
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') return Promise.reject(new StorageError('blocked', 'IndexedDB is not available'))
    dbPromise = openDB<MarginDB>('margin', 1, {
      upgrade(db) {
        db.createObjectStore('kits', { keyPath: 'id' })
        db.createObjectStore('sentences', { keyPath: 'id' }).createIndex('kitId', 'kitId')
        db.createObjectStore('cards', { keyPath: 'id' }).createIndex('kitId', 'kitId')
        const r = db.createObjectStore('reviews', { keyPath: 'id' })
        r.createIndex('kitId', 'kitId')
        r.createIndex('reviewedAt', 'reviewedAt')
        db.createObjectStore('confusions', { keyPath: 'id' }).createIndex('kitId', 'kitId')
        db.createObjectStore('files', { keyPath: 'kitId' })
        db.createObjectStore('meta')
      },
    }).catch((e) => {
      dbPromise = null
      throw new StorageError('blocked', String(e?.message ?? e))
    })
  }
  return dbPromise
}

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2)

export async function listKits() {
  const kits = await (await getDB()).getAll('kits')
  return kits.sort((a, b) => b.createdAt - a.createdAt)
}
export const putKit = async (kit: Kit) => (await getDB()).put('kits', kit)
export const allCards = async () => (await getDB()).getAll('cards')
export const putCard = async (card: StudyCard) => (await getDB()).put('cards', card)
export const getSentence = async (id: string) => (await getDB()).get('sentences', id)
export async function sentencesForKit(kitId: string) {
  const s = await (await getDB()).getAllFromIndex('sentences', 'kitId', kitId)
  return s.sort((a, b) => a.index - b.index)
}
export const allReviews = async () => (await getDB()).getAll('reviews')
export const addReview = async (r: Review) => (await getDB()).put('reviews', r)
export const allConfusions = async () => (await getDB()).getAll('confusions')
export const getConfusion = async (id: string) => (await getDB()).get('confusions', id)
export const putConfusion = async (c: Confusion) => (await getDB()).put('confusions', c)
export const getFile = async (kitId: string) => (await getDB()).get('files', kitId)

export async function listFiles(): Promise<Omit<StoredFile, 'blob'>[]> {
  const db = await getDB()
  const out: Omit<StoredFile, 'blob'>[] = []
  let cursor = await db.transaction('files').store.openCursor()
  while (cursor) {
    const { kitId, name, size } = cursor.value
    out.push({ kitId, name, size })
    cursor = await cursor.continue()
  }
  return out
}

export async function removeAllFiles() {
  await (await getDB()).clear('files')
}

export async function getSettings(): Promise<Settings> {
  const s = (await (await getDB()).get('meta', 'settings')) as Partial<Settings> | undefined
  return { ...DEFAULT_SETTINGS, ...s }
}
export const saveSettings = async (s: Settings) => (await getDB()).put('meta', s, 'settings')

async function deleteByIndex(db: DB, store: 'sentences' | 'cards' | 'reviews' | 'confusions', kitId: string) {
  const tx = db.transaction(store, 'readwrite')
  let cursor = await tx.store.index('kitId').openCursor(kitId)
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

export async function deleteKit(kitId: string) {
  const db = await getDB()
  for (const s of ['sentences', 'cards', 'reviews', 'confusions'] as const) await deleteByIndex(db, s, kitId)
  await db.delete('files', kitId)
  await db.delete('kits', kitId)
}

export async function deleteEverything() {
  const db = await getDB()
  for (const s of ['kits', 'sentences', 'cards', 'reviews', 'confusions', 'files', 'meta'] as const) await db.clear(s)
}

// ---- Backup (.json). Original PDFs are left out; cards and their source sentences are kept.
export interface Backup {
  app: 'margin'
  version: 1
  exportedAt: string
  kits: Kit[]
  sentences: Sentence[]
  cards: StudyCard[]
  reviews: Review[]
  confusions: Confusion[]
  settings: Settings
}

export async function exportBackup(): Promise<Backup> {
  const db = await getDB()
  const [kits, sentences, cards, reviews, confusions, settings] = await Promise.all([
    db.getAll('kits'), db.getAll('sentences'), db.getAll('cards'), db.getAll('reviews'), db.getAll('confusions'), getSettings(),
  ])
  return { app: 'margin', version: 1, exportedAt: new Date().toISOString(), kits, sentences, cards, reviews, confusions, settings }
}

export function parseBackup(text: string): Backup {
  let data: Backup
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This file isn’t valid JSON, so it can’t be a Margin backup.')
  }
  if (data?.app !== 'margin' || !Array.isArray(data.kits) || !Array.isArray(data.cards)) {
    throw new Error('This JSON file isn’t a Margin backup (it has no kits or cards list).')
  }
  for (const c of data.cards) {
    c.fsrs.due = new Date(c.fsrs.due)
    if (c.fsrs.last_review) c.fsrs.last_review = new Date(c.fsrs.last_review)
  }
  return data
}

export async function restoreBackup(b: Backup) {
  const db = await getDB()
  const stores = ['kits', 'sentences', 'cards', 'reviews', 'confusions', 'files', 'meta'] as const
  const tx = db.transaction(stores, 'readwrite')
  for (const s of stores) await tx.objectStore(s).clear()
  for (const k of b.kits) await tx.objectStore('kits').put(k)
  for (const s of b.sentences ?? []) await tx.objectStore('sentences').put(s)
  for (const c of b.cards) await tx.objectStore('cards').put(c)
  for (const r of b.reviews ?? []) await tx.objectStore('reviews').put(r)
  for (const c of b.confusions ?? []) await tx.objectStore('confusions').put(c)
  await tx.objectStore('meta').put(b.settings ?? DEFAULT_SETTINGS, 'settings')
  await tx.done
}
