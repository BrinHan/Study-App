import { useEffect, useRef, useState } from 'preact/hooks'
import {
  deleteEverything, exportBackup, getSettings, listFiles, listKits, parseBackup, removeAllFiles, restoreBackup, saveSettings,
  allCards, allReviews, type Backup,
} from '../lib/db'
import { notifyDataChanged, useAsync, useOnline } from '../lib/hooks'
import { applyUpdate, checkForUpdates, install, pwa, subscribePwa } from '../pwa'
import { Notice, PageHeader, fmtDate, mb, plural } from '../ui'
import { dayKey } from '../lib/study'

export function StorageHelp() {
  return (
    <section class="card stack" id="storage-help">
      <h2>How to fix blocked storage</h2>
      <p class="muted small">Margin keeps everything in your browser’s on-device storage (IndexedDB). If that’s blocked, nothing can be saved.</p>
      <ol class="steps-list">
        <li><strong>Private or incognito window?</strong> Open Margin in a normal window. Private windows block storage or erase it when closed.</li>
        <li><strong>Firefox:</strong> Settings → Privacy &amp; Security → Cookies and Site Data → Manage Exceptions → allow this site.</li>
        <li><strong>Chrome / Edge:</strong> click the icon left of the address → Site settings → set “Cookies and site data” to Allow.</li>
        <li><strong>Safari:</strong> Settings → Privacy → turn off “Block all cookies”.</li>
        <li>Then reload the page.</li>
      </ol>
      <div class="actions"><button class="btn" onClick={() => location.reload()}>Reload and check again</button></div>
    </section>
  )
}

function usePwa() {
  const [, setTick] = useState(0)
  useEffect(() => subscribePwa(() => setTick((t) => t + 1)), [])
  return pwa
}

async function loadSettingsData() {
  const [settings, files, kits, cards, reviews, estimate] = await Promise.all([
    getSettings(), listFiles(), listKits(), allCards(), allReviews(),
    navigator.storage?.estimate ? navigator.storage.estimate() : Promise.resolve(null),
  ])
  return { settings, files, kits, cards: cards.length, reviews: reviews.length, estimate }
}

