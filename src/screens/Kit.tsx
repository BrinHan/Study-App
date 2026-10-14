import { useEffect, useState } from 'preact/hooks'
import { deleteKit, getFile, putKit, sentencesForKit } from '../lib/db'
import { go, notifyDataChanged, useAsync } from '../lib/hooks'
import { daysUntil, examNudge, loadStudyData, parseDayKey } from '../lib/study'
import type { Kit, MasteryState, Sentence } from '../lib/types'
import { kitMastery, STATUS_LABEL } from '../study/mastery'
import { useImportState, ImportSteps } from './Library'
import { MODES, MasteryBar, StarButton, masteryLine } from './study/shared'
import { Badge, Icon, Loading, Notice, PageHeader, Prompt, fmtDate, mb, plural, type Tone } from '../ui'

const STATUS_TONE: Record<MasteryState, Tone> = { new: 'neutral', learning: 'accent', mastered: 'success' }
type CardFilter = MasteryState | 'all' | 'starred'
const FILTERS: { id: CardFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'new', label: STATUS_LABEL.new }, { id: 'learning', label: STATUS_LABEL.learning },
  { id: 'mastered', label: STATUS_LABEL.mastered }, { id: 'starred', label: '★ Starred' },
]

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
  const [filter, setFilter] = useState<CardFilter>('all')
  const tab = query.get('tab') ?? 'cards'

  if (loading) return <Loading label="Loading kit…" />
  if (error) return <Notice tone="danger" title="This kit couldn’t be loaded" actions={<a class="btn" href="#/library">Back to Library</a>}>{String(error)}</Notice>
  if (!data) return <Notice title="This kit doesn’t exist" actions={<a class="btn primary" href="#/library">Go to Library</a>}>It may have been deleted, or the link is from a backup that hasn’t been restored on this device.</Notice>

  const { d, kit, sentences, file } = data
  if (kit.status === 'building') return <Building kit={kit} />

  const cards = d.cards.filter((c) => c.kitId === kit.id)
  const counts = kitMastery(cards)
  const studyable = cards.filter((c) => c.type !== 'compare')
  const count = (f: CardFilter) => (f === 'all' ? cards.length : f === 'starred' ? cards.filter((c) => c.starred).length : counts[f])
  const shown = cards.filter((c) => filter === 'all' || (filter === 'starred' ? c.starred : c.progress.state === filter))
  const nudge = examNudge(kit)
  const examLeft = kit.examDate ? daysUntil(kit.examDate) : -1
  const disabled: Record<string, string | null> = {
    learn: studyable.length ? null : 'No cards to learn yet',
    flashcards: cards.length ? null : 'No cards yet',
    test: studyable.length < 4 ? 'Needs at least 4 cards' : null,
  }

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
          sub={<>
            {kit.sourceType === 'pdf' ? `${kit.fileName}${kit.pageCount ? ` · ${plural(kit.pageCount, 'page')}` : ''}` : 'Pasted notes'} · {plural(cards.length, 'card')} · added {fmtDate(kit.createdAt)}
            {examLeft >= 0 && <> · <span class="warning-text">Exam {fmtDate(parseDayKey(kit.examDate!))} ({examLeft === 0 ? 'today' : `in ${plural(examLeft, 'day')}`})</span></>}
            {' '}<button class="link" onClick={() => { setName(kit.title); setRenaming(true) }}>Rename</button>
          </>}
        />
      )}
      {saved && <p class="muted small" role="status">{saved}</p>}

      <nav class="mode-tiles" aria-label="Study modes">
        {MODES.map((m) => disabled[m.id] ? (
          <span key={m.id} class="mode-tile disabled" aria-disabled="true">
            <span class="mode-icon"><Icon name={m.icon} /></span>
            <span class="mode-text"><strong>{m.label}</strong><span class="small muted">{disabled[m.id]}</span></span>
          </span>
        ) : (
          <a key={m.id} class="mode-tile" href={`#/${m.id}/${kit.id}`}>
            <span class="mode-icon"><Icon name={m.icon} /></span>
            <span class="mode-text"><strong>{m.label}</strong><span class="small muted">{m.blurb}</span></span>
          </a>
        ))}
      </nav>

      {nudge !== null && !disabled.test && (
        <Notice tone="warning" title={nudge === 0 ? 'Your exam is today' : `Your exam is in ${plural(nudge, 'day')}`} actions={<a class="btn primary" href={`#/test/${kit.id}`}>Take a practice test</a>}>
          A practice test shows which topics need another round of Learn.
        </Notice>
      )}

      <section class="card stack-sm" aria-label="Your progress">
        <div class="row-line"><strong>Your progress</strong><span class="small muted">{masteryLine(counts)}</span></div>
        <MasteryBar counts={counts} large />
      </section>

      {!kit.quizEnabled && (
        <Notice tone="warning" title="Short notes, simpler questions" actions={<a class="btn" href="#/library?import=paste">Paste more notes as a new kit</a>}>
          {kit.quizReason ?? 'There wasn’t enough text to write multiple-choice questions.'} Multiple choice uses the kit’s other answers as options.
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
