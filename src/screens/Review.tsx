import { useEffect, useMemo, useState } from 'preact/hooks'
import { createEmptyCard, type Grade } from 'ts-fsrs'
import { addReview, getConfusion, isQuotaError, putCard, putConfusion, uid } from '../lib/db'
import { go, notifyDataChanged } from '../lib/hooks'
import {
  applyRating, cite, kitQueue, todayQueue, isMastered, laterToday, loadStudyData, nextIntervals, pickQuiz, resolveSource,
  setLastSession, RATING_LABEL, type SessionResult, type StudyData,
} from '../lib/study'
import type { Kit, Sentence, StudyCard } from '../lib/types'
import { Highlight, Loading, Notice, PageHeader, Prompt, fmtTime, plural } from '../ui'

type Mode = 'review' | 'quiz' | 'retry'

function shuffled<T>(items: T[], seed: string): T[] {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    const j = Math.abs(h) % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** A source sentence with the term highlighted and a "file, page N" / "paragraph N" citation. */
function SourceQuote({ card, sentenceId, term, kit, label }: { card: StudyCard; sentenceId?: string; term: string; kit?: Kit; label: string }) {
  const [src, setSrc] = useState<{ sentence: Sentence; matched: boolean } | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    resolveSource(sentenceId ? card : { ...card, prompt: term, answer: term }, sentenceId).then((s) => alive && setSrc(s))
    return () => { alive = false }
  }, [card.id, sentenceId, term])
  if (src === undefined) return <p class="muted small">Finding the passage…</p>
  if (src === null) return <p class="muted small">No matching passage was found in your notes for “{term}”.</p>
  return (
    <figure class="quote">
      <figcaption class="small muted">{label}</figcaption>
      <blockquote><Highlight text={src.sentence.text} term={term} /></blockquote>
      <p class="small cite-line">{cite(kit, src.sentence)}{src.matched && ' · closest match (this card had no stored source)'}</p>
    </figure>
  )
}

async function recordConfusion(card: StudyCard, picked: string): Promise<string | null> {
  const id = `${card.kitId}|${card.answer}|${picked}`
  const c = (await getConfusion(id)) ?? { id, kitId: card.kitId, termA: card.answer, termB: picked, count: 0 }
  c.count++
  let message: string | null = null
  if (c.count >= 2 && !c.compareCardId) {
    const other = card.distractorSources?.find((s) => s.term === picked)?.sentenceId
    const compare: StudyCard = {
      id: `${card.kitId}:x${uid()}`,
      kitId: card.kitId,
      type: 'compare',
      prompt: `“${card.answer}” vs “${picked}”: what’s the difference?`,
      answer: `${card.answer} / ${picked}`,
      sourceSentenceId: card.sourceSentenceId,
      extraSourceIds: other ? [other] : [],
      hint: 'Say one thing that is true of each term.',
      topic: card.topic,
      fsrs: createEmptyCard(new Date()),
    }
    await putCard(compare)
    c.compareCardId = compare.id
    message = `You’ve picked “${picked}” for “${card.answer}” twice, so a card comparing the two was added. It’s listed under Mix-ups to fix on Today.`
  }
  await putConfusion(c)
  return message
}

