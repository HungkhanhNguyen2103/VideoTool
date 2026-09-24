# Implementation plan approved — use subagent-driven execution

Read the full plan directly (`docs/superpowers/plans/2026-09-23-script-presets-visual-prompts-implementation.md`), plus the real `finalizeScript()` body in `src/server/modules/script/service.ts` and the current `StudioPage.tsx` button/`busy` pattern, to check specific claims rather than take the plan at its word.

## Verified against real code, not just the spec text

- Task 5's `SCENES_NOT_READY` readiness check (`scenes.length > 0`, every chapter has a positive integer `scenesCount`, and the sum of chapter `scenesCount` equals `scenes.length`) is exactly the invariant `finalizeScript()` actually establishes — I read the function: `scenesCount: paragraphs.length` per chapter (minimum 1, since empty paragraphs becomes `['']`), and `scenes` is built by flattening those same paragraph arrays. So the guard can't reject a genuinely finalized project or accept an unfinalized one. Good — derived from the real invariant, not assumed.
- Task 3's race-safety plan (array filter on `id` **and** `visualPrompt: ''` per target, plus a top-level query predicate requiring at least one still-empty target so an all-filled race matches zero documents and skips the version bump) is mechanically sound for a single atomic `updateOne` with multiple `arrayFilters` — this is the correct way to do it in Mongo, not hand-waved.
- Every commit in the 8-step sequence matches the spec's suggested list exactly, and the global constraints section repeats every guardrail from prior phases (module boundary, `eslint.config.js` untouched, no `git add -A`/`push`, empty-prompt-only writes, cooperative cancellation, mocked AI in tests).

## One thing to tighten before implementation, not a blocker

Task 6's Studio button is supposed to disable "while a project job is active" (per spec §8), including the gap between enqueue and the first SSE event where `jobId` is set but `useJobProgress` hasn't reported a status yet. That's genuinely the trickiest bit of logic in the whole plan, and it's the *only* piece of behavior in Task 6 with zero test coverage — the task's only test is the thin API-call shape in `asset-api.test.ts`. Every sibling button in `StudioPage.tsx` today only checks `busy !== null`, which is cleared right after the enqueue call returns, so there's no existing precedent to copy.

Please add a small pure function for the active-job predicate (e.g. `isProjectJobActive(jobId, progress)` next to the other asset helpers in `api.ts`, same pattern as `chapter-actions.ts` for `ReviewScriptPage`) with its own unit test covering: no job, job enqueued with no progress yet (must read as active), and progress `done`/`failed`/`cancelled` (must read as not active). Wire `StudioPage` to call it rather than inlining the condition. This is a small addition to Task 6, not a redesign — feel free to fold it into the same commit.

## Execution approach: subagent-driven

Go with subagent-driven execution, not native. Reasons specific to this plan:

- The tasks are strictly load-bearing on each other in one direction (presets → prompt/schema move → project mutation → job orchestration → route/worker → Studio → regression → acceptance), and several of the middle tasks (3 and 4 especially) carry real correctness risk — a subtle mistake in the race-safe write or the exact-index validation would silently corrupt data or drop chapters, not just fail a lint check.
- Per-task independent review matches how every prior phase in this project has actually gone: I've caught real issues between stages every time (the stepper self-contradiction, the mislabeled button, the history-eviction bug, the batch-cancel bug) — always after a bounded unit of work, never after a full multi-commit phase landed at once. Reviewing after each task keeps that same discipline instead of asking me to reconstruct eight commits' worth of reasoning after the fact.
- None of the eight tasks are trivial enough that independent review would be pure overhead — each one has its own named test family and its own commit.

Proceed task by task with subagent-driven execution. Report back after each task's commit as usual — I'll verify by reading the actual diff before the next task starts, same as every prior phase.
