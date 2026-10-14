# Study Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Margin's FSRS daily review with Quizlet-style Learn, Flashcards and Test modes, a Home screen and a set-style kit page, keeping the current colours.

**Architecture:**
- Pure study logic lives in `src/study/*.ts` and is unit-tested with Vitest. Preact screens only render the engine's state and persist through `src/lib/db.ts`.
- Card mastery replaces `fsrs` on `StudyCard`. In-progress Learn and Flashcards sessions are stored in a new IndexedDB `sessions` store (DB v2), which powers Home's "Jump back in".

**Tech Stack:** Preact 11, TypeScript, Vite, idb, Vitest. `ts-fsrs` is removed.

**Spec:** `docs/superpowers/specs/2026-10-14-study-modes-design.md`

## Global Constraints

- Colours: only the existing CSS tokens in `src/styles.css` `:root`. No new colours, no gradients except the score ring's conic fill using `--success` / `--bg-canvas`.
- Dark theme only, Plus Jakarta Sans, buttons at least 44px tall. Every control is keyboard reachable and has an accessible name.
- Mastery labels are exactly "Not studied", "Still learning" and "Mastered".
- Mastery rule: a correct answer adds 1 to the streak, and a streak of 2 or more means mastered. A wrong answer resets the streak to 0 and sets the state to learning.
- Typo tolerance: Levenshtein ≤ 1 for answers of 5 characters or fewer, ≤ 2 for longer ones (after normalising).
- Learn defaults are `learnAnswer: 'mixed'` and `roundSize: 7`. Round-size choices are 5, 7 and 10.
- The exam nudge shows when an exam is 3 days away or less (0 to 3).
- `compare` cards appear only in Flashcards.
- Follow existing idioms: curly quotes and ’ in UI copy, the `plural()` helper, the `Notice` component for errors, and `notifyDataChanged()` after writes.

## Review Focus

1. **Kit with fewer than 4 distinct answers:** multiple-choice choices can't be built. Learn should fall back to written questions, and Test should disable itself (Learn tile stays on). Tests: `options.test.ts` "returns null with < 4 distinct answers", and `learn.test.ts` "mixed skips mcq stage when no choices".
2. **Duplicate answers in a kit** (two cards both answer "ATP"): Matching must never contain the same term twice, and choices must be deduplicated. Test: `test.test.ts` "match groups have distinct answers".
3. **Saved session referencing deleted or changed cards:** a resumed session should drop the missing ids, or restart when none remain, and must not crash. Tests: `learn.test.ts` "pruneLearn removes missing ids" and `flashcards.test.ts` "pruneFlash".
4. **Typed answers with case, articles or punctuation** ("The Mitochondria." vs "mitochondria") count as exact. Test: `answer.test.ts`.
5. **Upgrading from a v1 DB or backup:** FSRS cards must map to the right mastery without needing `ts-fsrs`. Tests: `mastery.test.ts` `progressFromFsrs` cases, plus a backup v1 parse test in `src/lib/backup.test.ts`.

---

### Task 1: Answer checking and seeded random helpers

**Files:**
- Create: `src/study/random.ts`, `src/study/answer.ts`, `src/study/answer.test.ts`

**Interfaces:**
- Produces:
  - `shuffled<T>(items: T[], seed: string): T[]` (move the FNV-based version from `src/screens/Review.tsx` unchanged).
  - `normalize(s: string): string`.
  - `levenshtein(a: string, b: string): number`.
  - `checkTyped(input: string, answer: string): 'exact' | 'close' | 'wrong'`.

- [ ] **Step 1: Failing tests** (`answer.test.ts`):
  - `normalize('  The Mitochondria. ')` returns `'mitochondria'`.
  - `normalize('an ATP-synthase')` returns `'atp synthase'`.
  - `checkTyped('mitochondria', 'Mitochondria')` returns `'exact'`.
  - `checkTyped('plasma membrain', 'plasma membrane')` returns `'close'` (distance 2, length 15).
  - `checkTyped('ATQ', 'ATP')` returns `'close'` (distance 1, length 3).
  - `checkTyped('ARQ', 'ATP')` returns `'wrong'` (distance 2, length 3).
  - `checkTyped('', 'ATP')` returns `'wrong'`.
  - `shuffled([1,2,3,4], 's')` is deterministic: it equals itself on a second call and has the same members.
- [ ] **Step 2:** Run `npx vitest run src/study/answer.test.ts`. Expect FAIL (module not found).
- [ ] **Step 3: Implement.**
  - `normalize`: lowercase, replace `[^\p{L}\p{N}]+` with a space, trim, strip a leading `the |a |an `, collapse spaces.
  - Empty input counts as `'wrong'`.
  - The tolerance uses the normalised answer's length.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `Add typed-answer checking and seeded shuffle`.

### Task 2: Mastery model, types and FSRS migration

