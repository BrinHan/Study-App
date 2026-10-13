import { createEmptyCard } from 'ts-fsrs'
import type { AiQuestion } from '../../../shared/quiz'
import type { Sentence, StudyCard } from '../../lib/types'

/** AI questions -> cards. Ids are assigned later by the merge. */
export function questionsToCards(kitId: string, questions: AiQuestion[], byShortId: Map<string, Sentence>, now: Date): StudyCard[] {
  const out: StudyCard[] = []
  for (const q of questions) {
    const src = byShortId.get(q.sourceIds[0])
    if (!src) continue
    const base = { id: '', kitId, prompt: q.question, answer: q.answer, explanation: q.explanation, hint: q.hint, sourceSentenceId: src.id, topic: src.topic, fsrs: createEmptyCard(now) }
    // 'cloze' is the type the UI shows as "flashcard"
    out.push(q.kind === 'mcq'
      ? { ...base, type: 'mcq', distractors: q.distractors, distractorExplanations: q.distractorExplanations }
      : { ...base, type: 'cloze' })
  }
  return out
}
