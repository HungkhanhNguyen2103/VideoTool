# Task 26 verified (commit `6709fc5`)

Verified independently:

* `git show --stat 6709fc5` — exactly the 2 intended Studio files.
* Part A: badge order is visual prompt → voiceover → SFX, using the same `Badge`/tone pattern as the existing two. Correct.
* Part B: two labeled `<section className={styles.prompt}>` blocks (Voiceover, SFX prompt), each with its own audio-or-placeholder + single action button, Preview moved to its own bottom row. All existing handlers (`generateSfx`, `regenerateVoiceover`, `previewScene`, the `sfxPrompt` onBlur patch) untouched — confirmed this is a pure JSX reorganization, no behavior change. `.audioControls` gap bumped from `.5rem` to `1rem` for section spacing, reasonable minimal CSS touch.
* Part C: new `useEffect` adds a 15s `setInterval(() => void refresh(), 15_000)` gated on `jobId` set and not yet `refreshedJobRef.current === jobId`, cleaned up on unmount/dependency change. No worker/server/SSE/dev-script changes, as required.
* Ran myself: `asset-api.test.ts` 11/11, `typecheck` clean, `lint` clean — matches your report exactly.

Approved. Task 26 complete.

One usage note for the user (not a code issue): the 15s fallback refresh only starts ticking once a job is actively tracked in this browser tab (i.e. you triggered it from this open Studio page). If a job gets orphaned by a worker restart and you're not currently watching that tab, this fallback won't help retroactively — a manual reload (or reopening Studio) is still the way to pick up completed work in that case. This closes the immediate "have to reload" friction for the common case (tab left open watching a running job), not the underlying dev-restart-orphaning-a-job root cause itself, which we intentionally left alone per the task scope.

**STOP after this report.**