**Files:**
- Create: `src/study/mastery.ts`, `src/study/mastery.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces in `types.ts`:
  - `MasteryState = 'new' | 'learning' | 'mastered'`.
  - `CardProgress { state; streak: number; seen: number; lastSeen?: number }`.
  - `StudyCard` loses `fsrs` and `introducedOn`, and gains `progress: CardProgress` and `starred?: boolean`.
  - `Review.rating` becomes optional (`1|2|3|4`). `Review` adds `mode?: StudyMode` and `format?: AnswerFormat`.
  - `StudyMode = 'learn' | 'flashcards' | 'test'`.
  - `AnswerFormat = 'mcq' | 'written' | 'tf' | 'match' | 'flip'`.
  - `Settings { learnAnswer: LearnAnswer; roundSize: number }`, with `LearnAnswer = 'mixed' | 'mcq' | 'written'`. `DEFAULT_SETTINGS = { learnAnswer: 'mixed', roundSize: 7 }`.
  - `StudySession { id: string; kitId: string; mode: 'learn' | 'flashcards'; state: unknown; updatedAt: number }`.
- Produces in `mastery.ts`:
  - `newProgress(): CardProgress`.
  - `applyAnswer(p: CardProgress, correct: boolean, now = Date.now()): CardProgress`.
  - `progressFromFsrs(f: { state: number; scheduled_days: number; reps: number; last_review?: string | Date }): CardProgress`.
  - `STATUS_LABEL: Record<MasteryState, string>`.
  - `kitMastery(cards: StudyCard[]): { new: number; learning: number; mastered: number; total: number }`.

- [ ] **Step 1: Failing tests.**
  - `applyAnswer(newProgress(), true)` gives `{state:'learning', streak:1, seen:1}`. Applying `true` again gives `mastered`, streak 2.
  - A wrong answer on a mastered card gives `learning`, streak 0.
  - `progressFromFsrs({state:0, scheduled_days:0, reps:0})` gives `new`.
  - `{state:2, scheduled_days:21, reps:5}` gives `mastered`, streak 2, seen 5.
  - `{state:2, scheduled_days:20, reps:5}` gives `learning`.
  - `{state:3, …}` gives `learning`.
  - `kitMastery` counts correctly.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement `mastery.ts` and update `types.ts`. `tsc` will now fail across the app; Task 3 fixes the data layer and Task 9 fixes the screens. Keep `npx vitest run src/study` green.
- [ ] **Step 4:** Run `npx vitest run src/study`. Expect PASS.
- [ ] **Step 5:** Commit: `Add card mastery model replacing FSRS state`.

### Task 3: Data layer (DB v2, sessions, backup v2, generators)

**Files:**
- Modify: `src/lib/db.ts`, `src/gen/generator.ts:9,297`, `src/gen/ai/toCards.ts:1,11`, `package.json` (remove `ts-fsrs`)
- Create: `src/lib/backup.test.ts`

**Interfaces:**
- Consumes: Task 2 types and `progressFromFsrs`, `newProgress`.
- Produces in `db.ts`:
  - `getSession(id)`, `putSession(s: StudySession)`, `deleteSession(id)`, `listSessions(): Promise<StudySession[]>`.
  - `sessionId(kitId: string, mode: 'learn' | 'flashcards'): string`, which returns `` `${kitId}|${mode}` ``.
  - `migrateCard(raw: any): StudyCard`, exported for tests. It adds `progress` from `raw.fsrs` when `progress` is missing, then deletes `fsrs` and `introducedOn`.
  - `Backup.version: 1 | 2`, with export writing 2. `parseBackup` maps cards through `migrateCard` and ignores old `settings.newPerDay` by merging over `DEFAULT_SETTINGS`.
  - `deleteKit` also deletes that kit's two sessions. `deleteEverything` and `restoreBackup` also clear `sessions`.
- DB upgrade: `openDB('margin', 2, { upgrade(db, oldVersion, _new, tx) })`.
  - When `oldVersion < 1`, create the v1 stores.
  - When `oldVersion < 2`, create `sessions` (keyPath `id`, index `kitId`) and iterate the `cards` store cursor through `tx`, writing `migrateCard(value)`.
- Generators use `progress: newProgress()` in place of `fsrs: createEmptyCard(now)`.

- [ ] **Step 1: Failing tests** (`backup.test.ts`):
  - `parseBackup` of a v1 JSON whose card has `fsrs:{state:2, scheduled_days:30, reps:4, due:'…'}` produces a card with `progress.state === 'mastered'` and no `fsrs` key.
  - A v2 backup card with `progress` passes through unchanged.
  - Settings `{newPerDay:20}` become `{learnAnswer:'mixed', roundSize:7}`.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. Run `npm uninstall ts-fsrs`.
- [ ] **Step 4:** Run `npx vitest run`. Expect all PASS, including the existing generator tests.
- [ ] **Step 5:** Commit: `Move storage to mastery progress and add sessions store`.

### Task 4: Multiple-choice options

**Files:**
- Create: `src/study/options.ts`, `src/study/options.test.ts`

**Interfaces:**
- Produces: `choicesFor(card: StudyCard, pool: StudyCard[], seed: string): string[] | null`.
  - Returns 4 shuffled, distinct strings (compared case-insensitively) that include `card.answer`, or null.
  - Prefers `card.distractors`. Fills up from `pool` answers (excluding compare cards and the answer itself), sorted by `|len - answer.len|`.
- Also produces: `distinctAnswers(cards: StudyCard[]): number` (case-insensitive distinct count over cloze and mcq cards).

- [ ] **Step 1: Failing tests:**
  - An mcq card with 3 distractors returns those plus the answer.
  - A cloze card in a pool of 5 distinct answers returns 4 choices including the answer, with no duplicates.
  - Returns null when the pool has fewer than 4 distinct answers.
  - Duplicate answers ("ATP" and "atp") are never both present.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5:** Commit: `Add multiple-choice option builder`.

