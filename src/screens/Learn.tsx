import { useEffect, useRef, useState } from 'preact/hooks'
import { deleteSession, getSession, isQuotaError, putSession, sessionId } from '../lib/db'
import { notifyDataChanged } from '../lib/hooks'
import { loadStudyData, recordAnswer } from '../lib/study'
import type { Kit, LearnAnswer, StudyCard } from '../lib/types'
import { checkTyped } from '../study/answer'
import {
  answerItem, currentItem, eligibleForLearn, isFinished, learnProgress, learnStats, nextRound, pruneLearn, startLearn,
  type LearnItem, type LearnOptions, type LearnState,
} from '../study/learn'
import { kitMastery, STATUS_LABEL } from '../study/mastery'
import { newSeed } from '../study/random'
import { Badge, Loading, Notice, Prompt, plural } from '../ui'
import { ANSWER_LABEL, ROUND_SIZES } from './Settings'
import { NoCards, ScoreRing, SourceQuote, StudyHeader, recordConfusion, useStudyKeys } from './study/shared'

const STATUS_TONE = { new: 'neutral', learning: 'accent', mastered: 'success' } as const

interface Setup { kit: Kit; cards: StudyCard[]; options: LearnOptions; persist: boolean; subset?: string[] }
interface Feedback {
  item: LearnItem
  correct: boolean
  close: boolean
  given: string
  before: LearnState // to redo the answer on "I was right"
  cardBefore: StudyCard
  reviewId: string
  overridden?: boolean
}
type View = 'question' | 'feedback' | 'checkpoint' | 'done'

async function load(kitId: string, query: URLSearchParams) {
  const d = await loadStudyData()
  const kit = d.kits.find((k) => k.id === kitId && k.status === 'ready')
  if (!kit) return null
  const cards = d.cards.filter((c) => c.kitId === kit.id)
  const subset = query.get('cards')?.split(',').filter(Boolean)
  const options: LearnOptions = { answer: d.settings.learnAnswer, roundSize: d.settings.roundSize, starredOnly: false }
  // A subset ("learn the ones you missed") is a one-off session and doesn't replace the saved one.
  const setup: Setup = { kit, cards, options, persist: !subset, subset }
  let state: LearnState | null = null
  if (!subset) {
    const saved = await getSession(sessionId(kit.id, 'learn'))
    if (saved) {
      const s = saved.state as LearnState
      state = s?.order ? pruneLearn(s, new Set(eligibleForLearn(cards, s.options.starredOnly).map((c) => c.id))) : null
      if (state) setup.options = state.options
    }
  }
  return { setup, state: state ?? fresh(setup) }
}

function fresh(setup: Setup, options = setup.options) {
  const pick = setup.subset ? setup.cards.filter((c) => setup.subset!.includes(c.id)) : setup.cards
  return startLearn(setup.kit.id, pick, setup.cards, options, newSeed())
}

