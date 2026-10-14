import { useEffect, useRef, useState } from 'preact/hooks'
import { deleteReview, deleteSession, getSession, isQuotaError, putCard, putSession, sessionId } from '../lib/db'
import { notifyDataChanged } from '../lib/hooks'
import { loadStudyData, recordAnswer } from '../lib/study'
import type { Kit, StudyCard } from '../lib/types'
import { atEnd, move, pruneFlash, restartWith, sortCard, startFlashcards, undo, type FlashOptions, type FlashState, type Pile } from '../study/flashcards'
import { newSeed } from '../study/random'
import { Loading, Notice, Prompt, plural } from '../ui'
import { NoCards, SourceQuote, StarButton, StudyHeader, useStudyKeys } from './study/shared'

const DEFAULTS: FlashOptions = { sort: true, front: 'prompt', starredOnly: false, shuffle: false }

interface Setup { kit: Kit; persist: boolean; only?: string[] }
/** What a sort changed, so Undo can put it back. */
interface Sorted { before: StudyCard; reviewId: string }

async function load(kitId: string, query: URLSearchParams) {
  const d = await loadStudyData()
  const kit = d.kits.find((k) => k.id === kitId && k.status === 'ready')
  if (!kit) return null
  const cards = d.cards.filter((c) => c.kitId === kit.id)
  const only = query.get('cards')?.split(',').filter(Boolean)
  const setup: Setup = { kit, persist: !only, only }
  let state: FlashState | null = null
  if (!only) {
    const saved = (await getSession(sessionId(kit.id, 'flashcards')))?.state as FlashState | undefined
    if (saved?.deck) {
      const ids = new Set(cards.filter((c) => !saved.options.starredOnly || c.starred).map((c) => c.id))
      state = pruneFlash(saved, ids)
    }
  }
  return { setup, cards, state: state ?? startFlashcards(kit.id, cards, DEFAULTS, newSeed(), only) }
}

