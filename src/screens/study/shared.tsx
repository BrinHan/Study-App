// Pieces shared by the Learn, Flashcards and Test screens.
import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { getConfusion, putCard, putConfusion, uid } from '../../lib/db'
import { notifyDataChanged } from '../../lib/hooks'
import { cite, resolveSource } from '../../lib/study'
import type { Kit, Sentence, StudyCard } from '../../lib/types'
import { newProgress } from '../../study/mastery'
import { Highlight, Icon, Notice } from '../../ui'

/** A source sentence with the term highlighted and a "file, page N" / "paragraph N" citation. */
export function SourceQuote({ card, sentenceId, term, kit, label }: { card: StudyCard; sentenceId?: string; term: string; kit?: Kit; label: string }) {
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

/** Picking the same wrong term twice for an answer adds a card comparing the two. Returns a message when it does. */
export async function recordConfusion(card: StudyCard, picked: string): Promise<string | null> {
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
      progress: newProgress(),
    }
    await putCard(compare)
    c.compareCardId = compare.id
    message = `You’ve picked “${picked}” for “${card.answer}” twice, so a card comparing the two was added. Find it under Mix-ups to fix on Home.`
  }
  await putConfusion(c)
  return message
}

export const MODES = [
  { id: 'learn', label: 'Learn', icon: 'learn', blurb: 'Adaptive rounds' },
  { id: 'flashcards', label: 'Flashcards', icon: 'cards', blurb: 'Flip and sort' },
  { id: 'test', label: 'Test', icon: 'test', blurb: 'Graded practice' },
] as const
export type ModeId = (typeof MODES)[number]['id']

/** Focus-mode header: mode switcher, a centred progress label, options and close. */
export function StudyHeader({ kit, mode, label, progress, onOptions, optionsOpen }: { kit: Kit; mode: ModeId; label?: ComponentChildren; progress?: number; onOptions?: () => void; optionsOpen?: boolean }) {
  const current = MODES.find((m) => m.id === mode)!
  return (
    <>
      <header class="study-header">
        <details class="mode-switch">
          <summary><Icon name={current.icon} size={18} /> {current.label} <span aria-hidden="true">▾</span><span class="visually-hidden">, switch study mode</span></summary>
          <ul>
            {MODES.map((m) => (
              <li key={m.id}><a href={`#/${m.id}/${kit.id}`} aria-current={m.id === mode ? 'page' : undefined}><Icon name={m.icon} size={18} /> {m.label}</a></li>
            ))}
          </ul>
        </details>
        <div class="study-label">
          <strong class="study-kit">{kit.title}</strong>
          {label && <span class="muted small" aria-live="polite">{label}</span>}
        </div>
        <div class="study-actions">
          {onOptions && <button class="btn" onClick={onOptions} aria-expanded={!!optionsOpen}>Options</button>}
          <a class="btn icon-btn" href={`#/kit/${kit.id}`} aria-label={`Close ${current.label} and go back to the kit`}><Icon name="close" /></a>
        </div>
      </header>
      {progress !== undefined && (
        <div class="study-progress" role="progressbar" aria-label={`${current.label} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div style={{ width: `${Math.min(100, progress * 100)}%` }} />
        </div>
      )}
    </>
  )
}

