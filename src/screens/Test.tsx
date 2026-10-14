import { useEffect, useState } from 'preact/hooks'
import { isQuotaError } from '../lib/db'
import { notifyDataChanged } from '../lib/hooks'
import { loadStudyData, recordAnswer } from '../lib/study'
import type { AnswerFormat, Kit, StudyCard } from '../lib/types'
import { newSeed } from '../study/random'
import { answeredCount, buildTest, eligibleForTest, gradeTest, QTYPE_ORDER, type QResult, type QType, type TestAnswers, type TestQuestion } from '../study/test'
import { Highlight, Loading, Notice, Prompt, plural } from '../ui'
import { NoCards, ScoreRing, SourceQuote, StudyHeader, recordConfusion } from './study/shared'

const TYPE_LABEL: Record<QType, string> = { tf: 'True or false', mcq: 'Multiple choice', match: 'Matching', written: 'Written' }
const FORMAT: Record<QType, AnswerFormat> = { tf: 'tf', mcq: 'mcq', match: 'match', written: 'written' }
const MIN_CARDS = 4
const key = (qid: string, cardId: string) => `${qid}|${cardId}`

interface Setup { count: number; types: QType[]; starredOnly: boolean }
/** Saved answers, so an "I was right" override can replace the logged one. */
interface Logged { before: StudyCard; reviewId: string }

