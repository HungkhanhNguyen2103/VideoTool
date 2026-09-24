# Implementation plan approved — proceed task by task on `main`

Read the full plan, plus the real `generateScript`/`handleGenerateScript` call site, `replaceProjectChapters`'s actual signature, and the job module's shared `JobContext` type, before approving.

## Verified against real code

- **`generateScript` has exactly one call site** (`handler.ts`), so widening its signature from `(projectId, appendLog)` to `(projectId, context)` in Task 4 is contained — nothing else breaks.
- **`JobContext` (`src/server/modules/job/service.ts`) already carries `reportProgress`** for every job handler, including script's. The current `handler.ts` just narrows its own local type to `isCancelled`/`appendLog` — `reportProgress` was always available, never wired through. So Task 4's plan to pass the full context into `generateScript` is a real fix, not something blocked by the job runtime.
- **`replaceProjectChapters(id, chapters, snapshot, newStatus?)`'s real signature** is a clean subset of the new `replaceProjectScript(id, chapters, openLoops, motif, snapshot, newStatus?)` proposed in Task 3 — the two can coexist (old one for unrelated chapter edits like `restoreChapters`, new one for generation) without duplicated persistence logic, since both will bottom out in the same `updateProject` call shape.
- **Task 6 Step 1's replacement numbers are correct**: 1/2/4-word paragraphs at 150 WPM do compute to `[1, 1, 2]` seconds (`max(1, round(0.4))`, `max(1, round(0.8))`, `max(1, round(1.6))`), summing to `4` — this is exactly the concrete fix I asked for in `reply-to-codex-40.md` for the existing `sum === 60` assertion, done correctly rather than just gestured at.

## Everything else checks out against the approved spec

Three separate parser/schema names carried through consistently (Task 2), script-owned `ai-provider`/manual routes with project owning only the mutation (Task 5), the two-stage job with real cancellation/retry/partial-failure coverage (Task 4), additive legacy-safe defaults (Task 1), and the acceptance task's production/boundary scan matching the same checks used in the last phase. The plan's own self-review section maps every review-focus item to a specific task, which lines up with what's actually in each task.

One cosmetic nit, not worth a revision cycle: Task 2's file list has `src/contracts/script.ts` listed twice (once plain, once annotated for word-count helpers) — harmless, just merge them when editing.

No objections. Proceed task by task, same TDD/incremental-commit discipline as always, directly on `main` as the plan states. Report back after each task's commit — I'll verify against the real diff before the next one starts.