export function Review({ query }: { query: URLSearchParams }) {
  const mode: Mode = (query.get('mode') as Mode) ?? (query.get('cards') ? 'retry' : 'review')
  const kitId = query.get('kit') ?? undefined
  const [setup, setSetup] = useState<{ d: StudyData; queue: StudyCard[] } | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)

  // Load the queue once; it stays fixed for the session even as cards are rescheduled.
  useEffect(() => {
    loadStudyData().then((d) => {
      let queue: StudyCard[]
      if (mode === 'quiz') queue = pickQuiz(d.cards.filter((c) => c.kitId === kitId), d.reviews)
      else if (mode === 'retry') {
        const ids = (query.get('cards') ?? '').split(',').filter(Boolean)
        queue = ids.map((id) => d.cards.find((c) => c.id === id)).filter((c): c is StudyCard => !!c)
      } else queue = kitId ? kitQueue(d, kitId) : todayQueue(d)
      setSetup({ d, queue })
    }, setLoadError)
  }, [query.toString()])

  const [i, setI] = useState(0)
  const [picked, setPicked] = useState<string[]>([])
  const [revealed, setRevealed] = useState(false)
  const [showPassage, setShowPassage] = useState(false)
  const [whyNot, setWhyNot] = useState<string[]>([])
  const [results, setResults] = useState<SessionResult[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [mixupNote, setMixupNote] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])

  const card = setup?.queue[i]
  const kit = setup?.d.kits.find((k) => k.id === card?.kitId)
  const options = useMemo(() => (card?.type === 'mcq' ? shuffled([card.answer, ...(card.distractors ?? [])], card.id) : []), [card?.id])
  const isMcq = card?.type === 'mcq'
  const gotIt = isMcq && picked.includes(card!.answer)
  const finished = isMcq ? gotIt || picked.length >= 2 || showPassage : revealed
  const firstRight = isMcq && picked[0] === card!.answer
  const suggested: Grade = isMcq ? (firstRight ? 3 : gotIt ? 2 : 1) : 3
  const intervals = useMemo(() => (card ? nextIntervals(card) : null), [card?.id])

  const finish = (all: SessionResult[], endedEarly: boolean, allNotes = notes) => {
    setLastSession({ mode, kitId, results: all, endedEarly, notReached: endedEarly ? setup!.queue.length - all.length : 0, notes: allNotes })
    notifyDataChanged()
    go('/done')
  }

  const pick = (opt: string) => {
    if (finished || picked.includes(opt)) return
    const next = [...picked, opt]
    setPicked(next)
    if (opt === card!.answer || next.length >= 2) setShowPassage(true)
  }

  const rate = async (g: Grade) => {
    if (!card || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const updated = applyRating(card, g)
      await putCard(updated)
      const correct = isMcq ? firstRight : g > 1
      await addReview({ id: uid(), cardId: card.id, kitId: card.kitId, topic: card.topic, rating: g, pickedAnswer: picked[0], correct, reviewedAt: Date.now() })
      let note: string | null = null
      if (isMcq) for (const p of picked) if (p !== card.answer) note = (await recordConfusion(card, p)) ?? note
      setMixupNote(note)
      const allNotes = note ? [...notes, note] : notes
      setNotes(allNotes)
      const all = [...results, { cardId: card.id, rating: g, correct, picked: picked[0], newlyMastered: !isMastered(card) && isMastered(updated) }]
      setResults(all)
      if (i + 1 >= setup!.queue.length) return finish(all, false, allNotes)
      setI(i + 1)
      setPicked([]); setRevealed(false); setShowPassage(false); setWhyNot([])
    } catch (e) {
      setSaveError(isQuotaError(e)
        ? 'Your device is out of storage, so this answer wasn’t saved.'
        : `This answer wasn’t saved (${String((e as Error)?.message ?? e)}).`)
    } finally {
      setSaving(false)
    }
  }

  // Keys: 1–4 pick an option, then 1–4 rate; Space shows a flashcard answer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= 4) {
        if (!finished && isMcq) pick(options[n - 1])
        else if (finished) rate(n as Grade)
      } else if (e.key === ' ' && !isMcq && !revealed) { e.preventDefault(); setRevealed(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (loadError) return <Notice tone="danger" title="The session couldn’t start" actions={<a class="btn primary" href="#/today">Back to Today</a>}>{String(loadError)}</Notice>
  if (!setup) return <Loading label="Preparing your cards…" />

  const { d, queue } = setup
  const sessionKit = d.kits.find((k) => k.id === kitId)
  if (queue.length === 0) {
    if (mode === 'quiz') {
      return sessionKit
        ? <Notice title={`No quiz questions in “${sessionKit.title}”`} actions={<><a class="btn primary" href={`#/review?kit=${sessionKit.id}`}>Review its flashcards instead</a><a class="btn" href={`#/kit/${sessionKit.id}`}>Open kit</a></>}>{sessionKit.quizReason ?? 'This kit has no multiple-choice cards.'}</Notice>
        : <Notice title="Choose a kit to quiz on" actions={<a class="btn primary" href="#/library">Go to Library</a>}>Practice quizzes use one kit at a time. Open a kit and choose Practice quiz.</Notice>
    }
    if (mode === 'retry') return <Notice title="These cards no longer exist" actions={<a class="btn primary" href="#/today">Back to Today</a>}>They may have been deleted along with their kit.</Notice>
    const later = laterToday(d)
    return (
      <div class="stack">
        <PageHeader title="Nothing due right now" />
        <section class="card stack">
          <p>{later.next ? `${plural(later.count, 'card')} come back later today; the first at ${fmtTime(later.next)}.` : d.cards.length ? 'You’ve done every card due today, plus today’s new cards.' : 'There are no cards yet. Import notes to make some.'}</p>
          <div class="actions">
            {sessionKit?.quizEnabled && <a class="btn primary" href={`#/review?mode=quiz&kit=${sessionKit.id}`}>Practice quiz instead</a>}
            {!d.cards.length ? <a class="btn primary" href="#/library?import=pdf">Import notes</a> : <a class="btn" href="#/today">Back to Today</a>}
          </div>
        </section>
      </div>
    )
  }

  const c = card!
  const title = mode === 'quiz' ? 'Practice quiz' : mode === 'retry' ? 'Retry' : 'Review'
  const [termA, termB] = c.type === 'compare' ? c.answer.split(' / ') : [c.answer, '']

  return (
    <div class="review stack">
      <div class="review-bar">
        <div>
          <strong>{title}</strong>
          <span class="muted"> · {sessionKit?.title ?? kit?.title ?? 'All kits'}</span>
        </div>
        <span class="muted small" aria-live="polite">Card {i + 1} of {queue.length}</span>
        <button class="btn" onClick={() => finish(results, true)}>End session</button>
      </div>
      <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={i} aria-label="Session progress">
        <div style={{ width: `${(i / queue.length) * 100}%` }} />
      </div>

      {mixupNote && <Notice tone="accent" title="Mix-up card added">{mixupNote}</Notice>}

      <section class="card stack question" aria-labelledby="q">
        <p class="small muted">{c.topic}{c.type === 'cloze' ? ' · flashcard' : c.type === 'compare' ? ' · compare' : ''}</p>
        <p id="q" class="prompt"><Prompt text={c.prompt} /></p>

        {isMcq && (
          <ul class="options">
            {options.map((o, k) => {
              const state = picked.includes(o) ? (o === c.answer ? 'correct' : 'wrong') : finished && o === c.answer ? 'correct' : ''
              return (
                <li key={o}>
                  <button class={`option ${state}`} onClick={() => pick(o)} disabled={finished || picked.includes(o)} aria-describedby={state ? `st-${k}` : undefined}>
                    <span class="key" aria-hidden="true">{k + 1}</span>
                    <span class="grow">{o}</span>
                    {state && <span id={`st-${k}`} class="option-state">{state === 'correct' ? (picked.includes(o) ? 'Correct' : 'Answer') : 'Not this one'}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {!isMcq && !revealed && <div class="actions"><button class="btn primary" onClick={() => setRevealed(true)}>Show answer <span class="kbd">Space</span></button></div>}
        {!isMcq && revealed && <p class="answer-box">{c.answer}</p>}
      </section>

      {(picked.length > 0 || revealed) && (
        <section class="card stack explain" aria-live="polite">
          {isMcq && !finished && (
            <>
              <p><strong>Hint:</strong> {c.hint}</p>
              <div class="actions">
                <span class="muted small">Try one more option, or</span>
                <button class="btn" onClick={() => setShowPassage(true)}>Show the passage</button>
              </div>
            </>
          )}
          {finished && (
            c.type === 'compare' ? (
              <>
                <SourceQuote card={c} sentenceId={c.sourceSentenceId} term={termA} kit={kit} label={`“${termA}” in your notes`} />
                <SourceQuote card={c} sentenceId={c.extraSourceIds?.[0]} term={termB} kit={kit} label={`“${termB}” in your notes`} />
              </>
            ) : (
              <SourceQuote card={c} sentenceId={c.sourceSentenceId} term={c.answer} kit={kit} label={firstRight ? 'From your notes' : 'The answer is in this passage'} />
            )
          )}
          {isMcq && finished && picked.filter((p) => p !== c.answer).map((p) => (
            whyNot.includes(p)
              ? <SourceQuote key={p} card={c} sentenceId={c.distractorSources?.find((s) => s.term === p)?.sentenceId} term={p} kit={kit} label={`Why not “${p}”? Your notes use it here, in a different context:`} />
              : <div key={p} class="actions"><button class="btn" onClick={() => setWhyNot([...whyNot, p])}>Why not “{p}”?</button></div>
          ))}
        </section>
      )}

      {saveError && <Notice tone="danger" title="Answer not saved" actions={<><button class="btn primary" onClick={() => rate(suggested)}>Try saving again</button><a class="btn" href="#/settings">Free up space</a></>}>{saveError}</Notice>}

      {finished && intervals && (
        <section class="stack" aria-label="How well did you know it?">
          <p class="small muted">How well did you know it? This sets when you’ll see the card again.</p>
          <div class="ratings">
            {([1, 2, 3, 4] as Grade[]).map((g) => (
              <button key={g} class={`btn rating${g === suggested ? ' primary' : ''}`} onClick={() => rate(g)} disabled={saving}>
                <span>{RATING_LABEL[g]}</span>
                <span class="small">{intervals[g]}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
