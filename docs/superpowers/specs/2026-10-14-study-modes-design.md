# Study modes: Learn, Flashcards, Test

Date: 2026-10-14 · Status: approved in brainstorming (wireframes: `.superpowers/brainstorm/*/content/layouts-v2.html`)

## Goal

Make Margin feel familiar to Quizlet users: each kit offers **Learn**, **Flashcards** and **Test** study modes, and the kit page looks like a study set page. The layout should feel familiar but not be a copy. The colour scheme, dark theme and source-linked explanations stay as they are.

## Decisions (from the user)

| Topic | Decision |
|---|---|
| FSRS daily review | **Removed.** Learn replaces it. No due queue, no Forgot/Hard/Good/Easy. |
| Home screen | "Today" becomes **Home**: Jump back in, recent kits, mix-ups to fix. |
| Learn format | Multiple choice first, then typed. Options: mixed / multiple choice only / typed only. Lenient typo matching plus an "I was right" override. |
| Test question types | True/False, Multiple choice, Matching, Written. |
| Flashcards | Know / Still learning sort, shuffle, choose start side, keyboard shortcuts, star cards. |
| Exam date | Countdown plus a nudge to take a Test when the exam is 3 days away or less. |
| Match game | Not in this round. |
| Navigation | Keep the collapsible sidebar (Home, Library, Progress, Settings), add a top bar with kit search and Import. Study modes open full-screen with a focused header. |
| Existing data | Migrated, not reset. |

## Data model

### `StudyCard`
- Remove `fsrs` and `introducedOn`.
- Add `progress: CardProgress` and `starred?: boolean`.

```ts
type MasteryState = 'new' | 'learning' | 'mastered'
interface CardProgress { state: MasteryState; streak: number; seen: number; lastSeen?: number }
```

**Mastery rule (all modes share it):**
- A correct answer adds 1 to `streak` and sets the state to `learning`. When the streak reaches 2 or more, the state becomes `mastered`.
- A wrong answer resets the streak to 0 and sets the state to `learning`.
- In Flashcards, "Know" counts as correct and "Still learning" counts as wrong.

The per-session rule that Learn needs a typed answer is enforced inside the Learn session, not by mastery.

UI labels: `new` is "Not studied", `learning` is "Still learning", `mastered` is "Mastered".

### `Review` (answer log)
- `rating` becomes optional, so old records stay valid.
- Add `mode?: 'learn' | 'flashcards' | 'test'` and `format?: 'mcq' | 'written' | 'tf' | 'match' | 'flip'`.
- Progress charts, weak topics and mix-ups keep reading this log.

### `Settings`
- Replace `newPerDay` with `learnAnswer: 'mixed' | 'mcq' | 'written'` (default `mixed`) and `roundSize` (default 7).
- `newPerDay` is ignored if present.

### `sessions` store (new, DB version 2)
`StudySession { id: \`${kitId}|${mode}\`, kitId, mode: 'learn' | 'flashcards', state, updatedAt }`
- There is one open session per kit and mode. It is deleted when the session finishes.
- Tests are short and are not saved.

### Migration (IndexedDB v1 → v2, and v1 backups)
`progressFromFsrs(fsrs)` (pure function, no `ts-fsrs` import):

| FSRS card | New progress |
|---|---|
| State New (0) | `new` |
| State Review (2) with `scheduled_days >= 21` | `mastered`, streak 2 |
| Anything else | `learning`, streak 0 |

In every case `seen = reps`, `lastSeen = last_review`.

Backups export `version: 2`. `parseBackup` accepts version 1 and converts its cards the same way. The `ts-fsrs` dependency is removed.

## Study engine: `src/study/` (pure, unit-tested)

- `random.ts`: seeded `shuffled()` (moved out of `Review.tsx`) and `pickN()`.
- `answer.ts`: `normalize()` (case, punctuation, leading articles, whitespace) and `checkTyped(input, answer)`, which returns `'exact' | 'close' | 'wrong'`.
  - `close` means a Levenshtein distance ≤ 1 for answers of 5 characters or fewer, and ≤ 2 for longer ones.
  - Both `exact` and `close` count as correct, and the UI shows "small typo" for `close`.
- `mastery.ts`: `newProgress()`, `progressFromFsrs()`, `applyAnswer()`, `statusLabel()`, `kitMastery(cards)` returning `{ new, learning, mastered }`.
- `options.ts`: `choicesFor(card, pool, seed)`.
  - Uses the card's own distractors when it has 3.
  - Otherwise fills up with other cards' answers from the same kit: distinct, not equal to the answer, preferring similar length.
  - Returns null when there aren't enough unique answers for 4 choices; that card is then written-only.
- `learn.ts`: the Learn state machine.
  - Eligible cards: `cloze` and `mcq` (not `compare`).
  - Each card has a stage (`mcq` → `written` → `done`), depending on the answer option:
    - `mixed`: multiple choice first (skipped when no choices exist), then written.
    - `mcq`: done after one correct multiple-choice answer.
    - `written`: done after one correct typed answer.
  - A round is up to `roundSize` cards that aren't done yet, with cards already started first. A wrong answer keeps the card at its stage for a later round.
  - After each round the session shows a checkpoint, and it is finished when every card is done.
  - API: `startLearn(cards, opts, seed)`, `currentItem(s)`, `answerItem(s, correct)`, `nextRound(s)`, `learnStats(s)`.
- `flashcards.ts`:
  - State: order, index, `sort` on/off, `know` and `learning` piles, undo history, front side (`prompt` or `answer`).
  - API: `startFlashcards()`, `move()`, `sortCard()`, `undo()`, `restartWith('learning' | 'all')`, `shuffleDeck()`.
- `test.ts`:
  - `buildTest(cards, opts, seed)` builds questions grouped by type, in the order True/False → Multiple choice → Matching → Written.
  - The question count is split evenly across the chosen types. A Matching group has 4–5 pairs with distinct answers, and each pair counts as one question.
  - A True/False statement fills the blank with the answer (true) or a distractor (false), with about half of each.
  - Cards with too few choices for multiple choice fall back to Written.
  - `gradeTest(questions, answers)` returns a result per question and the score.
  - Overrides ("I was right") re-score that question.
  - `compare` cards are excluded.

## Screens and routes

| Route | Screen |
|---|---|
| `#/home` (default; `#/today` redirects) | Home |
| `#/library?q=…&import=…` | Library (search filter from the top bar) |
| `#/kit/<id>?tab=cards\|summary\|source` | Kit page, Cards tab by default |
| `#/learn/<kitId>?cards=a,b` | Learn (optional subset, for "learn the ones you missed") |
| `#/flashcards/<kitId>?cards=a` | Flashcards (subset used by mix-ups "Compare them") |
| `#/test/<kitId>` | Test |
| `#/progress`, `#/settings` | Unchanged routes |

`#/review` and `#/done` are removed; old links show the existing "page doesn't exist" notice, which points to Home.

