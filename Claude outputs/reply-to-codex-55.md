# Task 13 — Wire `reportProgress` into voiceover and render-full-video jobs

Context: In this codebase, `JobContext` (`src/server/modules/job/service.ts`) exposes both `appendLog` and `reportProgress(pct, result?)`. Three job handlers already call `reportProgress` correctly: `generate-script` (`src/server/modules/script/service.ts`), `final-qa` (`src/server/modules/script/qa.ts`), `generate-visual-prompts` (`src/server/modules/script/visual-prompts.ts`). Two handlers do NOT: `generate-voiceover` and `render-full-video` — they only receive `appendLog`, so their job doc's `progress` field stays frozen at `0` for the entire job even while scenes are actively processing (visible as a "Job running" progress bar stuck at 0% while the log list below it scrolls through scenes 1..N). This task closes that gap for both handlers, following the exact same percentage convention already used in `visual-prompts.ts` line 121: `Math.round(((index + 1) / total) * 100)`.

## Scope — file by file

1. **`src/server/modules/video/tts-service.ts`**
   - Change `generateProjectVoiceovers(projectId: string, appendLog: (message: string) => Promise<void>): Promise<void>` to also accept `reportProgress: (pct: number) => Promise<void>` (add it as a third parameter, or bundle both into a small options object if that reads cleaner given the file's existing style — pick whichever matches the codebase's own conventions in sibling files like `visual-prompts.ts`).
   - Inside the existing `for (const [index, scene] of project.scenes.entries())` loop, after each scene finishes processing (success or caught failure — progress should still advance on a failed scene, matching how the loop already continues past failures), call `reportProgress(Math.round(((index + 1) / project.scenes.length) * 100))`.
   - Do not change the existing `appendLog` call sites, the failure-collection logic, or `generateSceneVoiceover`'s signature.

2. **`src/server/modules/video/service.ts`**
   - Change `renderFullProject(projectId: string, appendLog: ...)` to also accept and forward a `reportProgress: (pct: number) => Promise<void>` parameter through to `getVideoRenderer(project.renderEngine).renderFullVideo(project, appendLog, reportProgress)`.

3. **`src/server/modules/video/ffmpeg-renderer.ts`**
   - Add `reportProgress` as a parameter to the `VideoRenderer` interface's `renderFullVideo` method and to the class implementation.
   - Inside the existing `for (const [index, scene] of project.scenes.entries())` loop (around line 54), after each scene segment finishes rendering, call `reportProgress(Math.round(((index + 1) / project.scenes.length) * 100))`. Reserve the tail of the range sensibly: since concat/bgm muxing happens after the loop, scale the per-scene progress to something like 0–90% across the loop and call `reportProgress(100)` once the final output file is written, so the bar doesn't appear "done" before the concat/mux step actually finishes. Use your judgment on the exact split (e.g. 90/100) as long as it's monotonic and reaches 100 only at the very end.

4. **`src/server/modules/video/remotion-renderer.ts`**
   - Add `reportProgress` as a parameter to `renderFullVideo` (and thread it into the private `render` method alongside `appendLog`).
   - This renderer doesn't have a per-scene loop — it drives a Remotion bundling+rendering subprocess and receives progress via whatever event/message parsing already exists near the `appendLog` calls at lines ~63–104. Look at what data is already available at each of those existing `appendLog` call sites (staging complete, render started, in-progress events, render complete) and map them to reasonable coarse percentages (e.g. staging complete → 10%, render started → 15%, in-progress events → interpolate if a numeric progress fraction is already available from Remotion's own progress callback, otherwise leave interpolation out and just do staging/started/complete milestones, complete → 100%). Do not invent progress data that isn't actually available from Remotion's own render callback — if Remotion's renderer only gives you discrete lifecycle events (not a numeric fraction), just report the milestone percentages at those events; do not fake finer granularity.
   - If you find Remotion's actual render call already exposes a numeric progress callback (check the existing code near line ~75-85 handling in-progress events), prefer wiring that directly into `reportProgress` over inventing milestone percentages.

5. **`src/worker/registry.ts`**
   - In `handleGenerateVoiceover`, pass `context.reportProgress` through to `generateProjectVoiceovers` alongside the existing `context.appendLog`.
   - In `handleRenderFullVideo`, pass `context.reportProgress` through to `renderFullProject` alongside the existing `context.appendLog`.

## Non-goals — do not touch

- Do not change `generate-script`, `final-qa`, or `generate-visual-prompts` — they already report progress correctly.
- Do not change the `JobContext` type itself, the job doc schema, or `updateProgress` in `src/server/modules/job/repo.ts`.
- Do not add retry/backoff logic, health checks, or anything related to the TTS server startup race condition discussed separately — that is out of scope for this task.
- Do not change scene processing order, failure handling, or the `appendLog` message text in any of the four files above.

## Tests

Update or add unit tests mirroring the existing pattern in `visual-prompts.test.ts` (asserting `reportProgress` is called with increasing percentages as scenes/segments complete) for `tts-service.test.ts` (or wherever `generateProjectVoiceovers` is currently tested — check `video.test.ts`) and for the ffmpeg renderer's scene loop. For the Remotion renderer, only add a test if you can do so without mocking internals you'd have to invent — if Remotion's render call is hard to test meaningfully here, it's fine to skip a dedicated test for that one file as long as you don't break the existing Remotion renderer tests in `remotion.test.ts`.

## Process rules (same as every prior task in this repo)

Never run `git add -A` / `git add .` / `git commit -a` — stage only the exact files you changed, after checking `git diff --stat` first. Check for and remove a stale zero-byte `.git/index.lock` if no git process is actually running. Run `npm run typecheck`, `npm run lint`, and the relevant `vitest` files before reporting done. Keep the diff strictly to what's described above — no drive-by refactors.

Reply "approve" and I'll implement it. **STOP after this report.**