export function Flashcards({ kitId, query }: { kitId: string; query: URLSearchParams }) {
  const [setup, setSetup] = useState<Setup | null | undefined>(undefined)
  const [cards, setCards] = useState<Map<string, StudyCard>>(new Map())
  const [state, setState] = useState<FlashState | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [history, setHistory] = useState<Sorted[]>([])
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showOptions, setShowOptions] = useState(false)
  const [loadError, setLoadError] = useState<unknown>(null)
  const cardRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    load(kitId, query).then((r) => {
      if (!r) return setSetup(null)
      setSetup(r.setup)
      setCards(new Map(r.cards.map((c) => [c.id, c])))
      setState(r.state)
    }, setLoadError)
  }, [])

  const save = async (s: FlashState | null) => {
    if (!setup?.persist || !s) return
    const id = sessionId(s.kitId, 'flashcards')
    if (atEnd(s)) await deleteSession(id)
    else await putSession({ id, kitId: s.kitId, mode: 'flashcards', state: s, updatedAt: Date.now() })
  }
  const fail = (e: unknown) => setSaveError(isQuotaError(e) ? 'Your device is out of storage, so this wasn’t saved.' : `This wasn’t saved (${String((e as Error)?.message ?? e)}).`)
  const apply = async (next: FlashState | null) => {
    try {
      await save(next)
      setState(next)
      setFlipped(false)
      setSaveError(null)
    } catch (e) {
      fail(e)
    }
  }

  const id = state && !atEnd(state) ? state.deck[state.index] : undefined
  const card = id ? cards.get(id) : undefined

  const sort = async (pile: Pile) => {
    if (!state || !card || busy) return
    setBusy(true)
    try {
      const { card: updated, reviewId } = await recordAnswer(card, pile === 'know', { mode: 'flashcards', format: 'flip' })
      setCards(new Map(cards).set(card.id, updated))
      setHistory([...history, { before: card, reviewId }])
      await apply(sortCard(state, pile))
      notifyDataChanged()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const takeBack = async () => {
    const last = history.at(-1)
    if (!state || !last || busy) return
    setBusy(true)
    try {
      await putCard(last.before)
      await deleteReview(last.reviewId)
      setCards(new Map(cards).set(last.before.id, last.before))
      setHistory(history.slice(0, -1))
      await apply(undo(state))
      notifyDataChanged()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const step = (delta: 1 | -1) => state && apply(move(state, delta))
  const restart = (which: 'learning' | 'all') => { if (state) { setHistory([]); apply(restartWith(state, which, newSeed())) } }
  const newDeck = (options: FlashOptions) => {
    if (!setup) return
    const next = startFlashcards(setup.kit.id, [...cards.values()], options, newSeed(), setup.only)
    if (!next) return setSaveError('No cards in this deck are starred yet. Star the hard ones with ☆ first.')
    setHistory([])
    apply(next)
    setShowOptions(false)
  }

  useStudyKeys((e) => {
    if (!state || !card) return
    const onControl = e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement
    if ((e.key === ' ' || e.key === 'Enter') && !onControl) { e.preventDefault(); setFlipped(!flipped) }
    else if (e.key === 'z' || e.key === 'Z') takeBack()
    else if (state.options.sort && (e.key === '1' || e.key === 'ArrowLeft')) sort('learning')
    else if (state.options.sort && (e.key === '2' || e.key === 'ArrowRight')) sort('know')
    else if (!state.options.sort && e.key === 'ArrowLeft') step(-1)
    else if (!state.options.sort && e.key === 'ArrowRight') step(1)
  })

  if (loadError) return <div class="study-col"><Notice tone="danger" title="Flashcards couldn’t start" actions={<a class="btn primary" href="#/home">Go to Home</a>}>{String(loadError)}</Notice></div>
  if (setup === undefined) return <div class="study-col"><Loading label="Shuffling your cards…" /></div>
  if (setup === null) return <div class="study-col"><Notice title="This kit doesn’t exist" actions={<a class="btn primary" href="#/library">Go to Library</a>}>It may have been deleted, or it’s still being built.</Notice></div>

  const { kit } = setup
  const options = state?.options ?? DEFAULTS
  const total = state?.deck.length ?? 0
  const header = (
    <StudyHeader kit={kit} mode="flashcards" label={state ? (atEnd(state) ? 'End of deck' : `${state.index + 1} / ${total}`) : undefined}
      progress={total ? (state!.index / total) : 0} onOptions={() => setShowOptions(!showOptions)} optionsOpen={showOptions} />
  )
  const panel = showOptions && (
    <FlashOptionsPanel options={options} onClose={() => setShowOptions(false)}
      onChange={(o) => state && apply({ ...state, options: o })}
      onNewDeck={newDeck} />
  )

  if (!state) {
    return <>{header}{panel}<NoCards kit={kit} mode="Flashcards" reason={options.starredOnly ? 'No cards in this kit are starred. Turn off “Starred only” in Options.' : 'This kit has no cards yet.'} /></>
  }

  if (!card) {
    return (
      <>
        {header}
        {panel}
        <div class="study-col checkpoint">
          <h1>{options.sort ? 'Deck sorted' : 'You’ve been through every card'}</h1>
          {options.sort ? (
            <>
              <div class="piles" style={{ gap: '16px' }}>
                <span class="pile learning">Still learning · {state.learning.length}</span>
                <span class="pile know">Know · {state.know.length}</span>
              </div>
              <p class="muted">{state.learning.length ? `Go through the ${plural(state.learning.length, 'card')} you’re still learning again, or start over.` : 'You knew every card in this deck.'}</p>
            </>
          ) : <p class="muted">{plural(total, 'card')} flipped.</p>}
          <div class="actions">
            {options.sort && state.learning.length > 0 && <button class="btn primary" onClick={() => restart('learning')}>Study the {plural(state.learning.length, 'still-learning card')}</button>}
            <button class={`btn${options.sort && state.learning.length ? '' : ' primary'}`} onClick={() => restart('all')}>Restart all</button>
            {history.length > 0 && <button class="btn" onClick={takeBack}>Undo last</button>}
            <a class="btn" href={`#/learn/${kit.id}`}>Learn</a>
            <a class="btn" href={`#/kit/${kit.id}`}>Back to kit</a>
          </div>
        </div>
      </>
    )
  }

  const showAnswer = flipped !== (options.front === 'answer')
  const [termA, termB] = card.type === 'compare' ? card.answer.split(' / ') : [card.answer, '']

  return (
    <>
      {header}
      {panel}
      <div class="study-col">
        {options.sort && (
          <div class="piles" aria-label="Piles">
            <span class="pile learning">Still learning · {state.learning.length}</span>
            <span class="pile know">Know · {state.know.length}</span>
          </div>
        )}
        <div class="flip-wrap">
          <button key={card.id + String(showAnswer)} ref={cardRef} class={`flip-card${showAnswer ? ' back' : ''}`} onClick={() => setFlipped(!flipped)} aria-label={`${showAnswer ? 'Answer' : 'Sentence'}. Activate to flip.`} aria-live="polite">
            <span class="flip-side">{showAnswer ? (card.type === 'compare' ? 'Compare' : 'Term') : 'Sentence'}</span>
            <span>{showAnswer ? card.answer : <Prompt text={card.prompt} />}</span>
            <span class="flip-hint">Click or press Space to flip</span>
          </button>
          <StarButton card={card} onChange={(c) => setCards(new Map(cards).set(c.id, c))} />
        </div>

        {showAnswer && card.type === 'compare' && (
          <section class="stack-sm">
            <SourceQuote card={card} sentenceId={card.sourceSentenceId} term={termA} kit={kit} label={`“${termA}” in your notes`} />
            <SourceQuote card={card} sentenceId={card.extraSourceIds?.[0]} term={termB} kit={kit} label={`“${termB}” in your notes`} />
          </section>
        )}

        {options.sort ? (
          <div class="sort-buttons">
            <button class="btn learning-btn" onClick={() => sort('learning')} disabled={busy}>✕ Still learning <span class="kbd-hint">1</span></button>
            <button class="btn" onClick={takeBack} disabled={busy || !history.length || state.index === 0} aria-label="Undo last sort">↶ <span class="kbd-hint">Z</span></button>
            <button class="btn know-btn" onClick={() => sort('know')} disabled={busy}>✓ Know <span class="kbd-hint">2</span></button>
          </div>
        ) : (
          <div class="sort-buttons">
            <button class="btn" onClick={() => step(-1)} disabled={state.index === 0}>← Previous</button>
            <span />
            <button class="btn primary" onClick={() => step(1)}>Next →</button>
          </div>
        )}
        {saveError && <Notice tone="danger" title="Not saved" actions={<a class="btn" href="#/settings">Free up space</a>}>{saveError}</Notice>}
        <p class="small muted deck-tools">
          <span>{options.sort ? '1 or ← still learning · 2 or → know · Z undo' : '← → move between cards'} · Space flips</span>
          <span>{options.shuffle ? 'Shuffled' : 'In order'}{options.starredOnly ? ' · starred only' : ''}</span>
        </p>
      </div>
    </>
  )
}

function FlashOptionsPanel({ options, onChange, onNewDeck, onClose }: { options: FlashOptions; onChange: (o: FlashOptions) => void; onNewDeck: (o: FlashOptions) => void; onClose: () => void }) {
  return (
    <div class="study-col" style={{ paddingBottom: 0 }}>
      <section class="card stack" aria-label="Flashcard options">
        <div class="section-head"><h2>Options</h2><button class="btn" onClick={onClose}>Close</button></div>
        <label class="check">
          <input type="checkbox" checked={options.sort} onChange={(e) => onChange({ ...options, sort: (e.target as HTMLInputElement).checked })} />
          Sort into Know / Still learning
        </label>
        <div class="stack-sm">
          <span class="small muted strong">Start with</span>
          <div class="segmented" role="group" aria-label="Start with">
            <button class={options.front === 'prompt' ? 'on' : ''} aria-pressed={options.front === 'prompt'} onClick={() => onChange({ ...options, front: 'prompt' })}>Sentence</button>
            <button class={options.front === 'answer' ? 'on' : ''} aria-pressed={options.front === 'answer'} onClick={() => onChange({ ...options, front: 'answer' })}>Term</button>
          </div>
        </div>
        <label class="check">
          <input type="checkbox" checked={options.shuffle} onChange={(e) => onNewDeck({ ...options, shuffle: (e.target as HTMLInputElement).checked })} />
          Shuffle (starts the deck over)
        </label>
        <label class="check">
          <input type="checkbox" checked={options.starredOnly} onChange={(e) => onNewDeck({ ...options, starredOnly: (e.target as HTMLInputElement).checked })} />
          Starred cards only (starts the deck over)
        </label>
      </section>
    </div>
  )
}
