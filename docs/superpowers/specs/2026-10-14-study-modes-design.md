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

### App shell
- The sidebar shows Home, Library, Progress and Settings. The due count is removed.
- A new **top bar** above main content holds a search box and an "Import notes" button.
  - Typing in the search box and pressing Enter goes to `#/library?q=…`.
  - The Import button goes to `#/library?import=pdf`.
- Study routes render **focus layout**, with no sidebar or top bar. A `StudyHeader` has:
  - a mode switcher (left), a dropdown of the three modes linking to the same kit;
  - a centred progress label;
  - Options (when the mode has any) and a ✕ button that returns to the kit (right).
  - A thin progress bar sits under the header.
- Study content is a centred column, at most 640px wide.

### Home
- When there are no kits, it shows the existing first-launch card, reworded for the study modes.
- **Jump back in:** the most recently updated saved session, showing the kit, mode, a progress line, the mastery bar and a Continue button. With no session it shows the most recently studied kit and "Study again" (Learn). With nothing studied it shows the newest kit and "Start learning".
- Exam countdown badges appear on the hero and on recent kits. When an exam is 3 days away or less, the card also says "Take a practice test".
- **Recent kits:** up to 6 kits, ordered by last activity (latest answer, else creation). Each shows a mastery bar.
- **Mix-ups to fix:** the existing list. "Compare them" opens Flashcards with the compare card.
- Kits that are still building show the existing notice.

### Kit page
- The header has the title, source line, card count, exam countdown, and an overflow menu with Rename and Delete. The existing rename form and delete confirmation are kept.
- **Mode tiles** for Learn, Flashcards and Test, each with a one-line description.
  - Test is disabled when the kit has fewer than 4 study cards.
  - Learn is disabled when it has none.
  - Each disabled tile shows the reason.
- A nudge (warning notice) appears when the exam is 3 days away or less.
- A **progress card** shows the mastery bar and counts.
- The exam date and kit notes fields keep their current position.
- Tabs are **Cards** (default), Summary and Source pages.
  - The Cards filter is All / Not studied / Still learning / Mastered / ★ Starred.
  - Each row has the prompt, answer, a status badge, its type and a star toggle (an `aria-pressed` button).
  - "Missed twice" and "due in" are removed.

### Learn
- **Question:** the topic and a status badge, then the prompt with its blank.
  - Multiple choice: 4 options, keys 1–4.
  - Written: a text input with Enter to submit, plus a "Don't know?" link, which counts as wrong.
- **Feedback:**
  - Correct: a short success line ("small typo" when close).
  - Wrong: the existing source quote with the answer highlighted, the AI explanation if present, and "Why not X?" for a wrong multiple-choice pick.
  - Written wrong: shows your answer next to the correct one, plus "I was right", which re-records the answer as correct.
  - Continue with Enter, Space or the button.
  - Wrong multiple-choice picks feed `recordConfusion`, as today.
- **Round checkpoint:** round N done, right/wrong count, mastery ring (mastered / eligible), per-card ✓/✕ list, and Continue to round N+1.
- **Finished:** "You've learned every card", with buttons for Take a test, Flashcards, and Back to kit. The session is deleted.
- **Options panel:** the answer format (mixed / multiple choice / typed), Starred only, and Restart Learn. Changing an option restarts the session after a confirmation.
- Every answer updates `progress`, writes a `Review`, saves the session, and calls `notifyDataChanged`.

### Flashcards
- **Flip card:** the front shows the prompt with its blank (or the answer, when starting with the answer side), and the back shows the answer. The star is in the corner.
  - Click, Space or Enter flips the card.
  - With sort off, ←/→ move between cards and Previous/Next buttons are shown.
- **Sort mode** (default on): ✕ Still learning (key 1, or ←) and ✓ Know (key 2, or →), with counters on both sides, and Undo (key Z).
  - Each sort updates `progress` and logs a `Review` with `format: 'flip'`.
- **Options:** Sort on/off, Shuffle, Start with (Sentence / Term), and Starred only.
- **End of deck:** shows the counts, then "Study the N still-learning cards" or "Restart all".
- Compare cards show "A vs B: what's the difference?" on the front, and both source quotes on the back.
- The session is saved on every change.

### Test
- **Setup** (a centred card): Questions (10 / 20 / All), Starred only, and the four question-type checkboxes (at least one must stay checked). Then Start test.
  - The wireframe's "Answer with: Term / Sentence" option is dropped, because it isn't meaningful for cloze cards.
- **Sheet:** one scrolling page grouped by type. The header shows "N / M answered". There is no feedback until Submit.
  - Submitting with unanswered questions asks for confirmation.
  - True/False: the statement with a term highlighted, then True and False buttons.
  - Multiple choice: an option list.
  - Matching: each prompt row has a `<select>` of terms (accessible, and works on mobile). A tap-to-pair UI was considered but not chosen for this round.
  - Written: a text input.
- **Results:** a score ring and "N of M", the weakest topic, and two buttons: "Learn the N you missed" (`#/learn/<kit>?cards=…`) and New test.
  - Below them is a list of each answer with your answer, the correct answer, "I was right" on written answers (re-scores), and an expandable source quote.
  - Every answer updates `progress` and logs a `Review` (`mode: 'test'`).

### Progress
- Mastered now means mastered under the new rule.
- "Reviews" are renamed "answers".
- Per-kit bars use Not studied / Still learning / Mastered.
- The weak-topic "Practice" button opens Learn for that kit.

### Settings
- Remove "Daily new cards".
- Add a "Learn" section with the default answer format and round size (5 / 7 / 10).

### Library
- Filters are All / Exam soon (Due today is removed).
- Each kit card shows the card count, its mastery % and the exam badge.
- `q` filters by title.
- The import success notice says "Start learning", which opens Learn.

