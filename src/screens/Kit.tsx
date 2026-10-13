import { useEffect, useState } from 'preact/hooks'
import { deleteKit, getFile, putKit, sentencesForKit } from '../lib/db'
import { go, notifyDataChanged, useAsync } from '../lib/hooks'
import { cardStatus, cite, formatInterval, kitQueue, loadStudyData, missesByCard, parseDayKey, type CardStatus } from '../lib/study'
import type { Kit, Sentence } from '../lib/types'
import { useImportState, ImportSteps } from './Library'
import { Badge, Loading, Notice, PageHeader, Prompt, fmtDate, mb, plural, type Tone } from '../ui'

const STATUS_TONE: Record<CardStatus, Tone> = { New: 'neutral', Learning: 'accent', Mastered: 'success', 'Missed twice': 'danger' }

async function load(id: string) {
  const d = await loadStudyData()
  const kit = d.kits.find((k) => k.id === id)
  if (!kit) return null
  const [sentences, file] = await Promise.all([sentencesForKit(id), getFile(id)])
  return { d, kit, sentences, file: file ?? null }
}

function Building({ kit }: { kit: Kit }) {
  const imp = useImportState()
  const live = imp?.kitId === kit.id && imp.status === 'running'
  const [busy, setBusy] = useState(false)
  return (
    <div class="stack">
      <PageHeader title={kit.title} sub="Still building" />
      {live ? (
        <div class="card stack" aria-live="polite">
          <p>Margin is writing this kit’s cards. You can leave this page; the import keeps running in this tab.</p>
          <ImportSteps s={imp!} />
        </div>
      ) : (
        <Notice tone="warning" title="This kit didn’t finish building"
          actions={<button class="btn primary" disabled={busy} onClick={async () => { setBusy(true); await deleteKit(kit.id); notifyDataChanged(); go(`/library?import=${kit.sourceType === 'pdf' ? 'pdf' : 'paste'}`) }}>Delete it and import again</button>}>
          The import stopped before the cards were saved, usually because the tab was closed or reloaded mid-import. Nothing from it was kept.
        </Notice>
      )}
    </div>
  )
}

function SourceText({ sentences, kit, at }: { sentences: Sentence[]; kit: Kit; at?: string }) {
  useEffect(() => { if (at) document.getElementById(`s-${at}`)?.scrollIntoView({ block: 'center' }) }, [at])
  const groups = new Map<string, Sentence[]>()
  for (const s of sentences) {
    const key = kit.sourceType === 'pdf' && s.page ? `Page ${s.page}` : `Paragraph ${s.paragraph}`
    ;(groups.get(key) ?? groups.set(key, []).get(key)!).push(s)
  }
  return (
    <div class="stack">
      <p class="muted small">The sentences Margin kept from your notes ({plural(sentences.length, 'sentence')}). Headings, page numbers and fragments were left out.</p>
      {[...groups].map(([label, ss]) => (
        <section key={label} class="source-group">
          <h3 class="small muted">{label}</h3>
          <p>{ss.map((s) => <span key={s.id} id={`s-${s.id}`} class={s.id === at ? 'source-hit' : ''}>{s.text} </span>)}</p>
        </section>
      ))}
    </div>
  )
}

