import { useAsync } from '../lib/hooks'
import { daysUntil, examNudge, lastActivity, loadStudyData, type StudyData } from '../lib/study'
import { getImport } from '../lib/importer'
import type { Kit, StudySession } from '../lib/types'
import type { LearnState } from '../study/learn'
import type { FlashState } from '../study/flashcards'
import { kitMastery } from '../study/mastery'
import { Badge, Loading, Notice, PageHeader, plural } from '../ui'
import { MasteryBar, masteryLine } from './study/shared'

function FirstLaunch() {
  return (
    <div class="stack">
      <PageHeader title="Make your first kit" sub="Margin turns your own notes into cards you can Learn, flip through as Flashcards, or Test yourself on." />
      <section class="card stack">
        <ol class="steps-list">
          <li><strong>Import</strong> a PDF, photos of handwritten notes, or pasted text.</li>
          <li><strong>Learn</strong> the cards in short rounds: multiple choice first, then typing the answer. Every answer links back to the exact sentence in your notes.</li>
          <li><strong>Test</strong> yourself before the exam, and see which topics need another round.</li>
        </ol>
        <div class="actions">
          <a class="btn primary" href="#/library?import=pdf">Choose a PDF or photos</a>
          <a class="btn" href="#/library?import=paste">Paste text</a>
        </div>
        <p class="muted small">Your kits and progress are stored only on this device.</p>
      </section>
    </div>
  )
}

function ExamBadge({ kit }: { kit: Kit }) {
  if (!kit.examDate) return null
  const left = daysUntil(kit.examDate)
  if (left < 0) return null
  return <Badge tone={left <= 3 ? 'warning' : 'neutral'}>{left === 0 ? 'Exam today' : `Exam in ${plural(left, 'day')}`}</Badge>
}

function sessionLine(s: StudySession, cardCount: number) {
  if (s.mode === 'learn') {
    const st = s.state as LearnState
    const done = st.order.filter((id) => st.stage[id] === 'done').length
    return `Learn · round ${st.round} · ${done} of ${plural(st.order.length, 'card')} learned`
  }
  const st = s.state as FlashState
  return `Flashcards · card ${Math.min(st.index + 1, st.deck.length)} of ${st.deck.length || cardCount}`
}

function JumpBackIn({ d }: { d: StudyData }) {
  const ready = d.kits.filter((k) => k.status === 'ready')
  const kitById = new Map(ready.map((k) => [k.id, k]))
  const session = [...d.sessions].sort((a, b) => b.updatedAt - a.updatedAt).find((s) => kitById.has(s.kitId))
  const activity = lastActivity(d)
  const studied = ready.filter((k) => activity.has(k.id)).sort((a, b) => activity.get(b.id)! - activity.get(a.id)!)[0]
  const kit = session ? kitById.get(session.kitId)! : studied ?? ready[0]
  if (!kit) return null

  const cards = d.cards.filter((c) => c.kitId === kit.id)
  const counts = kitMastery(cards)
  const nudge = examNudge(kit)
  const line = session ? sessionLine(session, cards.length) : studied ? masteryLine(counts) : `${plural(cards.length, 'card')} ready to learn`
  const action = session
    ? <a class="btn primary" href={`#/${session.mode}/${kit.id}`}>Continue {session.mode === 'learn' ? 'Learn' : 'Flashcards'}</a>
    : <a class="btn primary" href={`#/learn/${kit.id}`}>{studied ? 'Study again' : 'Start learning'}</a>

  return (
    <section class="stack" aria-labelledby="jump-h">
      <h2 id="jump-h">Jump back in</h2>
      <div class="card hero">
        <div class="hero-main">
          <div class="hero-title"><a href={`#/kit/${kit.id}`}>{kit.title}</a> <ExamBadge kit={kit} /></div>
          <p class="muted small">{line}</p>
          <MasteryBar counts={counts} />
          {nudge !== null && <p class="small"><span class="warning-text">The exam is {nudge === 0 ? 'today' : `in ${plural(nudge, 'day')}`}.</span> <a href={`#/test/${kit.id}`}>Take a practice test</a></p>}
        </div>
        <div class="actions">{action}</div>
      </div>
    </section>
  )
}

export function Home() {
  const { data: d, loading, error } = useAsync(loadStudyData)
  if (loading) return <Loading label="Loading your kits…" />
  if (error || !d) return <Notice tone="danger" title="Your kits couldn’t be loaded" actions={<button class="btn primary" onClick={() => location.reload()}>Reload</button>}>{String(error)}</Notice>
  if (d.kits.length === 0) return <FirstLaunch />

  const building = d.kits.filter((k) => k.status === 'building')
  const activity = lastActivity(d)
  const recent = d.kits
    .filter((k) => k.status === 'ready')
    .sort((a, b) => (activity.get(b.id) ?? b.createdAt) - (activity.get(a.id) ?? a.createdAt))
    .slice(0, 6)
  const mixups = d.confusions.filter((c) => c.count >= 2 && c.compareCardId).sort((a, b) => b.count - a.count)
  const kitTitle = new Map(d.kits.map((k) => [k.id, k.title]))

  return (
    <div class="stack">
      <PageHeader title="Home" />
      {building.map((k) => (
        <Notice key={k.id} tone="neutral" title={`Still building “${k.title}”`} actions={<a class="btn" href={getImport()?.kitId === k.id ? '#/library' : `#/kit/${k.id}`}>See progress</a>}>
          Its cards will show up when the import finishes.
        </Notice>
      ))}
      <JumpBackIn d={d} />

      {recent.length > 0 && (
        <section class="stack" aria-labelledby="recent-h">
          <div class="section-head">
            <h2 id="recent-h">Recent kits</h2>
            <a class="small" href="#/library">View library</a>
          </div>
          <ul class="kit-grid">
            {recent.map((k) => {
              const cards = d.cards.filter((c) => c.kitId === k.id)
              const counts = kitMastery(cards)
              return (
                <li key={k.id}>
                  <a class="card kit-card" href={`#/kit/${k.id}`}>
                    <strong class="kit-title">{k.title}</strong>
                    <span class="muted small">{plural(cards.length, 'card')} · {k.sourceType === 'pdf' ? (k.transcript && !/\.pdf$/i.test(k.fileName ?? '') ? 'Photos' : 'PDF') : 'Pasted notes'}</span>
                    <MasteryBar counts={counts} />
                    <span class="kit-meta">
                      <span class="small muted">{counts.total ? Math.round((counts.mastered / counts.total) * 100) : 0}% mastered</span>
                      <ExamBadge kit={k} />
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      )}

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
                <a class="btn small" href={`#/flashcards/${c.kitId}?cards=${encodeURIComponent(c.compareCardId!)}`}>Compare them</a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
