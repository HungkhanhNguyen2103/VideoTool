# Bug: AI batch jobs report "Job done" even when every item failed

## Symptom (screenshot from the real app, Studio page)

`generate-visual-prompts` job finishes at 100% and the badge reads **"Job done"**, but every log line says:

```
Chapter 1: visual prompt generation failed: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"..."}
Chapter 2: visual prompt generation failed: 401 {...}
Chapter 3: visual prompt generation failed: 401 {...}
...
```

All 30 scenes still show "Chưa có visual prompt." / "No asset yet". A user who doesn't scroll the raw log box has no way to know the job actually accomplished nothing.

**Note on root cause of the 401 itself**: that part is a deployment/config issue, not a code bug — `ANTHROPIC_API_KEY` is missing or invalid in this environment's `.env`, so `createClaudeClient()` (`src/server/shared/ai/claude.ts:18-20`) falls back to the literal string `'missing-anthropic-key'` and every Claude call 401s. We're setting that env var separately; that is NOT what this task is about. This task is about the fact that the job-runner reports "done" for a batch that 100% failed, regardless of *why* the items failed (auth error today, but the same silent-success bug would happen for a rate limit, a network blip, or a malformed-output retry exhaustion).

## Root cause (verified against the real diff, not the report)

Two AI batch-generation jobs catch per-item errors and keep going, which is correct behavior (one bad chapter shouldn't abort the whole batch) — but nothing downstream ever surfaces that failures happened:

1. **`src/server/modules/script/visual-prompts.ts`** (`generateVisualPrompts`, loop ~82-134): each chapter's AI call is wrapped in try/catch; on failure it does `result.failedChapters.push(chapter.no)` + `appendLog(...)` and continues. The function **always resolves normally** — it never throws, no matter how many chapters failed. `result.failedChapters` exists but nothing reads it after the function returns.

2. **`src/server/modules/video/tts-service.ts`** (`generateProjectVoiceovers`, ~38-53): identical shape, but worse — it returns `void`. It builds a local `failed: number[]` and logs it, but never returns it at all, so the caller (`handleGenerateVoiceover` in `src/worker/registry.ts`) has literally nothing to inspect even if it wanted to.

3. **`src/server/modules/job/service.ts`, `claimAndRun`** (~117-129):
   ```ts
   try {
     const result = await handler(job, context);
     if (await context.isCancelled()) await markCancelled(job._id);
     else await markDone(job._id, result);
   } catch (error) {
     ...
     await markFailed(job._id, message, { willRetry, nextRunAt: ... });
   }
   ```
   This only asks "did the handler throw?" — it never looks at `result` itself. Since neither handler throws on partial/total per-item failure, `markDone` always wins.

4. **`src/server/modules/job/repo.ts`**: `markDone` (~38-42) unconditionally sets `status: 'done', progress: 100, error: null` — there's no path for "done, but here's what went wrong."

5. **`src/contracts/job.ts`**: `JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled']` and `JobSummarySchema` has no field for partial failure — `error` is only ever populated by `markFailed`. There's no `hasErrors`/`failedCount` anywhere in the typed contract.

6. **`src/client/features/asset/StudioPage.tsx:186`**: `<strong>Job {progress.status}</strong>` — renders the raw status only. It never inspects a result or scans logs for failures. This is exactly why the UI shows a clean "Job done" while the log box underneath tells a completely different story.

**Confirmed**: this silent-success pattern is specific to these two AI-per-item-loop jobs (visual prompts, voiceovers) — `renderFullProject` and the ffmpeg/Remotion renderers correctly `throw` on failure and go through `markFailed` as expected, so there's no existing "partial failure" convention anywhere else in the codebase to just copy — this needs a small new piece of plumbing.

## What to fix

Please implement, in this order, with a test at each step:

1. **Extend the job contract** (`src/contracts/job.ts`) with a way to represent "completed, but some items failed" without touching the meaning of the existing `'done'`/`'failed'` statuses (a job that failed *some* items still genuinely ran to completion — that's different from a job that crashed). Add a nullable field to `JobSummarySchema`/whatever backs `JobDoc`, e.g. `failedCount: number | null` (or `resultSummary: string | null` — your call, but it must be structured enough for the UI to branch on programmatically, not just another free-text log line). Keep it backward-compatible: existing fully-successful jobs should get `failedCount: 0` or `null`, whichever you choose as the "no issues" sentinel — document which.

2. **Fix `generateProjectVoiceovers`** (`src/server/modules/video/tts-service.ts`) to return a result object mirroring `generateVisualPrompts`'s shape (e.g. `{ updatedScenes, failedScenes }` instead of `void`), and update `handleGenerateVoiceover` in `src/worker/registry.ts` to actually pass that result through instead of discarding it.

3. **Update `claimAndRun`** (`src/server/modules/job/service.ts`) to inspect the handler's resolved `result` for a failure count (both `generateVisualPrompts`'s `failedChapters` and the now-fixed `generateProjectVoiceovers`'s `failedScenes` should map into the new job-level field) and pass that into `markDone` (extend `markDone`'s signature in `src/server/modules/job/repo.ts` to accept/store it, rather than hardcoding `error: null`). A job with zero failures behaves exactly as it does today.

4. **Update `StudioPage.tsx`**'s job progress block to render a visibly different state when `failedCount > 0` — e.g. "Job done — 12/30 chapters failed" in a warning tone (reuse the existing amber/warning styling already used elsewhere on this page for the missing-scenes message), instead of a plain "Job done". Keep the raw log list as-is underneath for detail.

5. **Tests**: a job-service test proving a handler that resolves with `failedChapters: [1,2,3]` (no throw) results in a job whose stored `failedCount` reflects that, not just a plain `done` with no signal; a `generateProjectVoiceovers` test proving it now returns failed scene numbers instead of swallowing them into `void`; a `StudioPage` (or its pure helper, if you extract one) test proving the warning-state branch renders when `failedCount > 0` and the normal "Job done" text renders when it's `0`/`null`.

Please don't touch anything about how the API key/provider is selected (`src/server/shared/ai/*`) — that part is correct and is a separate, already-understood config issue on our end, not something to "fix" in code.

Update `AGENTS.md`/`MODULE.md` for the job module (and script/asset modules if their contracts changed) in the same commit as the code, per usual. Report back what you changed with real diffs, as always — I'll verify against the actual commit before accepting, same as every task this project.
