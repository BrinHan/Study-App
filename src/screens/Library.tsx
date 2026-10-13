import { useEffect, useRef, useState } from 'preact/hooks'
import { useAsync } from '../lib/hooks'
import { daysUntil, dueByKit, loadStudyData, parseDayKey } from '../lib/study'
import { cancelImport, classifyPicked, countWords, dismissImport, MIN_PASTE_WORDS, getImport, startImport, subscribeImport, type ImportInput, type ImportState } from '../lib/importer'
import { Badge, Icon, Loading, Notice, PageHeader, fmtDate, plural } from '../ui'

export function useImportState() {
  const [s, setS] = useState<ImportState | null>(getImport())
  useEffect(() => subscribeImport(setS), [])
  return s
}

export function ImportSteps({ s }: { s: ImportState }) {
  return (
    <ol class="import-steps">
      {s.steps.map((st) => (
        <li key={st.key} class={st.state}>
          <span class="step-icon"><Icon name={st.state === 'done' ? 'check' : st.state === 'active' ? 'spinner' : 'dot'} size={18} /></span>
          <span>{st.label}</span>
          <span class="visually-hidden">{st.state === 'done' ? '(done)' : st.state === 'active' ? '(in progress)' : '(waiting)'}</span>
        </li>
      ))}
    </ol>
  )
}

type Filter = 'all' | 'due' | 'exam'

