# Task 4 — one real gap against the committed spec, please fix before Task 5

Read the full diff (`service.ts`, `handler.ts`, `generation.test.ts`, plus the updated `script.test.ts`/`worker.test.ts`) directly, and re-read the committed spec's expansion-stage wording, before writing this.

## What's correct — verified against the real diff

- **Outline-then-expand sequencing matches the spec exactly**: cancellation checked before the outline call and after it, no chapter content persisted until the outline passes `parseScriptOutline` + `validateScriptOutlineChapterCount` (a new test proves this directly — an explicit chapter-count mismatch throws and `chapters` stays `[]`), then `saveGeneratedScript` persists outline-backed chapters with empty paragraphs before any expansion call happens.
- **Cancellation gating is real, not just claimed.** Traced every check: before the outline call, after the outline response, at the top of each chapter's loop iteration, after each chapter's AI response (including after a retry response), and again right before `patchProjectChapter`. The "discards a valid expansion when cancellation arrives before the write" test proves the last one concretely — a chapter whose AI response came back fine still ends up with `paragraphs: []` because cancellation was detected before the write landed.
- **Retry-once-then-accept is implemented exactly as specified**: under 80% of `targetWords` triggers one retry with actual/target counts in the prompt, and the second response is accepted unconditionally — confirmed by the first `generation.test.ts` case, which feeds a short chapter-1 response, a longer retry response, then a short chapter-2 response, and asserts chapter 2 keeps its still-short text with no second retry.
- **Per-chapter failure isolation matches the visual-prompt precedent**: a rejected provider call marks that chapter `needs-fix` and logs the error, but later chapters still run and persist normally — proven by a dedicated test, not just asserted in the report.
- **The handler/worker wiring is exactly what I verified was already possible back in `-41`**: `ScriptGenerationJobContext` now carries `reportProgress`, and `worker.test.ts` was updated to assert the full context object (not just `appendLog`) reaches `generateScript`. `ScriptJobContext`'s old narrow type is gone from `handler.ts` entirely, replaced by the service's own exported type — clean, no duplicate type definitions.
- `AGENTS.md`/`MODULE.md` updates are accurate and, notably, correctly walk back the earlier "Phase 6 acceptance is complete" line to "Phase 6 Task 4 is complete... route/UI/acceptance work remains" — good, since Phase 6 isn't done, only its Task 4 analog for this new phase is (this is actually Phase 7 Task 4; the stale "Phase 6" label in a couple of these new lines is a naming slip worth a quick fix, but harmless).

## One real gap: open loops are not filtered per chapter

The committed spec (section 3, expansion stage) says the expansion prompt receives "open loops planted in or due to that chapter" — i.e. only the subset relevant to the chapter being expanded, not the whole list.

The actual code passes the entire unfiltered array to every chapter:

```ts
const input = { project, chapter, openLoops: outline.openLoops, styleNote };
```

`buildChapterExpansionPrompt` then joins every loop's `question` into the prompt regardless of `plantedInChapter`/`resolvedInChapter`. For a 2-chapter test project with one loop spanning both chapters this is invisible, which is exactly why `generation.test.ts`'s assertion (`toContain('What caused it?')` on chapter 1's call) doesn't catch it — that loop happens to be relevant to chapter 1 either way. But on a real 18-chapter project with several loops planted at different points, every chapter's prompt will list every open loop in the whole script, including ones planted or resolved far away — the opposite of the targeted, chapter-relevant continuity signal the spec calls for, and noisier for the AI to act on.

Please fix `generateScript`'s per-chapter loop to filter `outline.openLoops` down to loops where `plantedInChapter === chapter.no || resolvedInChapter === chapter.no` before building that chapter's expansion prompt, and add a test with 3+ chapters and at least one loop that's irrelevant to a given chapter, asserting that chapter's prompt does *not* contain that loop's question. Small, contained fix — doesn't need a new task, just a follow-up commit before moving to Task 5.

No other corrections. Once this is fixed and re-verified, proceed to Task 5 (provider + manual routes).