export function KitScreen({ id, query }: { id: string; query: URLSearchParams }) {
  const { data, loading, error } = useAsync(() => load(id), [id])
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState<string | null>(null)
  const [saved, setSaved] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [statusFilter, setStatusFilter] = useState<CardStatus | 'All'>('All')
  const tab = query.get('tab') ?? 'summary'

  if (loading) return <Loading label="Loading kit…" />
  if (error) return <Notice tone="danger" title="This kit couldn’t be loaded" actions={<a class="btn" href="#/library">Back to Library</a>}>{String(error)}</Notice>
  if (!data) return <Notice title="This kit doesn’t exist" actions={<a class="btn primary" href="#/library">Go to Library</a>}>It may have been deleted, or the link is from a backup that hasn’t been restored on this device.</Notice>

  const { d, kit, sentences, file } = data
  if (kit.status === 'building') return <Building kit={kit} />

  const cards = d.cards.filter((c) => c.kitId === kit.id)
  const due = kitQueue(d, kit.id).length
  const misses = missesByCard(d.reviews.filter((r) => r.kitId === kit.id))
  const statuses = cards.map((c) => ({ c, status: cardStatus(c, misses.get(c.id) ?? 0) }))
  const count = (s: CardStatus) => statuses.filter((x) => x.status === s).length
  const mcqCount = cards.filter((c) => c.type === 'mcq').length

  const save = async (patch: Partial<Kit>, msg: string) => {
    await putKit({ ...kit, ...patch })
    setSaved(msg)
    notifyDataChanged()
  }
  const tabLink = (t: string) => `#/kit/${kit.id}?tab=${t}`
  const openPdf = () => { if (file) window.open(URL.createObjectURL(file.blob), '_blank', 'noopener') }

  return (
    <div class="stack">
      <a class="back" href="#/library">← Library</a>
      {renaming ? (
        <form class="rename" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { save({ title: name.trim() }, 'Name saved'); setRenaming(false) } }}>
          <label class="field grow"><span>Kit name</span><input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} autoFocus /></label>
          <button class="btn primary" type="submit" disabled={!name.trim()}>Save name</button>
          <button class="btn" type="button" onClick={() => setRenaming(false)}>Cancel</button>
        </form>
      ) : (
        <PageHeader
          title={kit.title}
          sub={<>{kit.sourceType === 'pdf' ? `${kit.fileName}${kit.pageCount ? ` · ${plural(kit.pageCount, 'page')}` : ''}` : 'Pasted notes'} · {plural(cards.length, 'card')} · added {fmtDate(kit.createdAt)} <button class="link" onClick={() => { setName(kit.title); setRenaming(true) }}>Rename</button></>}
          actions={<>
            {due > 0 ? <a class="btn primary" href={`#/review?kit=${kit.id}`}>Review {plural(due, 'due card')}</a> : <button class="btn" disabled>No cards due</button>}
            {kit.quizEnabled && mcqCount > 0 ? <a class="btn" href={`#/review?mode=quiz&kit=${kit.id}`}>Practice quiz</a> : <button class="btn" disabled title="See the note below">Practice quiz</button>}
          </>}
        />
      )}
      {saved && <p class="muted small" role="status">{saved}</p>}

      {!kit.quizEnabled && (
        <Notice tone="warning" title="Flashcards only, no quiz" actions={<a class="btn" href="#/library?import=paste">Paste more notes as a new kit</a>}>
          {kit.quizReason ?? 'There wasn’t enough text to make quiz questions.'}
        </Notice>
      )}

      <div class="grid-2 kit-details">
        <label class="field">
          <span>Exam date (optional)</span>
          <span class="inline">
            <input type="date" value={kit.examDate ?? ''} onChange={(e) => { const v = (e.target as HTMLInputElement).value; save({ examDate: v || undefined }, v ? `Exam date set to ${fmtDate(parseDayKey(v))}. Extra reviews start today.` : 'Exam date cleared') }} />
            {kit.examDate && <button class="btn" onClick={() => save({ examDate: undefined }, 'Exam date cleared')}>Clear</button>}
          </span>
        </label>
        <label class="field">
          <span>Your notes about this kit</span>
          <textarea rows={2} value={notes ?? kit.notes ?? ''} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
            onBlur={() => { if (notes !== null && notes !== (kit.notes ?? '')) save({ notes }, 'Notes saved') }} placeholder="e.g. Chapters 1–3 for the midterm" />
        </label>
      </div>

      <nav class="tabs" aria-label="Kit sections">
        <a href={tabLink('summary')} aria-current={tab === 'summary' ? 'page' : undefined}>Summary</a>
        <a href={tabLink('cards')} aria-current={tab === 'cards' ? 'page' : undefined}>Cards ({cards.length})</a>
        <a href={tabLink('source')} aria-current={tab === 'source' ? 'page' : undefined}>Source pages</a>
      </nav>

      <section class="card stack">
        {tab === 'summary' && (
          kit.summary.length === 0 ? <p class="muted">No summary: the notes were too short to pick key points.</p> : (
            <>
              <p class="muted small">The {plural(kit.summary.length, 'sentence')} most connected to the rest of your notes (TextRank), in reading order.</p>
              <ol class="summary">
                {kit.summary.map((p) => (
                  <li key={p.sentenceId}>
                    {p.text} <a class="cite" href={`${tabLink('source')}&at=${encodeURIComponent(p.sentenceId)}`}>{kit.sourceType === 'pdf' && p.page ? `page ${p.page}` : `paragraph ${p.paragraph}`}</a>
                  </li>
                ))}
              </ol>
            </>
          )
        )}
        {tab === 'cards' && (
          <>
            <div class="segmented" role="group" aria-label="Filter cards by status">
              {(['All', 'New', 'Learning', 'Mastered', 'Missed twice'] as const).map((s) => (
                <button key={s} class={statusFilter === s ? 'on' : ''} aria-pressed={statusFilter === s} onClick={() => setStatusFilter(s)}>
                  {s} <span class="muted">{s === 'All' ? cards.length : count(s)}</span>
                </button>
              ))}
            </div>
            <ul class="rows">
              {statuses.filter((x) => statusFilter === 'All' || x.status === statusFilter).map(({ c, status }) => (
                <li class="row card-row" key={c.id}>
                  <span class="row-main"><Prompt text={c.prompt} /></span>
                  <span class="answer">{c.type === 'compare' ? c.answer : `→ ${c.answer}`}</span>
                  <span class="row-tags">
                    <Badge tone={STATUS_TONE[status]}>{status}</Badge>
                    <span class="muted small">{c.type === 'mcq' ? 'Quiz' : c.type === 'compare' ? 'Compare' : 'Flashcard'}</span>
                    {status !== 'New' && <span class="muted small">{c.fsrs.due <= new Date() ? 'due now' : `due in ${formatInterval(c.fsrs.due.getTime() - Date.now())}`}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {statuses.length > 0 && statuses.every((x) => statusFilter !== 'All' && x.status !== statusFilter) && <p class="muted">No cards are “{statusFilter}” right now.</p>}
          </>
        )}
        {tab === 'source' && (
          <>
            {kit.sourceType === 'pdf' && (file
              ? <div class="actions"><button class="btn" onClick={openPdf}>Open original PDF ({mb(file.size)})</button></div>
              : <p class="muted small">{kit.transcript && !/\.pdf$/i.test(kit.fileName ?? '') ? 'Made from photos; the original images aren’t stored.' : 'The original PDF was removed to save space. Cards and the sentences below are kept.'}</p>)}
            <SourceText sentences={sentences} kit={kit} at={query.get('at') ?? undefined} />
          </>
        )}
      </section>

      <section class="danger-zone">
        {!confirmDelete ? (
          <button class="btn danger" onClick={() => setConfirmDelete(true)}>Delete kit</button>
        ) : (
          <Notice tone="danger" title={`Delete “${kit.title}”?`}
            actions={<>
              <button class="btn danger-solid" onClick={async () => { await deleteKit(kit.id); notifyDataChanged(); go('/library') }}>Delete kit and {plural(cards.length, 'card')}</button>
              <button class="btn" onClick={() => setConfirmDelete(false)}>Keep kit</button>
            </>}>
            This removes its {plural(cards.length, 'card')}, review history{file ? ' and the original PDF' : ''} from this device. It can’t be undone unless you have a backup.
          </Notice>
        )}
      </section>
    </div>
  )
}