export function Library({ query }: { query: URLSearchParams }) {
  const imp = useImportState()
  const { data: d, loading, error } = useAsync(loadStudyData)
  const [pasting, setPasting] = useState(query.get('import') === 'paste')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const fileInput = useRef<HTMLInputElement>(null)
  const pdfButton = useRef<HTMLButtonElement>(null)
  const lastInput = useRef<ImportInput | null>(null)

  useEffect(() => {
    if (query.get('import') === 'paste') setPasting(true)
    if (query.get('import') === 'pdf') pdfButton.current?.focus()
  }, [query.toString()])

  const run = (input: ImportInput) => {
    lastInput.current = input
    startImport(input)
  }
  const choosePdf = () => { dismissImport(); fileInput.current?.click() }
  const pasteInstead = () => { dismissImport(); setPasting(true) }

  const running = imp?.status === 'running'
  const kits = d?.kits ?? []
  const dueCounts = d ? dueByKit(d) : new Map<string, number>()
  const dueOf = (id: string) => dueCounts.get(id) ?? 0
  const examSoon = (k: (typeof kits)[number]) => !!k.examDate && daysUntil(k.examDate) >= 0 && daysUntil(k.examDate) <= 14
  const shown = kits.filter((k) => filter === 'all' || (filter === 'due' ? dueOf(k.id) > 0 : examSoon(k)))
  const counts = { all: kits.length, due: kits.filter((k) => dueOf(k.id) > 0).length, exam: kits.filter(examSoon).length }

  const errorActions = (code: string) => {
    switch (code) {
      case 'too-big': case 'scanned': case 'not-pdf': case 'password':
        return <><button class="btn primary" onClick={pasteInstead}>Paste text instead</button><button class="btn" onClick={choosePdf}>Choose another PDF</button></>
      case 'empty-paste': return <button class="btn primary" onClick={pasteInstead}>Edit pasted text</button>
      case 'too-little':
        return imp?.source === 'pdf'
          ? <><button class="btn primary" onClick={choosePdf}>Choose another PDF</button><button class="btn" onClick={pasteInstead}>Paste text instead</button></>
          : <button class="btn primary" onClick={pasteInstead}>Edit pasted text</button>
      case 'storage-full':
        return <><a class="btn primary" href="#/settings">Free up space in Settings</a><button class="btn" onClick={dismissImport}>Dismiss</button></>
      case 'storage-blocked':
        return <a class="btn primary" href="#/settings?section=storage">How to fix blocked storage</a>
      default:
        return <><button class="btn primary" onClick={() => lastInput.current && run(lastInput.current)} disabled={!lastInput.current}>Try again</button><button class="btn" onClick={dismissImport}>Dismiss</button></>
    }
  }
  const errorTitle: Record<string, string> = {
    'too-big': 'This PDF is over the 10 MB limit',
    scanned: 'No readable text in this PDF',
    'not-pdf': 'This file couldn’t be read',
    password: 'This PDF is locked',
    'empty-paste': 'Not enough text',
    'too-little': 'Not enough text to make cards',
    'storage-full': 'Storage is full',
    'storage-blocked': 'Storage is blocked',
    unknown: 'The import didn’t finish',
  }

  return (
    <div class="stack">
      <PageHeader title="Library" sub="Each PDF or paste becomes a kit of cards, with a summary and links back to your notes." />

      <section class="card stack" aria-labelledby="import-h">
        <h2 id="import-h">Add notes</h2>
        <div class="actions">
          <button ref={pdfButton} class="btn primary" onClick={choosePdf} disabled={running}><Icon name="file" /> Choose a PDF</button>
          <button class="btn" onClick={() => setPasting(!pasting)} disabled={running} aria-expanded={pasting}><Icon name="paste" /> Paste text</button>
          <input ref={fileInput} type="file" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple class="visually-hidden" tabIndex={-1} aria-hidden="true"
            onChange={(e) => {
              const el = e.target as HTMLInputElement
              const files = [...(el.files ?? [])]
              el.value = ''
              if (!files.length) return
              setPasting(false)
              const pick = classifyPicked(files)
              run(pick.kind === 'pdf' ? { file: files[pick.index] } : pick.kind === 'photos' ? { photos: pick.order.map((i) => files[i]) } : { invalid: true })
            }} />
        </div>
        <p class="muted small">PDFs up to 10 MB, or photos of handwritten notes (up to 20 pages). Scanned and handwritten pages are read with AI.</p>

        {pasting && !running && (
          <form class="stack" onSubmit={(e) => { e.preventDefault(); run({ text, title }); if (countWords(text) >= MIN_PASTE_WORDS) { setPasting(false); setText(''); setTitle('') } }}>
            <label class="field">
              <span>Kit name</span>
              <input value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} placeholder="e.g. Biology – chapter 3" />
            </label>
            <label class="field">
              <span>Notes</span>
              <textarea rows={10} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} placeholder="Paste full sentences. Lines starting with # are used as topic headings." />
            </label>
            <div class="actions">
              <button class="btn primary" type="submit">Make cards</button>
              <button class="btn" type="button" onClick={() => setPasting(false)}>Cancel</button>
              <span class="muted small">{plural(countWords(text), 'word')}</span>
            </div>
          </form>
        )}

        {imp && imp.status === 'running' && (
          <div class="panel stack" aria-live="polite">
            <strong>Importing “{imp.title}”</strong>
            <ImportSteps s={imp} />
            <div class="actions"><button class="btn" onClick={cancelImport}>Cancel import</button></div>
          </div>
        )}
        {imp?.status === 'done' && imp.result && (
          <Notice tone="success" title={`Made ${plural(imp.result.cards, 'card')} from “${imp.title}”`}
            actions={<><a class="btn primary" href={`#/review?kit=${imp.kitId}`} onClick={dismissImport}>Start review</a><a class="btn" href={`#/kit/${imp.kitId}`} onClick={dismissImport}>Open kit</a><button class="btn" onClick={dismissImport}>Dismiss</button></>}>
            Took {(imp.result.ms / 1000).toFixed(1)} s.{!imp.result.quizEnabled && ' This kit has flashcards only; open it to see why.'}
          </Notice>
        )}
        {imp?.status === 'error' && imp.error && (
          <Notice tone="danger" title={errorTitle[imp.error.code] ?? 'The import didn’t finish'} actions={errorActions(imp.error.code)}>
            <p>{imp.error.message}</p>
            {imp.error.code === 'storage-full' && <p>Removing original PDFs in Settings frees space and keeps every card.</p>}
          </Notice>
        )}
      </section>

      <section class="stack" aria-labelledby="kits-h">
        <div class="section-head">
          <h2 id="kits-h">Kits</h2>
          {kits.length > 0 && (
            <div class="segmented" role="group" aria-label="Filter kits">
              {(['all', 'due', 'exam'] as Filter[]).map((f) => (
                <button key={f} class={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {{ all: 'All', due: 'Due today', exam: 'Exam soon' }[f]} <span class="muted">{counts[f]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {loading && <Loading label="Loading kits…" />}
        {error && <Notice tone="danger" title="Kits couldn’t be loaded">{String(error)}</Notice>}
        {d && kits.length === 0 && (
          <div class="card empty">
            <p><strong>No kits yet.</strong> Choose a PDF or paste notes above; your first kit appears here.</p>
            <p class="muted small">Try the sample in the project’s <code>samples/</code> folder if you don’t have notes handy.</p>
          </div>
        )}
        {d && kits.length > 0 && shown.length === 0 && (
          <div class="card empty">
            <p>{filter === 'due' ? 'No kits have cards due today.' : 'No kits have an exam in the next 14 days.'}</p>
            <button class="btn" onClick={() => setFilter('all')}>Show all kits</button>
          </div>
        )}
        <ul class="kit-grid">
          {shown.map((k) => {
            const cards = d!.cards.filter((c) => c.kitId === k.id).length
            const due = dueOf(k.id)
            return (
              <li key={k.id}>
                <a class="card kit-card" href={`#/kit/${k.id}`}>
                  <strong class="kit-title">{k.title}</strong>
                  <span class="muted small">{k.sourceType === 'pdf' ? `PDF${k.pageCount ? ` · ${plural(k.pageCount, 'page')}` : ''}` : 'Pasted notes'} · added {fmtDate(k.createdAt)}</span>
                  <span class="kit-meta">
                    {k.status === 'building' ? <Badge tone="warning">Building…</Badge> : <>
                      <span>{plural(cards, 'card')}</span>
                      {due > 0 ? <Badge tone="accent">{due} due</Badge> : <Badge>Nothing due</Badge>}
                      {k.examDate && daysUntil(k.examDate) >= 0 && <Badge tone="warning">Exam {fmtDate(parseDayKey(k.examDate))}</Badge>}
                    </>}
                  </span>
                </a>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
