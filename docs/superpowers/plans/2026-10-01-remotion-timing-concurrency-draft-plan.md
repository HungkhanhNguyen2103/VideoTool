# Remotion Render Timing, Smarter Concurrency, and Draft Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Remotion timing/RAM telemetry, depth-aware concurrency selection, and a separate fast draft render while preserving FFmpeg and final-render behavior.

**Architecture:** Keep all render orchestration in `modules/video`, with project-owned render pointers and file-store-owned binary metadata. Pass validated Remotion settings from web/worker startup into the Remotion renderer, and carry draft intent through the existing `render-full-video` job. Extend the existing Studio controls and project detail contract without introducing a second render job type.

**Tech Stack:** Node.js 22+, TypeScript strict, Express 5, zod, MongoDB driver, React/Vite, Vitest, Remotion 4.0.527.

**Spec:** `docs/superpowers/specs/2026-10-01-remotion-timing-concurrency-draft-design.md`

## Global Constraints

- Changes are limited to the Remotion path, the shared render job/API data needed to invoke it, and Studio controls for the draft action.
- FFmpeg rendering remains behaviorally unchanged; draft requests on FFmpeg return HTTP 422 and are never enqueued.
- No dependencies, bundle-cache behavior, GPU/NVENC settings, or non-draft composition visuals change.
- `draftRenderFileId` and `render-draft` default safely for legacy documents.
- Draft Remotion uses `scale: 0.5`, `everyNthFrame: 2`, and parallax off unless the smoke render proves audio drift, in which case only `everyNthFrame` is removed.

## Review Focus

- Legacy project documents missing `draftRenderFileId` must parse as `null`; test in project docs and project reads.
- A depth map that is present but stale, ineligible, video-scene-owned, or asset-mismatched must not force concurrency 1; test each predicate class.
- An oversized `REMOTION_CONCURRENCY` must be capped to the machine CPU count; test with mocked CPU count.
- A draft render must never mutate `renderFileId` or project status; test service persistence against an existing final render.
- Deleting a project with final and draft pointers must remove both metadata records and disk files; test ownership-safe cleanup.

---

### Task 1: Remotion timing and memory telemetry

**Files:**
- Modify: `src/server/modules/video/remotion-renderer.ts`
- Test: `src/server/modules/video/remotion.test.ts`

**Interfaces:**
- Consumes: existing `RemotionRenderer.renderFullVideo()` callbacks and injected bundle/select/render/read dependencies.
- Produces: stage timing logs, progress telemetry, peak RSS tracking, and the exact final summary format; no render option behavior change.

- [ ] **Step 1: Write failing timing tests**

Add fake-render tests that assert bundle/staging/select/render/read/total logs, cache annotation across two renders, start free-memory logging, progress elapsed/FPS text, effective legacy concurrency logging, and the exact summary fields for image/video/depth counts and output MB.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/server/modules/video/remotion.test.ts`

Expected: the new timing assertions fail because the renderer does not yet emit the requested telemetry.

- [ ] **Step 3: Implement timing telemetry**

Use a monotonic clock and a shared helper that writes each message to `appendLog` when available and `logger.info`. Time each existing stage without changing bundle caching or render options. Sample RSS in `onProgress`, estimate current FPS from rendered frames and elapsed time, and emit 10% bucket logs with elapsed/FPS. Emit the exact summary line using the effective legacy concurrency value for this commit.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `npm test -- src/server/modules/video/remotion.test.ts`

Expected: all Remotion tests pass, including the new timing assertions.

- [ ] **Step 5: Commit Part A**

```bash
git add src/server/modules/video/remotion-renderer.ts src/server/modules/video/remotion.test.ts
git commit -m "feat(video): log remotion render timings"
```

### Task 2: Depth-aware concurrency and configuration

**Files:**
- Modify: `src/server/config.ts`, `.env.example`, `src/server/config.test.ts`
- Modify: `src/server/modules/video/depth-eligibility.ts`, `src/server/modules/video/remotion-renderer.ts`, `src/server/modules/video/remotion.test.ts`
- Modify: `src/server/modules/video/index.ts`, `src/server/modules/video/service.ts`, `src/server/app.ts`, `src/server/main.ts`, `src/worker/main.ts`, `src/server/modules/video/video.test.ts`

**Interfaces:**
- Consumes: Part A’s explicit concurrency/logging seam and existing depth eligibility/staging rules.
- Produces: `REMOTION_CONCURRENCY` config, explicit `RemotionRendererOptions.remotionConcurrency?: number`, and depth/env/default rule selection.

- [ ] **Step 1: Write failing configuration and concurrency tests**

Test empty/valid/invalid `REMOTION_CONCURRENCY`, no-depth auto-parallax with no `concurrency` render option, eligible depth with `concurrency: 1`, env override, CPU cap, and rule log text. Add source-wiring assertions for passing the setting through app and worker configuration where existing tests cover startup wiring.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/server/config.test.ts src/server/modules/video/remotion.test.ts src/server/modules/video/video.test.ts`

Expected: new tests fail because config and the renderer still use the old project-level parallax shortcut.

- [ ] **Step 3: Implement validated config and selection**

Parse empty env as `undefined`, require a positive integer otherwise, pass the configured value through `createApp` and worker `configureVideoModule`, add a shared `hasUsableDepthScene` predicate, cap overrides with `os.cpus().length`, and only include the Remotion `concurrency` option for depth-forced or env-forced cases. Keep FFmpeg construction untouched.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `npm test -- src/server/config.test.ts src/server/modules/video/remotion.test.ts src/server/modules/video/video.test.ts`

