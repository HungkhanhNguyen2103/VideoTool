# Task 18 — Align Studio scene grid cards, cap/scroll narration text, add SFX status + bulk SFX generation

## Context (from user feedback on Task 17's grid, with a screenshot)

The new responsive scene grid (Task 17, `9b664e9`) has two visual problems, plus two feature requests, all in the Studio page:

1. Cards in the same row don't line up — the "Chưa có visual prompt" badge + "Chi tiết" button footer row sits at a different vertical position per card, because `.sceneList` uses `align-items: start` (so each grid cell only grows to its own card's natural height) and narration length varies scene to scene, so card heights vary a lot. The user wants the footer row aligned across a row of cards.
2. Narration text with no length cap makes tall cards taller still. The user wants it capped with a scrollbar instead of growing the card indefinitely.
3. The compact card currently shows a visual-prompt status badge (`Đã có visual prompt` / `Chưa có visual prompt`) but nothing about SFX status — the user wants an equivalent SFX indicator per scene.
4. SFX generation today is per-scene only (`Tạo SFX` button inside the Task 17 detail dialog, calling `generateSceneSfx`). The user wants a bulk "generate SFX for every scene" action too, alongside the existing bulk "Tạo voiceover" button in the toolbar — keeping the per-scene one in the detail dialog as-is.

## Part A — Card alignment + narration scroll (CSS + minor JSX)

**Files:** `src/client/features/asset/StudioPage.module.css`, `src/client/features/asset/StudioPage.tsx`

