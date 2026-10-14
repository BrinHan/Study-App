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

