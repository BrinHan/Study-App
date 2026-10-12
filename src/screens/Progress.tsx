import { State } from 'ts-fsrs'
import { useAsync } from '../lib/hooks'
import { addDays, isMastered, loadStudyData, recall, startOfDay, topicStats } from '../lib/study'
import { Bars, Loading, Notice, PageHeader, fmtDate, plural } from '../ui'

const MIN_REVIEWS_FOR_RECALL = 20
const pct = (x: number) => `${Math.round(x * 100)}%`

export function Progress() {
  const { data: d, loading, error } = useAsync(loadStudyData)
  if (loading) return <Loading label="Loading your progress…" />
  if (error || !d) return <Notice tone="danger" title="Progress couldn’t be loaded">{String(error)}</Notice>

  if (d.reviews.length === 0) {
    return (
      <div class="stack">
        <PageHeader title="Progress" />
        <Notice tone="neutral" title="No reviews yet"
          actions={d.cards.length ? <a class="btn primary" href="#/review">Start review</a> : <a class="btn primary" href="#/library?import=pdf">Import notes</a>}>
          {d.cards.length
            ? `You have ${plural(d.cards.length, 'card')} waiting. Stats like recall rate and weak topics appear after your first review session.`
            : 'Import a PDF or paste notes to make your first cards. Stats appear after your first review session.'}
        </Notice>
      </div>
    )
  }

  const now = new Date()
  const mastered = d.cards.filter(isMastered).length
  const last30 = d.reviews.filter((r) => r.reviewedAt >= addDays(now, -30).getTime())
  const enough = last30.length >= MIN_REVIEWS_FOR_RECALL

  // Weekly recall for the last 8 weeks (oldest first).
  const weekStart = (k: number) => addDays(startOfDay(now), -7 * (7 - k) - 6)
  const weeks = Array.from({ length: 8 }, (_, k) => {
    const from = weekStart(k).getTime()
    const to = addDays(weekStart(k), 7).getTime()
    const rs = d.reviews.filter((r) => r.reviewedAt >= from && r.reviewedAt < to)
    return { label: k === 7 ? 'This wk' : fmtDate(from), value: rs.length ? Math.round(recall(rs) * 100) : null }
  })

  const kitTitle = new Map(d.kits.map((k) => [k.id, k.title]))
  const quizKits = new Set(d.kits.filter((k) => k.quizEnabled).map((k) => k.id))
  const weak = [...topicStats(d.reviews).values()]
    .filter((t) => t.total >= 3 && kitTitle.has(t.kitId))
    .sort((a, b) => a.correct / a.total - b.correct / b.total)
    .slice(0, 5)

  const kits = d.kits.filter((k) => k.status === 'ready').map((k) => {
    const cs = d.cards.filter((c) => c.kitId === k.id)
    const m = cs.filter(isMastered).length
    const fresh = cs.filter((c) => c.fsrs.state === State.New).length
    return { k, total: cs.length, mastered: m, learning: cs.length - m - fresh, fresh }
  })

  return (
    <div class="stack">
      <PageHeader title="Progress" sub={`${plural(d.reviews.length, 'review')} in total`} />
      <div class="tiles">
        <div class="card tile">
          <span class="big-number">{mastered}</span>
          <span class="muted">of {plural(d.cards.length, 'card')} mastered</span>
          <span class="small muted">Mastered = next review is 3+ weeks away.</span>
        </div>
        <div class="card tile">
          {enough ? <>
            <span class="big-number">{pct(recall(last30))}</span>
            <span class="muted">recall rate, last 30 days</span>
            <span class="small muted">Answered right on the first try, out of {last30.length}.</span>
          </> : <>
            <span class="big-number muted">–</span>
            <span class="muted">recall rate, last 30 days</span>
            <span class="small muted">Shown after {MIN_REVIEWS_FOR_RECALL} reviews; with {last30.length} so far a single answer would swing it by {Math.round(100 / Math.max(1, last30.length))} points.</span>
          </>}
        </div>
        <div class="card tile">
          <span class="big-number">{last30.length}</span>
          <span class="muted">reviews in the last 30 days</span>
        </div>
      </div>

      <section class="card stack">
        <h2>Weekly recall</h2>
        {enough
          ? <Bars values={weeks.map((w) => w.value)} labels={weeks.map((w) => w.label)} highlight={7} format={(v) => `${v}%`} />
          : <p class="muted small">This chart appears after {MIN_REVIEWS_FOR_RECALL} reviews in the last 30 days ({MIN_REVIEWS_FOR_RECALL - last30.length} to go).</p>}
      </section>

      <div class="grid-2">
        <section class="card stack">
          <h2>Weak topics</h2>
          {weak.length === 0 ? (
            <p class="muted small">Not enough answers per topic yet. A topic is listed after 3 answers.</p>
          ) : (
            <ul class="rows">
              {weak.map((t) => (
                <li class="row" key={t.kitId + t.topic}>
                  <span class="row-main">{t.topic === kitTitle.get(t.kitId) ? 'No heading' : t.topic}<span class="muted small"> · {kitTitle.get(t.kitId)}</span></span>
                  <span class="small">{pct(t.correct / t.total)} of {t.total}</span>
                  <a class="btn small" href={quizKits.has(t.kitId) ? `#/review?mode=quiz&kit=${t.kitId}` : `#/review?kit=${t.kitId}`}>Practice</a>
                </li>
              ))}
            </ul>
          )}
          {weak.length > 0 && <p class="muted small">Practice quizzes pick more questions from topics like these.</p>}
        </section>
        <section class="card stack">
          <h2>Mastery per kit</h2>
          <ul class="rows">
            {kits.map(({ k, total, mastered: m, learning, fresh }) => (
              <li class="row stack-sm" key={k.id}>
                <span class="row-line"><a href={`#/kit/${k.id}`}>{k.title}</a><span class="small">{total ? pct(m / total) : '0%'} mastered</span></span>
                <div class="meter" role="img" aria-label={`${m} mastered, ${learning} learning, ${fresh} new`}>
                  <span class="m-mastered" style={{ width: `${total ? (m / total) * 100 : 0}%` }} />
                  <span class="m-learning" style={{ width: `${total ? (learning / total) * 100 : 0}%` }} />
                </div>
                <span class="small muted">{m} mastered · {learning} learning · {fresh} new</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