1. In `.sceneList`, remove `align-items: start` so grid rows stretch to equal height (CSS grid default `align-items: stretch`). This alone doesn't align footers within a stretched card — also change `.card` to `display: flex; flex-direction: column;` (in addition to its existing background/border/padding) so its content lays out vertically and can use `margin-top: auto` to pin the footer.
2. Add `margin-top: auto` to `.cardFooter` so it's pushed to the bottom of the now-equal-height card, regardless of how much content sits above it.
3. Cap the narration text height and make it scrollable: wrap just the narration text (`{scene.narration}` inside `.sceneText`'s `<strong>`) in its own element with a new class, e.g. `styles.narration`, and give that class `max-height: 6.5rem; overflow-y: auto; padding-right: .25rem;` (keep the existing `<strong>` wrapping the text, just also apply this class to it or to a wrapping span — whichever is cleanest given the current JSX). Pick a max-height that shows roughly 4-5 lines before scrolling; adjust if it looks cramped once you see it rendered.
4. Double-check the `.cardPreview`/image-or-video block still renders correctly with `.card` now being `display: flex` instead of implicit block layout — flex children default to `align-items: stretch` too, which should be fine for a block-level preview div, but confirm nothing collapses unexpectedly (e.g. images needing explicit width).

## Part B — SFX status indicator on the compact card

**File:** `src/client/features/asset/StudioPage.tsx`

Add a second badge next to the existing visual-prompt status badge in `.cardFooter`, following the exact same pattern (`Badge tone={... ? 'green' : 'muted'}`): `scene.sfxFileId ? 'Đã có SFX' : 'Chưa có SFX'`. Note this checks `sfxFileId` (the generated audio file), not `sfxPrompt` (the text prompt) — a scene can have a prompt typed in without SFX generated yet, and the badge should reflect whether the actual SFX audio exists, mirroring how the visual-prompt badge checks `scene.visualPrompt` (the actual generated content, not some separate "requested" flag). Keep both badges plus the `Chi tiết` button all inside `.cardFooter`; wrap if needed (`.cardFooter` already has `flex-wrap: wrap`).

## Part C — Bulk "Tạo tất cả SFX" action

This mirrors the existing bulk voiceover job (`generateProjectVoiceovers` in `src/server/modules/video/tts-service.ts`, job type `generate-voiceover`, route `POST /api/project/:id/scenes/generate-voiceover`, worker handler `handleGenerateVoiceover` inline in `src/worker/registry.ts`) as closely as possible. Read `generateProjectVoiceovers` and its full wiring (route in `src/server/modules/video/routes.ts` line ~29, worker registration in `src/worker/registry.ts`) before writing this, and copy the shape exactly — same loop-with-try/catch-and-progress-report structure, same job-enqueue route shape, same client `{jobId}`-returning API function shape.

1. **`src/server/modules/video/service.ts`** — add a new exported function, next to the existing `generateSceneSfx`:
   ```ts
   export async function generateProjectSfx(projectId: string, appendLog: (message: string) => Promise<void>, reportProgress: (percent: number) => Promise<void>): Promise<void> {
     const project = await getProject(projectId);
     const failed: number[] = [];
     for (const [index, scene] of project.scenes.entries()) {
       const sceneNumber = index + 1;
       await appendLog(`Generating SFX for scene ${sceneNumber}/${project.scenes.length}…`);
       try {
         await generateSceneSfx(projectId, scene.id);
       } catch (error) {
         failed.push(sceneNumber);
         const message = error instanceof Error ? error.message : String(error);
         logger.warn(`SFX generation failed for scene ${sceneNumber}.`, error);
         await appendLog(`Scene ${sceneNumber} failed: ${message}`);
       }
       await reportProgress(Math.round(((index + 1) / project.scenes.length) * 100));
     }
     if (failed.length > 0) await appendLog(`SFX failed for scenes: ${failed.join(', ')}`);
   }
   ```
   Note `generateSceneSfx` already no-ops (logs and returns) for a scene with an empty `sfxPrompt` rather than throwing, so this loop doesn't need its own empty-prompt skip — it will just log progress through those scenes without generating anything, same as how a scene with no prompt behaves today when triggered individually. **Critical**: this function MUST call `reportProgress` on every iteration exactly as shown — Task 13 in this repo's history was a real bug where a job type forgot to call `reportProgress`, leaving the UI's progress bar stuck at 0%. Do not repeat that mistake here.
   Export it from `src/server/modules/video/index.ts` alongside the existing `generateProjectVoiceovers`/`generateSceneSfx` exports.

2. **`src/server/modules/video/routes.ts`** — add a new route next to `generate-voiceover` (~line 29):
   ```ts
   router.post('/:id/scenes/generate-all-sfx', async (req, res) => {
     const project = await getProject(req.params.id);
     const job = await options.enqueueJob({ type: 'generate-all-sfx', projectId: project.id, payload: { projectId: project.id } });
     res.status(201).json({ jobId: job.id });
   });
   ```
   Match whatever the exact surrounding code for `generate-voiceover` does (variable names, response shape, any readiness guard it applies — check whether `generate-voiceover`'s route asserts anything about project state first, and apply the same guard here if so, or note explicitly if you decide none is needed and why).

3. **`src/worker/registry.ts`** — add a `handleGenerateAllSfx` job handler mirroring `handleGenerateVoiceover` exactly, and register it as `'generate-all-sfx': handleGenerateAllSfx` in `jobHandlers`.

4. **`src/client/features/asset/api.ts`** — add `export function generateAllSfx(projectId: string): Promise<{ jobId: string }>` mirroring `generateAllVoiceovers` exactly (same `JobResponseSchema`, same URL pattern against the new route).

5. **`src/client/features/asset/StudioPage.tsx`** — add a `generateAllSfx()` handler mirroring the existing `generateVisualPrompts`/`generateAllVoiceovers` handlers (busy key, `setJobId(result.jobId)`, toast, error handling), and add a new toolbar button "Tạo tất cả SFX" next to the existing "Tạo voiceover" button in the `.toolbar`'s `.actions` div, using the same `disabled={busy !== null || ...}`/`isProjectJobActive` gating pattern as the other job-triggering buttons there (`generateVisualPrompts`/`splitScenes`).

## Non-goals — do not touch

- Do not change the existing per-scene `generateSceneSfx` function or its route (`POST /:id/scenes/:sceneId/generate-sfx`) — the bulk job calls it as-is.
- Do not change `generateProjectVoiceovers`/`generateProjectBgm` or their routes/handlers.
- Do not remove or restructure the detail dialog from Task 17 — the per-scene "Tạo SFX" button stays there.
- Do not add a "requested but not generated" concept for SFX — the badge and the bulk job both key off `sfxFileId`/generation outcome, not `sfxPrompt` presence.

## Tests

- If a test file already covers `generateProjectVoiceovers`'s loop/progress/failure-tracking behavior (check `src/server/modules/video/tts-service.test.ts` or similar), add an equivalent test for `generateProjectSfx` mirroring that same coverage (all-succeed, one-fails-continues, progress called with the right percentages).
- Add a route test for `POST /:id/scenes/generate-all-sfx` mirroring whatever exists for `generate-voiceover`'s route (job doc created with the right type/payload).
- Add a worker dispatch test for `generate-all-sfx` mirroring `generate-voiceover`'s, if one exists.
- Add a focused unit test for the new `api.generateAllSfx` client function in `asset-api.test.ts`, matching the existing precedent for `generateAllVoiceovers`/`generateVisualPrompts` there.

## Process rules (same as every prior task in this repo)

Never run `git add -A` / `git add .` / `git commit -a` — stage only the exact files you changed, after checking `git diff --stat` first. Run `npm run typecheck`, `npm run lint`, and the relevant `vitest` files before reporting done. This task touches both server (new job) and client (grid CSS + new button) — given that combination, use your own judgment on whether to write a short spec/plan first (as you did for Tasks 14/15) or go straight to implementation with a design summary (as you did for Tasks 16/17); either is fine, just check in with a design summary before writing code if you choose the latter.

**STOP after this report.**
