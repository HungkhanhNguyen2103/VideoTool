# Task 54 - Never discard a good chapter because of over-long memory fields

## Evidence (your own real DeepSeek run, Task 53 report)
Chapter 1 (target 180 words): the model wrote valid paragraphs, but `chapterSummary` was >250 chars on the first reply AND on the repair.
Result: chapter failed, 0 words, `needs-fix`. Chapters 2/3 needed repairs for the same reason (chapterSummary, persistentFactsNext.1).
LLMs cannot count characters reliably; a repair retry does not fix that. `chapterSummary`, `avoidRepeating`, `persistentFactsNext`
and `styleNote` are continuity memory for the NEXT prompt, not narration. Losing the narration because of them is the wrong trade.

## Do
1. In `parse-output.ts`, before strict validation of a chapter expansion (and `RegeneratedParagraphsSchema`), **normalize** the memory fields only:
   - `styleNote` -> trim, cut to 500 chars; `chapterSummary` -> cut to 250; each `avoidRepeating` item -> 80; each `persistentFactsNext` item -> 120.
   - Cut at the last word boundary before the limit and append nothing (or a single "…" only if it still fits within the limit).
   - Arrays longer than 5 -> keep the first 5.
   - Only when the value is a string/array of the expected type; wrong types still fail validation as today.
2. Keep the schemas themselves unchanged (`.strict()`, same max limits): normalization happens before `safeParse`, so stored data still obeys the limits.
3. `paragraphs` are never altered. Unknown keys still fail (and still go through the one repair retry).
4. Log a one-line notice when a field was truncated (`Truncated chapterSummary from 312 to 250 chars`), so we can see how often it happens.
5. Keep the repair retry for structural problems (extra keys, wrong types, missing fields).
6. Outline: for the `documentary` preset, the model added `motif`, `outline`, `motifNote` and needed a repair. Drop those three known stray keys
   from the ROOT when the preset is not `hubris-trap` (`motif` only for documentary/explainer), then validate. Do not loosen `.strict()` for anything else.
7. Tests: over-long fields get truncated and the chapter is saved with its paragraphs; array of 7 facts -> 5; wrong type still fails;
   paragraphs untouched; stray root keys dropped for documentary but `motif` required/kept for hubris-trap.

## Do NOT
Change prompts, loosen schemas, alter word-count retry logic, or touch other modules.

## Verify and report
Commit hash, focused tests, typecheck/lint EXIT codes. Then a real DeepSeek run on the same Vasa project and report per chapter:
first-try validity, number of repairs, truncation notices, and final word counts vs targetWords. Chapter 1 must end with paragraphs (not `needs-fix`).