Expected: all focused configuration, concurrency, wiring, and existing video tests pass.

- [ ] **Step 5: Commit Part B**

```bash
git add .env.example src/server/config.ts src/server/config.test.ts src/server/app.ts src/server/main.ts src/worker/main.ts src/server/modules/video/depth-eligibility.ts src/server/modules/video/index.ts src/server/modules/video/service.ts src/server/modules/video/remotion-renderer.ts src/server/modules/video/remotion.test.ts src/server/modules/video/video.test.ts
git commit -m "perf(video): limit remotion concurrency only for depth scenes"
```

### Task 3: Draft render persistence, API, worker, and Studio

**Files:**
- Modify: `src/contracts/file.ts`, `src/contracts/project.ts`, `src/server/modules/project/docs.ts`, `src/server/modules/project/service.ts`, `src/server/modules/project/repo.ts`
- Modify: `src/server/modules/file-store/MODULE.md`, file-store tests as needed for purpose validation and cleanup
- Modify: `src/server/modules/video/ffmpeg-renderer.ts`, `src/server/modules/video/remotion-renderer.ts`, `src/server/modules/video/service.ts`, `src/server/modules/video/routes.ts`, `src/worker/registry.ts`, `src/server/modules/video/remotion.test.ts`, `src/server/modules/video/video.test.ts`
- Modify: `src/client/features/asset/api.ts`, `src/client/features/asset/StudioPage.tsx`, `src/client/features/asset/asset-api.test.ts`, `src/client/features/asset/StudioPage.module.css` only if layout needs a draft label/link style

**Interfaces:**
- Consumes: Part B’s Remotion renderer options and configured concurrency; existing project/file-store public APIs and `render-full-video` job registration.
- Produces: strict render request parsing, `RenderVideoOptions`, `draftRenderFileId`, `render-draft` file purpose, draft job propagation, separate draft storage, and Studio controls.

- [ ] **Step 1: Write failing draft tests**

Cover strict `{ draft?: boolean }` parsing/defaults and FFmpeg 422; worker payload propagation; Remotion draft `scale`, `everyNthFrame`, parallax-off input, and `DRAFT` summary; final render omission of draft options; project schema legacy default/duplicate clearing; service draft persistence without changing final pointer/status; deletion cleanup; client API body and draft file filtering/link contract.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/server/modules/video/remotion.test.ts src/server/modules/video/video.test.ts src/server/modules/project/docs.test.ts src/server/modules/file-store/file-store.test.ts src/client/features/asset/asset-api.test.ts`

Expected: new draft tests fail because the contracts, renderer option, route, persistence, and UI do not yet exist.

- [ ] **Step 3: Implement contracts and project/file persistence**

Add `render-draft` to all purpose enums, add defaulted `draftRenderFileId`, include it in project shaping/creation/duplication, expose `setProjectDraftRenderFile`, and make deletion remove both referenced render files and their disk files through file-store ownership APIs without broadening unrelated cleanup.

- [ ] **Step 4: Implement render request, worker, and renderer behavior**

Parse the strict request, reject draft on FFmpeg, carry `draft` through the existing job, default missing worker payloads to final, extend renderer calls with `{ draft?: boolean }`, apply draft Remotion options and parallax suppression, store draft output under `render-draft`, and use the project draft mutation. Preserve final output/status behavior.

- [ ] **Step 5: Implement Studio controls and client contract**

Add typed `renderProject(projectId, draft?)`, the second button with the exact label/tooltip/disabled rules, and a `Bản nháp` preview/download block gated by purpose/MIME. Keep existing final render controls unchanged.

- [ ] **Step 6: Run focused tests to verify GREEN**

Run: `npm test -- src/server/modules/video/remotion.test.ts src/server/modules/video/video.test.ts src/server/modules/project/docs.test.ts src/server/modules/file-store/file-store.test.ts src/client/features/asset/asset-api.test.ts`

Expected: all draft, persistence, route, renderer, and client API tests pass.

- [ ] **Step 7: Commit Part C**

```bash
git add src/contracts/file.ts src/contracts/project.ts src/server/modules/project/docs.ts src/server/modules/project/service.ts src/server/modules/project/repo.ts src/server/modules/file-store/MODULE.md src/server/modules/file-store src/server/modules/video/ffmpeg-renderer.ts src/server/modules/video/remotion-renderer.ts src/server/modules/video/service.ts src/server/modules/video/routes.ts src/worker/registry.ts src/server/modules/video/remotion.test.ts src/server/modules/video/video.test.ts src/client/features/asset/api.ts src/client/features/asset/StudioPage.tsx src/client/features/asset/asset-api.test.ts src/client/features/asset/StudioPage.module.css
git commit -m "feat(video): add draft render for fast previews"
```

### Final verification

- [ ] Run `npm test` and record the full passing count.
- [ ] Run `npm run typecheck` and record the exit code.
- [ ] Run `npm run lint` and record the exit code.
- [ ] Run `npm run build` and record the exit code.
- [ ] Perform the real 720p/24fps normal and draft Remotion smoke renders, capture complete job logs, start free memory, peak RSS, render duration, frames/s, output dimensions/FPS, and audio-sync/visual assessment. If `everyNthFrame` drifts audio, make the required scale-only correction with a failing regression test before reporting.
