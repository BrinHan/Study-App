import { State } from 'ts-fsrs'
import { useAsync } from '../lib/hooks'
import { daysUntil, dueByKit, estMinutes, forecast, laterToday, loadStudyData, parseDayKey, todayQueue, type StudyData } from '../lib/study'
import { getImport } from '../lib/importer'
import { Bars, Badge, Loading, Notice, PageHeader, addDaysLabel, fmtDate, fmtTime, plural } from '../ui'

function FirstLaunch() {
  return (
    <div class="stack">
      <PageHeader title="Make your first kit" sub="Margin turns your own notes into flashcards and quizzes, and tells you what to review each day." />
      <section class="card stack">
        <ol class="steps-list">
          <li><strong>Import</strong> a text-based PDF (up to 10 MB) or paste your notes.</li>
          <li><strong>Review</strong> the cards Margin writes. Every answer links back to the exact sentence in your notes.</li>
          <li><strong>Come back</strong> when cards are due. Margin spaces reviews so you see each card just before you’d forget it.</li>
        </ol>
        <div class="actions">
          <a class="btn primary" href="#/library?import=pdf">Choose a PDF</a>
          <a class="btn" href="#/library?import=paste">Paste text</a>
        </div>
        <p class="muted small">Your notes and cards are stored only on this device. Nothing is uploaded.</p>
      </section>
    </div>
  )
}

function DueCard({ d }: { d: StudyData }) {
  const queue = todayQueue(d)
  const later = laterToday(d)
  if (queue.length === 0) {
    const tomorrow = forecast(d, 2)[1]
    const quizKit = d.kits.find((k) => k.quizEnabled && k.status === 'ready')
    return (
      <section class="card stack">
        <h2>All caught up</h2>
        <p class="muted">
          {later.count > 0 && later.next
            ? `${plural(later.count, 'card')} come${later.count === 1 ? 's' : ''} back later today, the first at ${fmtTime(later.next)}.`
            : tomorrow > 0 ? `Next up: ${plural(tomorrow, 'card')} tomorrow.` : 'Nothing is scheduled for tomorrow.'}
          {' '}New cards are capped at {d.settings.newPerDay} a day (change this in Settings).
        </p>
        <div class="actions">
          {quizKit && <a class="btn" href={`#/review?mode=quiz&kit=${quizKit.id}`}>Practice quiz</a>}
          <a class="btn" href="#/library?import=pdf">Import more notes</a>
        </div>
      </section>
    )
  }
  const fresh = queue.filter((c) => c.fsrs.state === State.New).length
  return (
    <section class="card due-card">
      <div>
        <p class="big-number">{queue.length}</p>
        <p class="muted">{plural(queue.length, 'card')} due · about {estMinutes(queue.length)} min{fresh ? ` · ${fresh} new` : ''}</p>
        {later.count > 0 && later.next && <p class="muted small">{plural(later.count, 'more card')} come{later.count === 1 ? 's' : ''} back later today, from {fmtTime(later.next)}.</p>}
      </div>
      <a class="btn primary" href="#/review">Start review</a>
    </section>
  )
}

export function Today() {
  const { data: d, loading, error } = useAsync(loadStudyData)
  if (loading) return <Loading label="Loading today’s cards…" />
  if (error || !d) return <Notice tone="danger" title="Today’s cards couldn’t be loaded" actions={<button class="btn primary" onClick={() => location.reload()}>Reload</button>}>{String(error)}</Notice>
  const building = d.kits.filter((k) => k.status === 'building')
  if (d.kits.length === 0) return <FirstLaunch />

  const now = new Date()
  const days = forecast(d)
  const due = dueByKit(d)
  const labels = days.map((_, i) => addDaysLabel(i))
  const ready = d.kits.filter((k) => k.status === 'ready')
  const exams = ready.filter((k) => k.examDate && daysUntil(k.examDate) >= 0).sort((a, b) => a.examDate!.localeCompare(b.examDate!))
  const mixups = d.confusions.filter((c) => c.count >= 2 && c.compareCardId).sort((a, b) => b.count - a.count)
  const kitTitle = new Map(d.kits.map((k) => [k.id, k.title]))

  return (
    <div class="stack">
      <PageHeader title="Today" sub={now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} />
      {building.map((k) => (
        <Notice key={k.id} tone="neutral" title={`Still building “${k.title}”`} actions={<a class="btn" href={getImport()?.kitId === k.id ? '#/library' : `#/kit/${k.id}`}>See progress</a>}>
          Its cards will show up here when the import finishes.
        </Notice>
      ))}
      <div class="grid-2">
        <div class="stack">
          <DueCard d={d} />
          <section class="card stack">
            <h2>Next 7 days</h2>
            <Bars values={days} labels={labels} highlight={0} />
          </section>
          <section class="card stack">
            <h2>Kits</h2>
            {ready.length === 0 && <p class="muted">No finished kits yet.</p>}
            <ul class="rows">
              {ready.map((k) => {
                const n = due.get(k.id) ?? 0
                return (
                  <li class="row" key={k.id}>
                    <a href={`#/kit/${k.id}`} class="row-main">{k.title}</a>
                    <span class="muted small">{n ? `${n} due` : 'Nothing due'}</span>
                    {n > 0 && <a class="btn small" href={`#/review?kit=${k.id}`}>Review</a>}
                  </li>
                )
              })}
            </ul>
          </section>
        </div>
        <div class="stack">
          <section class="card stack">
            <h2>Upcoming exams</h2>
            {exams.length === 0 ? (
              <p class="muted small">No exam dates set. Add one on a kit’s page and Margin adds extra reviews so every card is seen at least twice before it.</p>
            ) : (
              <ul class="rows">
                {exams.map((k) => {
                  const left = daysUntil(k.examDate!)
                  const behind = d.cards.filter((c) => c.kitId === k.id && c.fsrs.reps < 2).length
                  return (
                    <li class="row" key={k.id}>
                      <a href={`#/kit/${k.id}`} class="row-main">{k.title}</a>
                      <Badge tone={left <= 3 ? 'warning' : 'neutral'}>{left === 0 ? 'Today' : `In ${plural(left, 'day')}`}</Badge>
                      <span class="muted small full">{fmtDate(parseDayKey(k.examDate!))} · {behind ? `${plural(behind, 'card')} not yet seen twice` : 'every card seen twice'}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
          <section class="card stack">
            <h2>Mix-ups to fix</h2>
            {mixups.length === 0 ? (
              <p class="muted small">None yet. If you pick the same wrong term twice, Margin makes a card comparing the two and lists it here.</p>
            ) : (
              <ul class="rows">
                {mixups.map((c) => (
                  <li class="row" key={c.id}>
                    <span class="row-main">You picked “{c.termB}” for “{c.termA}” {c.count}×</span>
                    <span class="muted small">{kitTitle.get(c.kitId)}</span>
                    <a class="btn small" href={`#/review?mode=retry&cards=${encodeURIComponent(c.compareCardId!)}`}>Compare them</a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
