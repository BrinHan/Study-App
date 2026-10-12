# Margin

A free, offline study app (concept build). Import your own notes as a text-based PDF or pasted text. Margin turns them into flashcards and multiple-choice questions, schedules reviews with spaced repetition (FSRS), and explains every answer by showing the exact sentence from your notes, with its page or paragraph.

No accounts, no server, no API keys. Everything runs in the browser and is stored on the device (IndexedDB). After the first visit it works offline.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/ (static, deploy anywhere)
npm run preview    # serve dist/ with the service worker, to test offline
npm run sample-pdf # regenerate samples/cell-biology.pdf (add -- --pages 50 for the timing file)
```

Try it with `samples/cell-biology.pdf` (3 pages) or paste `samples/cell-biology.md`.

## How it works

The import runs in a Web Worker (`src/worker.ts`) so the page stays responsive. pdf.js is loaded only when you import a PDF, and does its parsing in its own worker. The finished kit is written in a single IndexedDB transaction, so a cancelled import never leaves half a kit behind.

**1. Text and locations.** pdf.js extracts text lines per page. Short lines that repeat at the top or bottom of many pages (running headers, "Page 3") are dropped, and lines are joined into paragraphs. Every sentence keeps its page (PDF) or paragraph number (pasted text) plus the heading it sits under, which becomes its topic. A PDF with almost no text per page is reported as scanned.

**2. Sentences.** Paragraphs are split into sentences (abbreviations such as "e.g." and decimals are protected). Fragments, references, URLs and sentences under 6 or over 55 words are skipped.

**3. TF-IDF terms.** `compromise` (part-of-speech tagging, runs in the worker) extracts noun phrases such as "plasma membrane" and "electron transport chain". Each term gets `(1 + log tf) × log(1 + N / df)`, where N is the number of sentences, tf the term's total count, and df the number of sentences containing it. Multi-word phrases get ×1.3. This favours terms that recur but aren't everywhere. The top ~25% (15–150 terms) become key terms.

**4. TextRank.** Sentences are TF-IDF vectors. Cosine similarity is computed through an inverted index rather than all pairs, so it stays cheap on long documents. PageRank (damping 0.85, 30 iterations) runs over the similarity graph. High-ranking sentences that contain key terms become card sentences, and the top 4–6 (with near-duplicates skipped) form the kit summary, in reading order with page references.

**5. Cards.**
- *Cloze:* blank out the sentence's highest-scoring key term. Answers are spread across terms, so one term doesn't take every card.
- *MCQ:* the blank is the answer. Three distractors are other key terms of the same kind (name / plural / phrase / noun) and similar length that don't appear in that sentence. Each distractor keeps a pointer to the sentence where your notes use it.
- With fewer than 10 usable sentences, the kit gets flashcards only and the kit page says why.

**6. Scheduling (FSRS).** `ts-fsrs` schedules every card. The rating buttons (Forgot / Hard / Good / Easy) show the next interval each would give. Today's queue holds due cards first, then exam extras, then new cards up to the daily limit (default 20, shared across kits). "Mastered" means the next review is 21+ days away.
- **Exam date:** for a kit with an exam in D days, cards seen fewer than 2 times are added each day: ceil(views still needed / D). That way every card is seen at least twice before the exam.

**7. Source-linked explanations.** A wrong answer opens three layers:
1. Hint: first letter, word count, and word type.
2. The source passage with the answer highlighted, cited as "file.pdf, page N" or "Pasted notes, paragraph N".
3. "Why not <your pick>?": the sentence where your notes use the term you picked.

If a card has no stored source (for example an edited backup), Margin finds the closest sentence by TF-IDF cosine similarity and labels it a closest match.

**8. Mix-ups and adaptive quizzes.** If you pick the same wrong term B for answer A twice, Margin creates a "compare" card with both source sentences and lists it under *Mix-ups to fix*. Practice quizzes sample 10 MCQ cards, weighted toward topics with low accuracy and cards you've missed.

**AI seam.** `src/gen/generator.ts` exports a `CardGenerator` interface. A local-AI generator (WebLLM or similar) can implement it and be swapped in at the one line in `src/worker.ts`. Storage, review and explanations don't change.

## Performance (measured)

Test file: `samples/cell-biology-50p.pdf`, 50 pages, 170 KB. It's the sample notes repeated with numbered sections: 1,113 sentences, which yield 394 cards (the 400-card cap).

| Run | Time to cards |
|---|---|
| In-app import, Chrome, DevTools CPU throttling 6× | **1.9 s** |
| In-app import, no throttling | 1.6 s |
| Same pipeline run on the main thread with 6× throttling (pdf.js read 0.4 s + generation 2.9 s) | **3.2 s to first card** |

DevTools CPU throttling barely affects Web Workers, which is why the first two numbers are close. The third row runs generation on the throttled main thread to get an honest 6× figure. The pdf.js parse (0.4 s there) wasn't throttled. At a full 6× it would be at most about 2.4 s, so the **worst-case estimate on a 6×-slower machine is about 5–6 s** for 50 pages. Cards are saved in one transaction, so the first card appears when the whole kit does.

Bundle: the app loads 108 KB of JS (36 KB gzipped). The worker (compromise + generator) is 298 KB, and pdf.js (488 KB + 1.3 MB worker) loads only when importing a PDF. Everything is precached for offline use (2.2 MB).

## States that aren't the happy path

| Where | State | What the user sees |
|---|---|---|
| Today | First launch | What Margin does, plus Choose a PDF / Paste text |
| Today | All caught up | When the next cards come back, plus Practice quiz / Import more notes |
| Today | Loading, kit still building | Skeleton; "Still building" with a link to progress |
| Any | Storage blocked (private window) | Explanation and browser-specific fix steps |
| Library | Empty, importing (cancelable), done | Step list with Cancel import; card count, time, Start review |
| Library | Scanned PDF, > 10 MB, damaged/locked PDF, too little text, storage full | What happened, then Paste text instead / Choose another PDF / Free up space in Settings |
| Kit | Still building / interrupted import | Live steps, or "didn't finish" with Delete it and import again |
| Kit | Not enough text for a quiz | Flashcards-only notice with the exact sentence count |
| Review | Nothing due, ended early, answer not saved | Next due time; "N cards stay due"; Try saving again |
| Progress | No reviews; under 20 reviews | Start review; recall rate hidden with the reason |
| Offline | Banner | Everything works; only Install app and Check for updates are disabled |

To see storage states without a private window or a full disk, add `?sim=blocked` or `?sim=full` to the URL (for example `http://localhost:5173/?sim=full#/library`).

