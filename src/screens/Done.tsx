import { useEffect, useState } from 'preact/hooks'
import { useAsync } from '../lib/hooks'
import { cite, forecast, getLastSession, loadStudyData, resolveSource, RATING_LABEL } from '../lib/study'
import type { Sentence } from '../lib/types'
import { Bars, Highlight, Loading, Notice, PageHeader, Prompt, addDaysLabel, plural } from '../ui'

export function Done() {
  const session = getLastSession()
  const { data: d, loading } = useAsync(loadStudyData)
  const [sources, setSources] = useState<Record<string, Sentence | null>>({})

  const missed = session?.results.filter((r) => !r.correct) ?? []
  useEffect(() => {
    if (!d) return
    Promise.all(missed.map(async (r) => {
      const card = d.cards.find((c) => c.id === r.cardId)
      return [r.cardId, card ? (await resolveSource(card))?.sentence ?? null : null] as const
    })).then((pairs) => setSources(Object.fromEntries(pairs)))
  }, [d])

  if (!session) {
    return <Notice title="No finished session to show" actions={<a class="btn primary" href="#/today">Go to Today</a>}>A summary appears here right after you finish or end a review session. Reloading the page clears it, but every answer is still saved.</Notice>
  }
  if (loading || !d) return <Loading label="Adding up your session…" />

  const remembered = session.results.filter((r) => r.correct).length
  const mastered = session.results.filter((r) => r.newlyMastered).length
  const days = forecast(d)
  const kitById = new Map(d.kits.map((k) => [k.id, k]))

  return (
    <div class="stack">
      <PageHeader title={session.results.length ? 'Session done' : 'Session ended'} sub={plural(session.results.length, 'card') + ' answered'} />
      {session.endedEarly && session.notReached > 0 && (
        <Notice tone="neutral" title="You ended early">
          Your {plural(session.results.length, 'answer')} {session.results.length === 1 ? 'is' : 'are'} saved. The other {plural(session.notReached, 'card')} stay due and will be first in your next review.
        </Notice>
      )}
      {session.notes.map((n) => <Notice key={n} tone="accent" title="Mix-up card added" actions={<a class="btn" href="#/today">See Mix-ups to fix</a>}>{n}</Notice>)}
      <div class="tiles">
        <div class="card tile"><span class="big-number">{remembered}</span><span class="muted">remembered</span></div>
        <div class="card tile"><span class="big-number">{missed.length}</span><span class="muted">forgot or missed</span></div>
        <div class="card tile"><span class="big-number">{mastered}</span><span class="muted">newly mastered <span class="small">(next review 3+ weeks away)</span></span></div>
      </div>

      {missed.length > 0 && (
        <section class="card stack">
          <div class="section-head">
            <h2>Missed cards</h2>
            <a class="btn primary" href={`#/review?mode=retry&cards=${missed.map((r) => encodeURIComponent(r.cardId)).join(',')}`}>Retry missed cards now</a>
          </div>
          <ul class="rows">
            {missed.map((r) => {
              const card = d.cards.find((c) => c.id === r.cardId)
              if (!card) return null
              const src = sources[r.cardId]
              const kit = kitById.get(card.kitId)
              return (
                <li class="row stack-sm" key={r.cardId}>
                  <span><Prompt text={card.prompt} /></span>
                  <span class="small">Answer: <strong>{card.answer}</strong>{r.picked && r.picked !== card.answer && <> · you picked “{r.picked}”</>} · rated {RATING_LABEL[r.rating]}</span>
                  {src && (
                    <span class="small muted">
                      <Highlight text={src.text} term={card.answer} />{' '}
                      <a class="cite" href={`#/kit/${card.kitId}?tab=source&at=${encodeURIComponent(src.id)}`}>{cite(kit, src)}</a>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section class="card stack">
        <h2>Coming up</h2>
        <p class="muted small">{days[1] ? `${plural(days[1], 'card')} tomorrow` : 'Nothing tomorrow'} · {plural(days.slice(1).reduce((a, b) => a + b, 0), 'card')} over the next 6 days</p>
        <Bars values={days} labels={days.map((_, i) => addDaysLabel(i))} highlight={0} />
        <div class="actions">
          <a class="btn" href="#/today">Back to Today</a>
          {session.kitId && <a class="btn" href={`#/kit/${session.kitId}`}>Open kit</a>}
        </div>
      </section>
    </div>
  )
}