export function Settings({ storageBlocked }: { storageBlocked: boolean }) {
  const online = useOnline()
  const p = usePwa()
  const { data, error } = useAsync(() => (storageBlocked ? Promise.resolve(null) : loadSettingsData()), [storageBlocked])
  const [newPerDay, setNewPerDay] = useState<string | null>(null)
  const [msg, setMsg] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState<'pdfs' | 'all' | null>(null)
  const [pendingRestore, setPendingRestore] = useState<Backup | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [updateState, setUpdateState] = useState<string | null>(null)
  const restoreInput = useRef<HTMLInputElement>(null)
  const helpRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (location.hash.includes('section=storage')) helpRef.current?.scrollIntoView() }, [])
  const say = (key: string, text: string) => setMsg((m) => ({ ...m, [key]: text }))

  if (storageBlocked) {
    return (
      <div class="stack">
        <PageHeader title="Settings" />
        <Notice tone="danger" title="Storage is blocked in this window">Most settings need on-device storage. Fix it with the steps below, then reload.</Notice>
        <StorageHelp />
      </div>
    )
  }
  if (error) return <Notice tone="danger" title="Settings couldn’t be loaded" actions={<button class="btn" onClick={() => location.reload()}>Reload</button>}>{String(error)}</Notice>
  if (!data) return null

  const pdfBytes = data.files.reduce((s, f) => s + f.size, 0)
  const value = newPerDay ?? String(data.settings.newPerDay)
  const valid = /^\d+$/.test(value) && +value >= 1 && +value <= 200

  const download = async () => {
    const backup = await exportBackup()
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `margin-backup-${dayKey()}.json` })
    a.click()
    URL.revokeObjectURL(url)
    say('backup', `Saved margin-backup-${dayKey()}.json with ${plural(backup.kits.length, 'kit')} and ${plural(backup.cards.length, 'card')}.`)
  }

  const chooseRestore = async (f: File) => {
    setRestoreError(null)
    try { setPendingRestore(parseBackup(await f.text())) } catch (e) { setRestoreError((e as Error).message) }
  }

  return (
    <div class="stack settings">
      <PageHeader title="Settings" />

      <section class="card stack">
        <h2>Daily new cards</h2>
        <form class="inline" onSubmit={async (e) => { e.preventDefault(); if (!valid) return; await saveSettings({ ...data.settings, newPerDay: +value }); notifyDataChanged(); say('new', `Saved. Up to ${value} new cards a day.`) }}>
          <label class="field"><span>New cards per day</span><input type="number" min={1} max={200} value={value} onInput={(e) => setNewPerDay((e.target as HTMLInputElement).value)} /></label>
          <button class="btn primary" type="submit" disabled={!valid}>Save</button>
        </form>
        {!valid && <p class="small danger-text">Enter a whole number from 1 to 200.</p>}
        <p class="muted small">{msg.new ?? 'Each new card adds about 3 reviews over the following week. 20 a day is roughly 10 minutes of reviewing.'}</p>
      </section>

      <section class="card stack">
        <h2>Storage</h2>
        <p>
          {data.estimate?.usage != null ? <>Margin is using <strong>{mb(data.estimate.usage)}</strong>{data.estimate.quota ? <> of about {mb(data.estimate.quota)} your browser allows</> : null}.</> : 'Your browser doesn’t report storage use.'}
          {' '}{plural(data.kits.length, 'kit')}, {plural(data.cards, 'card')}, {plural(data.reviews, 'review')}.
        </p>
        <p class="muted small">{data.files.length ? `${plural(data.files.length, 'original PDF')} stored (${mb(pdfBytes)}), used for “Open original PDF” on kit pages.` : 'No original PDFs are stored.'}</p>
        {confirm === 'pdfs' ? (
          <Notice tone="warning" title={`Remove ${plural(data.files.length, 'original PDF')}?`}
            actions={<><button class="btn primary" onClick={async () => { await removeAllFiles(); setConfirm(null); notifyDataChanged(); say('pdfs', `Removed. Freed about ${mb(pdfBytes)}; all cards and sources are kept.`) }}>Remove PDFs, keep cards</button><button class="btn" onClick={() => setConfirm(null)}>Cancel</button></>}>
            Cards, summaries and source sentences stay. You won’t be able to open the original files from Margin.
          </Notice>
        ) : (
          <div class="actions"><button class="btn" disabled={!data.files.length} onClick={() => setConfirm('pdfs')}>Remove original PDFs, keep cards{data.files.length ? ` (frees ${mb(pdfBytes)})` : ''}</button></div>
        )}
        {msg.pdfs && <p class="small" role="status">{msg.pdfs}</p>}
      </section>

      <section class="card stack">
        <h2>Backup</h2>
        <p class="muted small">A backup is one .json file with your kits, cards, source sentences and review history. Original PDFs aren’t included. Keep it somewhere safe; Margin has no cloud copy.</p>
        <div class="actions">
          <button class="btn primary" onClick={download} disabled={!data.kits.length}>Download backup (.json)</button>
          <button class="btn" onClick={() => restoreInput.current?.click()}>Restore from backup…</button>
          <input ref={restoreInput} type="file" accept="application/json,.json" class="visually-hidden" tabIndex={-1} aria-hidden="true"
            onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (f) chooseRestore(f) }} />
        </div>
        {!data.kits.length && <p class="muted small">Nothing to back up yet.</p>}
        {msg.backup && <p class="small" role="status">{msg.backup}</p>}
        {restoreError && <Notice tone="danger" title="That file can’t be restored" actions={<button class="btn" onClick={() => restoreInput.current?.click()}>Choose another file</button>}>{restoreError}</Notice>}
        {pendingRestore && (
          <Notice tone="warning" title="Replace everything with this backup?"
            actions={<><button class="btn primary" onClick={async () => { await restoreBackup(pendingRestore); setPendingRestore(null); notifyDataChanged(); say('backup', 'Backup restored.') }}>Replace my data</button><button class="btn" onClick={() => setPendingRestore(null)}>Cancel</button></>}>
            The backup from {fmtDate(new Date(pendingRestore.exportedAt))} has {plural(pendingRestore.kits.length, 'kit')} and {plural(pendingRestore.cards.length, 'card')}. It replaces your current {plural(data.kits.length, 'kit')} and {plural(data.cards, 'card')}{data.files.length ? ', and removes stored PDFs' : ''}.
          </Notice>
        )}
      </section>

      <div ref={helpRef}><StorageHelp /></div>

      <section class="card stack">
        <h2>App</h2>
        <p class="muted small">After the first visit Margin works without a connection. Installing adds it to your apps list and opens it in its own window.</p>
        <div class="actions">
          {p.installed ? <button class="btn" disabled>Installed</button>
            : <button class="btn" disabled={!online || !p.installPrompt} onClick={install}>Install app</button>}
          <button class="btn" disabled={!online} onClick={async () => { setUpdateState('Checking…'); const r = await checkForUpdates(); setUpdateState(r === 'ready' ? 'ready' : r === 'latest' ? 'You have the latest version.' : 'Update checks work in the built app (npm run build), not in dev mode.') }}>Check for updates</button>
        </div>
        {!online && <p class="small muted">Install and update checks are paused while you’re offline.</p>}
        {online && !p.installed && !p.installPrompt && <p class="small muted">Your browser hasn’t offered installing yet. In Chrome or Edge, use the install icon in the address bar; in Safari, use Share → Add to Dock / Home Screen.</p>}
        {(p.updateReady || updateState === 'ready')
          ? <Notice tone="accent" title="A new version is ready" actions={<button class="btn primary" onClick={applyUpdate}>Reload to update</button>}>Your data stays as it is.</Notice>
          : updateState && <p class="small" role="status">{updateState}</p>}
      </section>

      <section class="card stack danger-zone">
        <h2>Delete all data</h2>
        {confirm === 'all' ? (
          <Notice tone="danger" title="Delete everything on this device?"
            actions={<><button class="btn danger-solid" onClick={async () => { await deleteEverything(); setConfirm(null); notifyDataChanged(); say('all', 'All data deleted.') }}>Delete {plural(data.kits.length, 'kit')} and {plural(data.cards, 'card')}</button><button class="btn" onClick={() => setConfirm(null)}>Keep my data</button><button class="btn" onClick={download}>Download backup first</button></>}>
            This removes every kit, card, review and stored PDF. It can’t be undone without a backup.
          </Notice>
        ) : (
          <div class="actions"><button class="btn danger" onClick={() => setConfirm('all')} disabled={!data.kits.length && !data.reviews}>Delete all data…</button></div>
        )}
        {msg.all && <p class="small" role="status">{msg.all}</p>}
      </section>
    </div>
  )
}