## Known limitations

- **Text-based PDFs only.** No OCR, by design: it would mean a large download.
- **English only.** The POS tagging, stopwords and sentence splitting assume English.
- Card quality depends on the notes. Dense, complete sentences give good cards. Bullet fragments are skipped. Some distractors are weak (for example "carbon sugar" from "five-carbon sugar"), and the generator sometimes blanks a word that's part of a longer phrase.
- PDF layout: multi-column pages, tables and footnotes can be joined in the wrong order, because pdf.js returns text in drawing order.
- Exact duplicate sentences aren't merged (the 50-page timing file shows this).
- There's no card editing UI. To change a card, delete the kit and re-import, or edit a backup file.
- The "Session done" summary lives in memory; reloading clears it (answers are saved).
- Backups don't include the original PDFs. "Open original PDF" stops working after you remove them in Settings.
- The kit page's due count is that kit's share of today's queue. If the daily new-card limit is used up by another kit, it can show "No cards due" even though it has unseen cards.

## Project layout

```
src/
  main.tsx, app.tsx      shell: sidebar (232px ↔ 76px), routing, offline banner, storage check
  ui.tsx, styles.css     shared components and the flat dark theme (CSS variables)
  screens/               Today, Library, Kit, Review, Done, Progress, Settings
  lib/db.ts              IndexedDB stores (kits, sentences, cards, reviews, confusions, files, meta), backup
  lib/importer.ts        main-thread import: size/type checks, lazy pdf.js, worker, cancel, errors
  lib/study.ts           FSRS, queues, exam extras, forecast, stats, adaptive quiz, source lookup
  gen/generator.ts       TF-IDF, TextRank, cloze/MCQ, summary (the CardGenerator seam)
  gen/text.ts            tokenizer, sentence splitter, cosine similarity
  worker.ts              runs the generator, writes the kit in one transaction
samples/                 cell-biology.md / .pdf, plus the 50-page timing PDF
scripts/                 dependency-free sample PDF writer
```