export function TestMode({ kitId }: { kitId: string; query: URLSearchParams }) {
  const [data, setData] = useState<{ kit: Kit; cards: StudyCard[] } | null | undefined>(undefined)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [setup, setSetup] = useState<Setup>({ count: 20, types: [...QTYPE_ORDER], starredOnly: false })
  const [questions, setQuestions] = useState<TestQuestion[] | null>(null)
  const [answers, setAnswers] = useState<TestAnswers>({})
  const [confirming, setConfirming] = useState(false)
  const [graded, setGraded] = useState<{ overrides: Set<string>; logged: Map<string, Logged>; notes: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadStudyData().then((d) => {
      const kit = d.kits.find((k) => k.id === kitId && k.status === 'ready')
      setData(kit ? { kit, cards: d.cards.filter((c) => c.kitId === kit.id) } : null)
    }, setLoadError)
  }, [])

  if (loadError) return <div class="study-col"><Notice tone="danger" title="The test couldn’t start" actions={<a class="btn primary" href="#/home">Go to Home</a>}>{String(loadError)}</Notice></div>
  if (data === undefined) return <div class="study-col"><Loading label="Writing your test…" /></div>
  if (data === null) return <div class="study-col"><Notice title="This kit doesn’t exist" actions={<a class="btn primary" href="#/library">Go to Library</a>}>It may have been deleted, or it’s still being built.</Notice></div>

  const { kit, cards } = data
  const byId = new Map(cards.map((c) => [c.id, c]))
  const eligible = eligibleForTest(cards, setup.starredOnly)
  const fail = (e: unknown) => setError(isQuotaError(e) ? 'Your device is out of storage, so the results weren’t saved.' : `The results weren’t saved (${String((e as Error)?.message ?? e)}).`)

  // ---- Setup
  if (!questions) {
    if (eligibleForTest(cards).length < MIN_CARDS) {
      return <><StudyHeader kit={kit} mode="test" /><NoCards kit={kit} mode="Test" reason={`A test needs at least ${MIN_CARDS} cards; this kit has ${eligibleForTest(cards).length}.`} /></>
    }
    const counts = [...new Set([10, 20, eligible.length].filter((n) => n <= eligible.length))]
    const count = Math.min(setup.count, eligible.length)
    const start = () => {
      const qs = buildTest(cards, cards, { ...setup, count }, newSeed())
      if (!qs.length) return setError('No questions could be made with these settings.')
      setError(null); setAnswers({}); setGraded(null); setConfirming(false)
      setQuestions(qs)
      window.scrollTo(0, 0)
    }
    const toggleType = (t: QType) => setSetup({ ...setup, types: setup.types.includes(t) ? setup.types.filter((x) => x !== t) : [...setup.types, t] })
    return (
      <>
        <StudyHeader kit={kit} mode="test" label="Set up" />
        <div class="study-col">
          <form class="card stack" onSubmit={(e) => { e.preventDefault(); start() }} aria-labelledby="setup-h">
            <h1 id="setup-h">Set up your test</h1>
            <div class="stack-sm">
              <span class="small muted strong">Questions</span>
              <div class="segmented" role="group" aria-label="Number of questions">
                {counts.map((n) => (
                  <button type="button" key={n} class={count === n ? 'on' : ''} aria-pressed={count === n} onClick={() => setSetup({ ...setup, count: n })}>{n === eligible.length ? `All ${n}` : n}</button>
                ))}
              </div>
            </div>
            <label class="check">
              <input type="checkbox" checked={setup.starredOnly} onChange={(e) => setSetup({ ...setup, starredOnly: (e.target as HTMLInputElement).checked })} />
              Starred cards only <span class="small muted">({cards.filter((c) => c.starred && c.type !== 'compare').length} starred)</span>
            </label>
            <fieldset class="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend class="small muted strong">Question types</legend>
              <div class="type-grid">
                {QTYPE_ORDER.map((t) => (
                  <label key={t} class="check">
                    <input type="checkbox" checked={setup.types.includes(t)} disabled={setup.types.length === 1 && setup.types.includes(t)} onChange={() => toggleType(t)} />
                    {TYPE_LABEL[t]}
                  </label>
                ))}
              </div>
            </fieldset>
            {setup.starredOnly && eligible.length === 0 && <p class="small danger-text">No cards are starred yet. Star some on the kit page, or turn this off.</p>}
            {error && <p class="small danger-text" role="alert">{error}</p>}
            <div class="actions"><button class="btn primary" type="submit" disabled={!eligible.length}>Start test</button></div>
          </form>
        </div>
      </>
    )
  }

  const { answered, total } = answeredCount(questions, answers)
  const set = (qid: string, v: TestAnswers[string]) => { setAnswers({ ...answers, [qid]: v }); setConfirming(false) }

  // ---- Results
  if (graded) {
    const g = gradeTest(questions, answers, byId, graded.overrides)
    const missed = [...new Set(g.results.filter((r) => !r.correct).map((r) => r.cardId))]
    const topics = new Map<string, { right: number; total: number }>()
    for (const r of g.results) {
      const t = byId.get(r.cardId)?.topic ?? ''
      const s = topics.get(t) ?? { right: 0, total: 0 }
      s.total++
      if (r.correct) s.right++
      topics.set(t, s)
    }
    const weakest = [...topics].filter(([, s]) => s.total >= 2 && s.right < s.total).sort((a, b) => a[1].right / a[1].total - b[1].right / b[1].total)[0]

    const override = async (r: QResult) => {
      const k = key(r.qid, r.cardId)
      const logged = graded.logged.get(k)
      if (!logged || busy) return
      setBusy(true)
      try {
        const { reviewId } = await recordAnswer(logged.before, true, { mode: 'test', format: FORMAT[r.kind] }, logged.reviewId)
        setGraded({ ...graded, overrides: new Set(graded.overrides).add(k), logged: new Map(graded.logged).set(k, { ...logged, reviewId }) })
        notifyDataChanged()
      } catch (e) {
        fail(e)
      } finally {
        setBusy(false)
      }
    }

    return (
      <>
        <StudyHeader kit={kit} mode="test" label="Results" />
        <div class="study-col wide">
          <section class="card results-head">
            <ScoreRing value={g.total ? g.score / g.total : 0} label={`${g.score} of ${g.total} right`} />
            <div>
              <h1>{g.score === g.total ? 'Every answer right' : g.score / g.total >= 0.7 ? `Nice work: ${g.score} of ${g.total}` : `${g.score} of ${g.total} right`}</h1>
              {weakest && <p class="muted small">Weakest topic: {weakest[0] === kit.title ? 'No heading' : weakest[0]} ({weakest[1].right} of {weakest[1].total}).</p>}
              <div class="actions">
                {missed.length > 0 && <a class="btn primary" href={`#/learn/${kit.id}?cards=${missed.map(encodeURIComponent).join(',')}`}>Learn the {plural(missed.length, 'card')} you missed</a>}
                <button class={`btn${missed.length ? '' : ' primary'}`} onClick={() => { setQuestions(null); setGraded(null) }}>New test</button>
                <a class="btn" href={`#/kit/${kit.id}`}>Back to kit</a>
              </div>
            </div>
          </section>
          {error && <Notice tone="danger" title="Not saved">{error}</Notice>}
          {graded.notes.map((n) => <Notice key={n} tone="accent" title="Mix-up card added">{n}</Notice>)}
          <h2>Your answers</h2>
          <ul class="rows">
            {g.results.map((r, i) => {
              const card = byId.get(r.cardId)
              if (!card) return null
              const q = questions.find((x) => x.id === r.qid)!
              const overridden = graded.overrides.has(key(r.qid, r.cardId))
              return (
                <li key={key(r.qid, r.cardId)} class={`answer-row${r.correct ? '' : ' wrong'}`}>
                  <div class="q-head">
                    <span class="badge">{TYPE_LABEL[r.kind]} · {i + 1}</span>
                    <strong class={r.correct ? 'ok-mark' : 'bad-mark'}>{r.correct ? (overridden ? '✓ Counted as right' : r.close ? '✓ Right (small typo)' : '✓ Right') : '✕ Wrong'}</strong>
                  </div>
                  <p>{q.kind === 'tf' ? <Highlight text={q.statement} term={q.shown} /> : <Prompt text={card.prompt} />}</p>
                  <p class="small">
                    {q.kind === 'tf'
                      ? <>You said <strong>{r.given ? (r.given === 'true' ? 'True' : 'False') : 'nothing'}</strong> · it’s <strong>{q.isTrue ? 'true' : `false; the answer is ${card.answer}`}</strong></>
                      : <>You said {r.given ? <strong class={r.correct ? '' : 'struck'}>{r.given}</strong> : <span class="muted">nothing</span>} · Answer <strong class="ok-mark">{card.answer}</strong></>}
                  </p>
                  {r.kind === 'written' && !r.correct && r.given && <div><button class="btn small" onClick={() => override(r)} disabled={busy}>I was right</button></div>}
                  {!r.correct && (
                    <details>
                      <summary class="small cite-line">Show the passage</summary>
                      <SourceQuote card={card} sentenceId={card.sourceSentenceId} term={card.answer} kit={kit} label="From your notes" />
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </>
    )
  }

  // ---- Question sheet
  const submit = async () => {
    if (answered < total && !confirming) return setConfirming(true)
    setBusy(true)
    setError(null)
    const g = gradeTest(questions, answers, byId)
    const logged = new Map<string, Logged>()
    const notes: string[] = []
    try {
      const current = new Map(byId)
      for (const r of g.results) {
        const card = current.get(r.cardId)
        if (!card) continue
        const { card: updated, reviewId } = await recordAnswer(card, r.correct, { mode: 'test', format: FORMAT[r.kind], picked: r.kind === 'mcq' ? r.given || undefined : undefined })
        logged.set(key(r.qid, r.cardId), { before: card, reviewId })
        current.set(card.id, updated)
        if (r.kind === 'mcq' && !r.correct && r.given) {
          const note = await recordConfusion(card, r.given)
          if (note) notes.push(note)
        }
      }
      setData({ kit, cards: cards.map((c) => current.get(c.id) ?? c) })
      notifyDataChanged()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
    setGraded({ overrides: new Set(), logged, notes })
    window.scrollTo(0, 0)
  }

  let n = 0
  return (
    <>
      <StudyHeader kit={kit} mode="test" label={`${answered} / ${total} answered`} progress={total ? answered / total : 0} />
      <div class="study-col wide">
        {questions.map((q) => {
          const first = ++n
          if (q.kind === 'match') n += q.cardIds.length - 1
          const num = q.kind === 'match' ? `${first}–${n}` : String(first)
          const card = q.kind === 'match' ? undefined : byId.get(q.cardId)
          return (
            <section key={q.id} class="card stack" aria-labelledby={`${q.id}-h`}>
              <div class="q-head">
                <span id={`${q.id}-h`} class="badge">{TYPE_LABEL[q.kind]} · {num} of {total}</span>
              </div>
              {q.kind === 'tf' && (
                <>
                  <p class="prompt"><Highlight text={q.statement} term={q.shown} /></p>
                  <div class="tf-buttons" role="group" aria-label="True or false">
                    {(['true', 'false'] as const).map((v) => (
                      <button key={v} type="button" class={`btn${answers[q.id] === v ? ' chosen' : ''}`} aria-pressed={answers[q.id] === v} onClick={() => set(q.id, v)}>{v === 'true' ? 'True' : 'False'}</button>
                    ))}
                  </div>
                </>
              )}
              {q.kind === 'mcq' && card && (
                <>
                  <p class="prompt"><Prompt text={card.prompt} /></p>
                  <ul class="options" role="radiogroup" aria-labelledby={`${q.id}-h`}>
                    {q.choices.map((o) => (
                      <li key={o}>
                        <button type="button" role="radio" aria-checked={answers[q.id] === o} class={`option${answers[q.id] === o ? ' chosen-option' : ''}`} onClick={() => set(q.id, o)}>
                          <span class="grow">{o}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {q.kind === 'match' && (
                <>
                  <p class="small muted">Pick the term that fills each blank. Each term is used once.</p>
                  {q.cardIds.map((id) => {
                    const picks = (answers[q.id] ?? {}) as Record<string, string>
                    const c = byId.get(id)!
                    return (
                      <label key={id} class="match-row">
                        <span><Prompt text={c.prompt} /></span>
                        <select value={picks[id] ?? ''} onChange={(e) => set(q.id, { ...picks, [id]: (e.target as HTMLSelectElement).value })}>
                          <option value="">Choose a term…</option>
                          {q.terms.map((t) => <option key={t} value={t}>{t}{Object.entries(picks).some(([other, v]) => other !== id && v === t) ? ' (used)' : ''}</option>)}
                        </select>
                      </label>
                    )
                  })}
                </>
              )}
              {q.kind === 'written' && card && (
                <>
                  <p class="prompt"><Prompt text={card.prompt} /></p>
                  <input aria-label="Your answer" placeholder="Type the answer" value={(answers[q.id] as string) ?? ''} onInput={(e) => set(q.id, (e.target as HTMLInputElement).value)} autocomplete="off" autocapitalize="off" spellcheck={false} />
                </>
              )}
            </section>
          )
        })}
        {confirming && (
          <Notice tone="warning" title={`Submit with ${plural(total - answered, 'unanswered question')}?`} actions={<><button class="btn primary" onClick={submit} disabled={busy}>Submit anyway</button><button class="btn" onClick={() => setConfirming(false)}>Keep answering</button></>}>
            Unanswered questions count as wrong.
          </Notice>
        )}
        {error && <Notice tone="danger" title="Not saved">{error}</Notice>}
        <div class="sticky-submit">
          <span class="small muted">{answered} of {total} answered</span>
          <button class="btn primary" onClick={submit} disabled={busy}>Submit test</button>
        </div>
      </div>
    </>
  )
}
