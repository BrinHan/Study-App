// Multiple-choice options for any card: its own distractors, topped up with other answers from the kit.
import type { StudyCard } from '../lib/types'
import { normalize } from './answer'
import { shuffled } from './random'

const studyable = (c: StudyCard) => c.type !== 'compare'

export function distinctAnswers(cards: StudyCard[]): number {
  return new Set(cards.filter(studyable).map((c) => normalize(c.answer))).size
}

/** Four distinct choices including the answer, or null when the kit doesn't have enough different answers. */
export function choicesFor(card: StudyCard, pool: StudyCard[], seed: string): string[] | null {
  const seen = new Set([normalize(card.answer)])
  const picks: string[] = []
  const add = (term: string) => {
    const key = normalize(term)
    if (picks.length >= 3 || !key || seen.has(key)) return
    seen.add(key)
    picks.push(term)
  }
  for (const d of card.distractors ?? []) add(d)
  if (picks.length < 3) {
    // Prefer answers of similar length, so the right one doesn't stand out. Shuffle first so ties vary per card.
    const others = shuffled(pool.filter((c) => studyable(c) && c.id !== card.id).map((c) => c.answer), card.id + seed)
      .sort((a, b) => Math.abs(a.length - card.answer.length) - Math.abs(b.length - card.answer.length))
    for (const term of others) add(term)
  }
  return picks.length < 3 ? null : shuffled([card.answer, ...picks], card.id + seed)
}
