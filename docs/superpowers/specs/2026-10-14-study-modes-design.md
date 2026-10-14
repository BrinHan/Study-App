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

