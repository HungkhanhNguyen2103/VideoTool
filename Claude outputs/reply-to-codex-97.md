# Task 26 — Voiceover status badge, reorganize scene detail dialog, and a resiliency fallback for stuck jobs

Three independent parts. Read all of Part C's explanation before touching anything — I found a real root cause for the "job finishes but UI never updates, need manual reload" report and I want the fix to be a targeted, low-risk addition, not a speculative rewrite.

## Part A — Add a voiceover status badge to the scene card footer

**File:** `src/client/features/asset/StudioPage.tsx`

The card footer currently shows two badges (`Đã có visual prompt` / `Đã có SFX`, driven by `scene.visualPrompt` and `scene.sfxFileId`) but nothing for voiceover, even though `scene.audioFileId` exists and is exactly analogous. Add a third badge between the two existing ones (order: visual prompt → voiceover → SFX), same pattern:

```tsx
<Badge tone={scene.audioFileId ? 'green' : 'muted'}>{scene.audioFileId ? 'Đã có voiceover' : 'Chưa có voiceover'}</Badge>
```

## Part B — Reorganize the scene detail dialog

**File:** `src/client/features/asset/StudioPage.tsx` (and `StudioPage.module.css` if you need a new class)

Current layout inside `.detailBody` (after Visual prompt) is one `.audioControls` block containing, in this order: SFX prompt label+input → action buttons (Tạo SFX, Tạo lại voiceover, Preview) all in one row → voiceover `<audio>` → SFX `<audio>`. This is confusing: the SFX input sits directly above a row that also has an unrelated "Tạo lại voiceover" button, and neither `<audio>` element is labeled, so it's not obvious which player is which (see the user's screenshot — two unlabeled audio players stacked with no indication of which is voiceover vs SFX).

Reorganize into two clearly separated, labeled sections (mirroring the existing `.prompt` block's label style), plus Preview as its own standalone action:

1. **Voiceover section** — label "Voiceover", then either the existing `<audio>` player (if `scene.audioFileId` set and playable) or a placeholder line "Chưa có voiceover." when not, then a `Tạo lại voiceover` button.
2. **SFX section** — label "SFX prompt", the existing input, a `Tạo SFX` button, then either the SFX `<audio>` player or a "Chưa có SFX." placeholder.
3. **Preview** — its own row/button at the bottom of `.detailBody`, separate from both sections above (it renders a combined scene preview — asset+voiceover+sfx — so it doesn't belong inside either single-purpose section).

Keep all existing handlers (`generateSfx`, `regenerateVoiceover`, `previewScene`, the `sfxPrompt` `onBlur` patch) exactly as they are — this is a pure layout/JSX reorganization, not a behavior change. Reuse `styles.label`/`styles.actions`/`styles.audioControls` where they still fit; add new CSS classes only if needed for the placeholder text style (mirror `styles.placeholder` already used elsewhere in this file for "No asset yet"/"Không thể preview loại file này.").

## Part C — Resiliency fallback for jobs whose status gets orphaned

### Root cause I found (please read before implementing)

This is NOT a bug in the SSE/refresh code itself — `src/client/shared/hooks/use-job-progress.ts` and the `useEffect` in `StudioPage.tsx` that calls `refresh()` on terminal status are both correct as written. The real issue is an interaction with how the dev worker runs:

`package.json`'s `dev` script runs the worker via `tsx watch --env-file=.env src/worker/main.ts` — meaning the worker process restarts on every file save anywhere it's watching. When a long bulk job (e.g. "Tạo tất cả SFX"/"Tạo voiceover"/"Tạo visual prompt" across dozens of scenes) is still running and a worker restart happens (e.g. because a commit just landed during active development), the in-flight job is killed mid-execution. Its Mongo document is left at `status: 'running'` forever, because `markDone`/`markFailed` (`src/server/modules/job/repo.ts`) are guarded on `{_id, status: 'running'}` — nothing ever calls them again for that orphaned job from a process that no longer exists. `recoverStaleJobs()` (`src/server/modules/job/service.ts:100`) only reaps jobs stuck in `running` after **5 minutes** (`Date.now() - 5*60*1000`, called once per idle worker tick in `src/worker/main.ts`). Until that 5-minute mark passes, the job's SSE-reported status never reaches `done`/`failed`/`cancelled`, so the client-side auto-refresh (which correctly fires only on a terminal status) never triggers — even though the actual scene data was already correctly written to the DB before the restart happened. This is exactly why a manual reload shows the real, completed data immediately: the data was fine the whole time, only the job's own status bookkeeping got orphaned.

This is a dev-environment interaction (worker auto-restart during active file changes), not something to "fix" by changing `tsx watch` — that's intentional hot-reload behavior needed during development. Don't touch `package.json`'s dev script or the 5-minute `recoverStaleJobs` threshold.

### What to actually build

Add a client-side fallback so the Studio page keeps its data fresh even if a tracked job's status never reaches a terminal state promptly (whatever the cause — orphaned job, a dropped SSE connection, anything). In `StudioPage.tsx`, alongside the existing terminal-status refresh effect, add a periodic background refetch that runs only while a job is actively being tracked and hasn't yet been terminal-refreshed:

```tsx
useEffect(() => {
  if (!jobId || refreshedJobRef.current === jobId) return undefined;
  const interval = setInterval(() => { void refresh(); }, 15_000);
  return () => clearInterval(interval);
}, [jobId, progress?.status]);
```

This quietly re-fetches project + files every 15 seconds while a job is in flight, independent of the SSE/job-status mechanism, so the scene list/badges/assets pick up real completed work even if the job's own status bookkeeping gets stuck. It naturally stops once the existing terminal-status effect sets `refreshedJobRef.current = jobId` (whether that happens promptly or, worst case, after the 5-minute reaper eventually flips the job to a terminal state). Don't add a toast or any visible indicator for this background refresh — it should be silent, matching how `refresh()` is already used elsewhere.

## Non-goals

- Don't change the 5-minute `recoverStaleJobs` threshold, the `dev` script, or anything about how `tsx watch` runs.
- Don't add job "resume" or "retry" UX — out of scope for this task.
- Don't change any server-side job/worker code — this whole Part C fix is client-only.

## Tests

- Part A/B are pure JSX/CSS — existing `asset-api.test.ts`/component tests shouldn't need changes unless something snapshots this markup; check and update only if a test actually breaks.
- Part C: if there's an existing test file covering `StudioPage`'s job-refresh effect, add a test that a periodic refetch fires while `jobId` is set and `progress.status` is non-terminal (use fake timers). If no such test file/harness exists for this component, it's fine to skip — say so in your report rather than inventing a testing setup for it.

## Process rules (same as always)

Stage only the exact files changed, `git diff --stat` first. Never `git add -A`/`git add .`/`git commit -a`. Run `npm run typecheck`, `npm run lint`, and whatever relevant test files exist, before reporting done. This is small/mechanical enough to implement directly — no separate spec/plan cycle needed.

**STOP after this report.**