export function Learn({ kitId, query }: { kitId: string; query: URLSearchParams }) {
  const [setup, setSetup] = useState<Setup | null | undefined>(undefined)
  const [state, setState] = useState<LearnState | null>(null)
  const [cards, setCards] = useState<Map<string, StudyCard>>(new Map())
  const [view, setView] = useState<View>('question')
  const [fb, setFb] = useState<Feedback | null>(null)
  const [typed, setTyped] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [mixup, setMixup] = useState<string | null>(null)
  const [showOptions, setShowOptions] = useState(false)
  const [loadError, setLoadError] = useState<unknown>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    load(kitId, query).then((r) => {
      if (!r) return setSetup(null)
      setSetup(r.setup)
      setCards(new Map(r.setup.cards.map((c) => [c.id, c])))
      setState(r.state)
      if (r.state && isFinished(r.state)) setView('done')
      else if (r.state && !currentItem(r.state, r.setup.cards)) setView('checkpoint')
    }, setLoadError)
  }, [])

  const pool = [...cards.values()]
  const item = state && view === 'question' ? currentItem(state, pool) : null

  useEffect(() => {
    if (view === 'question') inputRef.current?.focus()
    else if (view === 'feedback' || view === 'checkpoint') continueRef.current?.focus()
  }, [view, item?.id, item?.format])

  const save = async (s: LearnState) => {
    if (!setup?.persist) return
    const id = sessionId(s.kitId, 'learn')
    if (isFinished(s)) await deleteSession(id)
    else await putSession({ id, kitId: s.kitId, mode: 'learn', state: s, updatedAt: Date.now() })
  }

  const fail = (e: unknown) => setSaveError(isQuotaError(e)
    ? 'Your device is out of storage, so this answer wasn’t saved.'
    : `This answer wasn’t saved (${String((e as Error)?.message ?? e)}).`)

  const answer = async (correct: boolean, given: string, close = false) => {
    if (!state || !item || busy) return
    const card = cards.get(item.id)
    if (!card) return
    setBusy(true)
    setSaveError(null)
    try {
      const { card: updated, reviewId } = await recordAnswer(card, correct, { mode: 'learn', format: item.format, picked: item.format === 'mcq' ? given : undefined })
      setMixup(item.format === 'mcq' && !correct && given ? await recordConfusion(card, given) : null)
      const next = answerItem(state, correct)
      await save(next)
      setCards(new Map(cards).set(card.id, updated))
      setFb({ item, correct, close, given, before: state, cardBefore: card, reviewId })
      setState(next)
      setView('feedback')
      notifyDataChanged()
    } catch (e) {
      setPicked(null)
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const pick = (choice: string) => {
    if (!item || picked) return
    setPicked(choice)
    answer(choice === cards.get(item.id)!.answer, choice)
  }

  const submitTyped = () => {
    if (!item) return
    const r = checkTyped(typed, cards.get(item.id)!.answer)
    answer(r !== 'wrong', typed.trim(), r === 'close')
  }

  const override = async () => {
    if (!fb || busy) return
    setBusy(true)
    try {
      const { card: updated, reviewId } = await recordAnswer(fb.cardBefore, true, { mode: 'learn', format: fb.item.format }, fb.reviewId)
      const next = answerItem(fb.before, true)
      await save(next)
      setCards(new Map(cards).set(updated.id, updated))
      setState(next)
      setFb({ ...fb, correct: true, overridden: true, reviewId })
      notifyDataChanged()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const proceed = () => {
    if (!state) return
    setTyped(''); setPicked(null); setFb(null); setMixup(null)
    if (isFinished(state)) setView('done')
    else if (!currentItem(state, pool)) setView('checkpoint')
    else setView('question')
  }

  const startNextRound = async () => {
    if (!state) return
    const next = nextRound(state)
    try { await save(next) } catch (e) { return fail(e) }
    setState(next)
    setView('question')
  }

  const restart = async (options?: LearnOptions) => {
    if (!setup) return
    const s = fresh(setup, options)
    if (options) setSetup({ ...setup, options })
    try {
      if (s) await save(s)
      else if (setup.persist) await deleteSession(sessionId(setup.kit.id, 'learn'))
    } catch (e) { return fail(e) }
    setState(s)
    setShowOptions(false)
    setTyped(''); setPicked(null); setFb(null); setMixup(null)
    setView('question')
    notifyDataChanged()
  }

  useStudyKeys((e) => {
    if (view === 'question' && item?.format === 'mcq') {
      const n = Number(e.key)
      if (n >= 1 && n <= (item.choices?.length ?? 0)) pick(item.choices![n - 1])
    } else if ((view === 'feedback' || view === 'checkpoint') && (e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)) {
      e.preventDefault()
      view === 'feedback' ? proceed() : startNextRound()
    }
  })

  if (loadError) return <div class="study-col"><Notice tone="danger" title="Learn couldn’t start" actions={<a class="btn primary" href="#/home">Go to Home</a>}>{String(loadError)}</Notice></div>
  if (setup === undefined) return <div class="study-col"><Loading label="Preparing your cards…" /></div>
  if (setup === null) return <div class="study-col"><Notice title="This kit doesn’t exist" actions={<a class="btn primary" href="#/library">Go to Library</a>}>It may have been deleted, or it’s still being built.</Notice></div>

  const { kit } = setup
  const stats = state ? learnStats(state) : { done: 0, total: 0 }
  const header = (label?: string) => (
    <StudyHeader kit={kit} mode="learn" label={label} progress={state ? learnProgress(state) : 0} onOptions={() => setShowOptions(!showOptions)} optionsOpen={showOptions} />
  )
  const optionsPanel = showOptions && <LearnOptionsPanel options={setup.options} onApply={restart} onClose={() => setShowOptions(false)} hasStarred={setup.cards.some((c) => c.starred)} />

  if (!state) {
    return (
      <>
        {header()}
        {optionsPanel}
        <NoCards kit={kit} mode="Learn" reason={setup.options.starredOnly ? 'No cards in this kit are starred. Turn off “Starred only” in Options, or star some cards on the kit page.' : 'This kit has no cards Learn can ask yet.'} />
      </>
    )
  }

  if (view === 'done') {
    const m = kitMastery(setup.cards.filter((c) => state.order.includes(c.id)).map((c) => cards.get(c.id) ?? c))
    return (
      <>
        {header('Finished')}
        <div class="study-col checkpoint">
          <ScoreRing value={1} label={`All ${stats.total} cards learned`} />
          <h1>You’ve learned every card</h1>
          <p class="muted">{plural(stats.total, 'card')} answered right at every step. {m.mastered} of them are now mastered across all modes.</p>
          <div class="actions">
            <a class="btn primary" href={`#/test/${kit.id}`}>Take a test</a>
            <a class="btn" href={`#/flashcards/${kit.id}`}>Flashcards</a>
            <button class="btn" onClick={() => restart()}>Learn again</button>
            <a class="btn" href={`#/kit/${kit.id}`}>Back to kit</a>
          </div>
        </div>
      </>
    )
  }

  if (view === 'checkpoint') {
    const right = state.roundResults.filter((r) => r.correct).length
    return (
      <>
        {header(`Round ${state.round} done`)}
        {optionsPanel}
        <div class="study-col checkpoint">
          <h1>Round {state.round} done</h1>
          <p class="muted">{right} of {state.roundResults.length} right.{right < state.roundResults.length && ` The ${plural(state.roundResults.length - right, 'card')} you missed come${state.roundResults.length - right === 1 ? 's' : ''} back next round.`}</p>
          <ScoreRing value={learnProgress(state)} label={`${Math.round(learnProgress(state) * 100)}% of the way through Learn`} />
          <p class="small muted">{stats.done} of {plural(stats.total, 'card')} learned</p>
          <section class="card" aria-label="This round">
            <ul class="result-list">
              {state.roundResults.map((r, i) => (
                <li key={r.id + i}>
                  {r.correct ? <span class="ok-mark" aria-label="Right">✓</span> : <span class="bad-mark" aria-label="Missed">✕</span>}
                  <span>{cards.get(r.id)?.answer}</span>
                </li>
              ))}
            </ul>
          </section>
          {saveError && <Notice tone="danger" title="Progress not saved">{saveError}</Notice>}
          <button ref={continueRef} class="btn primary" onClick={startNextRound}>Continue to round {state.round + 1}</button>
        </div>
      </>
    )
  }

  const shownItem = view === 'feedback' ? fb!.item : item!
  const card = cards.get(shownItem.id)!
  const shownState = (view === 'feedback' ? fb!.cardBefore : card).progress.state
  const label = `Round ${state.round} · ${Math.min(state.pos + (view === 'feedback' ? 0 : 1), state.roundIds.length)} of ${state.roundIds.length}`

  return (
    <>
      {header(label)}
      {optionsPanel}
      <div class="study-col">
        <div class="study-meta">
          <Badge tone={STATUS_TONE[shownState]}>{STATUS_LABEL[shownState]}</Badge>
          <span class="small muted">{card.topic}</span>
        </div>
        <p class="prompt" id="q"><Prompt text={card.prompt} /></p>

        {shownItem.format === 'mcq' ? (
          <>
            <p class="small muted">Choose an answer</p>
            <ul class="options" aria-labelledby="q">
              {shownItem.choices!.map((o, k) => {
                const done = view === 'feedback'
                const mark = done ? (o === card.answer ? 'correct' : o === fb!.given ? 'wrong' : '') : ''
                return (
                  <li key={o}>
                    <button class={`option ${mark}`} onClick={() => pick(o)} disabled={done || busy}>
                      <span class="key" aria-hidden="true">{k + 1}</span>
                      <span class="grow">{o}</span>
                      {mark && <span class="option-state">{mark === 'correct' ? (o === fb!.given ? 'Correct' : 'Answer') : 'Your pick'}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        ) : view === 'question' ? (
          <form class="stack-sm" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) submitTyped() }}>
            <label class="small muted" for="typed">Type the answer</label>
            <div class="typed">
              <input id="typed" ref={inputRef} value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} autocomplete="off" autocapitalize="off" spellcheck={false} disabled={busy} />
              <button class="btn primary" type="submit" disabled={!typed.trim() || busy}>Answer</button>
            </div>
            <div><button type="button" class="link" onClick={() => answer(false, '')} disabled={busy}>Don’t know?</button></div>
          </form>
        ) : null}

        {view === 'feedback' && fb && <LearnFeedback fb={fb} card={card} kit={kit} onOverride={override} busy={busy} />}
        {mixup && <Notice tone="accent" title="Mix-up card added">{mixup}</Notice>}
        {saveError && (
          <Notice tone="danger" title="Answer not saved" actions={<a class="btn" href="#/settings">Free up space</a>}>
            {saveError} Try answering again.
          </Notice>
        )}
        {view === 'feedback' && (
          <div class="continue-row">
            <span class="small muted">Press Enter to continue</span>
            <button ref={continueRef} class="btn primary" onClick={proceed}>Continue</button>
          </div>
        )}
      </div>
    </>
  )
}

function LearnFeedback({ fb, card, kit, onOverride, busy }: { fb: Feedback; card: StudyCard; kit: Kit; onOverride: () => void; busy: boolean }) {
  if (fb.correct) {
    return (
      <div class="feedback good" role="status">
        <span class="feedback-title">{fb.overridden ? 'Counted as right' : fb.close ? 'Correct, with a small typo' : 'Correct'}</span>
        {(fb.close || fb.overridden) && fb.item.format === 'written' && <p class="small">The answer is <strong>{card.answer}</strong>{fb.given && <> · you typed “{fb.given}”</>}</p>}
      </div>
    )
  }
  const why = fb.item.format === 'mcq' && fb.given ? card.distractorExplanations?.[card.distractors?.indexOf(fb.given) ?? -1] : undefined
  const whySource = fb.item.format === 'mcq' && fb.given ? card.distractorSources?.find((s) => s.term === fb.given)?.sentenceId : undefined
  return (
    <div class="feedback bad" role="status">
      <span class="feedback-title">{fb.given ? 'Not quite' : 'Here’s the answer'}</span>
      {fb.item.format === 'written' && (
        <div class="compare-answers">
          <div><span class="small muted">You said</span><span class={fb.given ? 'struck' : 'muted'}>{fb.given || 'Nothing'}</span></div>
          <div><span class="small muted">Correct answer</span><strong class="ok-mark">{card.answer}</strong></div>
        </div>
      )}
      <SourceQuote card={card} sentenceId={card.sourceSentenceId} term={card.answer} kit={kit} label="From your notes" />
      {card.explanation && <p>{card.explanation}</p>}
      {why && <p><strong>Why not “{fb.given}”?</strong> {why}</p>}
      {!why && whySource && <SourceQuote card={card} sentenceId={whySource} term={fb.given} kit={kit} label={`Why not “${fb.given}”? Your notes use it here, in a different context:`} />}
      {fb.item.format === 'written' && fb.given && (
        <div><button class="btn" onClick={onOverride} disabled={busy}>I was right</button></div>
      )}
    </div>
  )
}

function LearnOptionsPanel({ options, onApply, onClose, hasStarred }: { options: LearnOptions; onApply: (o: LearnOptions) => void; onClose: () => void; hasStarred: boolean }) {
  const [o, setO] = useState(options)
  const changed = JSON.stringify(o) !== JSON.stringify(options)
  return (
    <div class="study-col" style={{ paddingBottom: 0 }}>
      <section class="card stack" aria-label="Learn options">
        <div class="section-head"><h2>Options</h2><button class="btn" onClick={onClose}>Close</button></div>
        <div class="stack-sm">
          <span class="small muted strong">Answer with</span>
          <div class="segmented" role="group" aria-label="Answer with">
            {(Object.keys(ANSWER_LABEL) as LearnAnswer[]).map((a) => (
              <button key={a} class={o.answer === a ? 'on' : ''} aria-pressed={o.answer === a} onClick={() => setO({ ...o, answer: a })}>{ANSWER_LABEL[a]}</button>
            ))}
          </div>
        </div>
        <div class="stack-sm">
          <span class="small muted strong">Cards per round</span>
          <div class="segmented" role="group" aria-label="Cards per round">
            {ROUND_SIZES.map((n) => <button key={n} class={o.roundSize === n ? 'on' : ''} aria-pressed={o.roundSize === n} onClick={() => setO({ ...o, roundSize: n })}>{n}</button>)}
          </div>
        </div>
        <label class="check">
          <input type="checkbox" checked={o.starredOnly} onChange={(e) => setO({ ...o, starredOnly: (e.target as HTMLInputElement).checked })} />
          Starred cards only{!hasStarred && <span class="small muted"> (none starred yet)</span>}
        </label>
        <p class="small muted">Changing options starts Learn over. Cards you’ve mastered stay mastered.</p>
        <div class="actions">
          <button class="btn primary" onClick={() => onApply(o)}>{changed ? 'Apply and restart' : 'Restart Learn'}</button>
        </div>
      </section>
    </div>
  )
}
