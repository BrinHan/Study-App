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

