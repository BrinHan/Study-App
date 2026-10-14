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

