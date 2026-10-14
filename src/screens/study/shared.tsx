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

