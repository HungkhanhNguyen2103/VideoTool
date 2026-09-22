# Phase 5 Prompt 1 — Video/Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement VieNeu voiceovers, Freesound SFX/BGM, the FFmpeg renderer, render/voiceover jobs and routes, and the Studio controls while leaving Remotion as a documented 501 stub.

**Architecture:** `project` remains the sole owner of project/scene writes; `file-store` remains the sole owner of file metadata and safe disk paths. Shared TTS/Freesound clients are provider adapters; `video` orchestrates them and builds FFmpeg commands with raw `spawn`. Project-wide operations run through the existing job queue, while one-scene regeneration and preview rendering stay synchronous.

**Tech Stack:** TypeScript/Express 5, Zod, MongoDB driver, React/TanStack Query, Node `child_process.spawn`, VieNeu HTTP API, Freesound HTTP API, FFmpeg/ffprobe binaries, Vitest, `mongodb-memory-server`.

**Spec:** `docs/superpowers/specs/2026-09-22-phase5-video-design.md`

## Global Constraints

- FFmpeg and ffprobe are external binaries selected by `FFMPEG_PATH`/`FFPROBE_PATH`, falling back to `ffmpeg`/`ffprobe` on `PATH`; do not install or manage them.
- VieNeu is a separately managed HTTP service at `TTS_API_URL`; video-tool never starts it.
- `FREESOUND_API_KEY` may be empty; missing key/no result/download failure is a warning and no-op, never a thrown generation failure.
- Use raw `child_process.spawn` argument arrays; do not add `fluent-ffmpeg` or any other runtime wrapper.
- `video` never calls `getCollection('projects')` and imports `project`, `asset`, and `job` only through public `index.ts` APIs.
- Use `FILE_PURPOSES = ['reference', 'voiceover', 'sfx', 'bgm', 'render']` and store every generated binary through `file-store`.
- Keep the exact audio levels: SFX `volume=0.31622777` (~-10 dB), BGM `volume=0.1` (-20 dB), and `AUDIO_BUFFER_SECONDS = 0.3`.
- Keep a uniform stereo 48 kHz audio stream per scene; generate silence when voiceover/SFX is absent.
- Do not implement Remotion, auto-ducking, user audio upload, scene transitions, subtitles, partial rerender, or orphan-file GC.
- Update `AGENTS.md` Status and the relevant `MODULE.md` in the same commit as every meaningful change.
- Never use `git add -A` or `git add .`; stage only files with real content changes; never push.

## Review Focus

1. Legacy project/scene documents missing new audio/render fields receive schema defaults; pin in Task 1 contract tests.
2. A file ID from another project cannot be resolved into an FFmpeg input path; pin in Task 1 file-store ownership tests.
3. TTS timeout/retry and mastering failure must preserve the intended fallback behavior; pin in Task 3 tests.
4. Freesound missing-key, no-result, malformed-response, and download-failure cases must never throw; pin in Task 4 tests.
5. Mixed image/video scenes with missing audio, short/long SFX, and project BGM must produce deterministic filter graphs and cleanup; pin in Task 5 pure-builder tests plus conditional binary tests.

---

### Task 1: Contracts, configuration, and file-store capabilities

**Files:**
- Modify: `src/contracts/project.ts`
- Modify: `src/contracts/file.ts`
- Modify: `src/server/config.ts`
- Modify: `.env.example`
- Modify: `src/server/modules/project/docs.ts`
- Modify: `src/server/modules/file-store/docs.ts`
- Modify: `src/server/modules/file-store/service.ts`
- Modify: `src/server/modules/file-store/index.ts`
- Modify: `src/server/modules/file-store/routes.ts`
- Test: `src/server/modules/file-store/file-store.test.ts`
- Modify: `AGENTS.md`, `src/server/modules/file-store/MODULE.md`, `src/server/modules/project/MODULE.md`

**Interfaces:**
- Produces `RENDER_ENGINES`, defaulted project/scene fields, `FILE_PURPOSES`, audio MIME support, `Config` TTS/FFmpeg/Freesound fields, and `createFileStoreService(...).resolveFilePath(projectId, fileId)`.
- `resolveFilePath` returns `{ absolutePath, mimeType, purpose }` and throws the existing not-found error for missing or cross-project IDs.

- [ ] **Step 1: Write failing contract/default tests.** Pin parsing of a legacy project with no `renderEngine`, `voiceoverVoice`, `renderFileId`, `bgmMood`, `bgmFileId`, `audioFileId`, `sfxPrompt`, or `sfxFileId`; expect `ffmpeg`, `Truc Ly`, `null`, `''`, `null`, `null`, `''`, `null`. Pin file summaries for each new purpose and `audio/wav`/`audio/mpeg` MIME acceptance.
- [ ] **Step 2: Run the focused tests to verify RED.** Run `npx vitest run src/server/modules/file-store/file-store.test.ts`; expect missing schema fields/purposes to fail.
- [ ] **Step 3: Implement schemas/config.** Add the constants and defaults to contracts and server docs; extend `EnvSchema` with `TTS_API_URL`, `TTS_DEFAULT_VOICE`, `TTS_TIMEOUT_MS`, `FFMPEG_PATH`, `FFPROBE_PATH`, and `FREESOUND_API_KEY`; add the same environment entries to `.env.example`. Make `CreateProjectRequest` accept the defaulted fields and make `createProject` persist defaults explicitly.
- [ ] **Step 4: Implement file-store purpose/path support.** Change `FileDocSchema`/`StoreFileParams` to use `FilePurpose`; add `resolveFilePath` that looks up the file, checks `doc.projectId === projectId`, and returns `path.join(filesDir, doc.storedPath)` only after that check. Keep generated stored basenames and existing delete/list behavior unchanged. Export the method through the factory/index; no route exposes arbitrary disk paths.
- [ ] **Step 5: Run focused tests to verify GREEN.** Run `npx vitest run src/server/modules/file-store/file-store.test.ts`; expect all existing tests plus new purpose/ownership tests to pass.
- [ ] **Step 6: Update docs and commit.** Record new defaults, purpose ownership, and safe path resolution in `MODULE.md`/`AGENTS.md`. Stage exact files and commit `feat(contracts): add video audio fields and file purposes`.

### Task 2: Project-owned mutation APIs

**Files:**
- Modify: `src/server/modules/project/service.ts`
- Modify: `src/server/modules/project/index.ts`
- Modify: `src/server/modules/project/MODULE.md`
- Create: `src/server/modules/video/video.test.ts` (project-mutation describe block; later tasks extend this same suite)
- Modify: `AGENTS.md`

**Interfaces:**
- Produces `patchProjectScene` support for `audioFileId`, `durationSec`, `sfxPrompt`, and `sfxFileId`.
- Produces `setProjectBgm(projectId, mood, bgmFileId)` and `setProjectRenderFile(projectId, renderFileId)` returning updated `ProjectDetail`.

- [ ] **Step 1: Add RED assertions to the video integration test scaffold.** Seed a project and assert scene audio/duration/SFX patching, atomic BGM mood+file update, and render-file/status update with exactly one version increment.
- [ ] **Step 2: Run the focused test.** Run `npx vitest run src/server/modules/video/video.test.ts -t "project mutation"`; expect missing exports/methods to fail.
- [ ] **Step 3: Implement minimal public service methods.** Extend the existing filtered positional scene update. Implement `setProjectBgm` and `setProjectRenderFile` through the existing project-owned `updateOne` helper, with `$set` and `$inc: { version: 1 }`; render sets `status: 'rendered'` in the same write.
- [ ] **Step 4: Run focused GREEN tests.** Re-run the test name and verify the version increments once per mutation and no direct project collection access is introduced outside `project`.
- [ ] **Step 5: Update docs and commit.** Document ownership/atomicity and commit `feat(project): add render and audio mutation APIs` with `AGENTS.md`.

### Task 3: VieNeu TTS client, mastering, and probing

**Files:**
- Create: `src/server/shared/tts/types.ts`
- Create: `src/server/shared/tts/vieneu.ts`
- Create: `src/server/shared/tts/mastering.ts`
- Create: `src/server/shared/tts/index.ts`
- Test: `src/server/shared/tts/tts.test.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- `TtsClient.synthesize(text, opts?): Promise<Buffer>`.
- `getTtsClient(): TtsClient`, `masterAudio(buffer): Promise<Buffer>`, and a probe helper returning seconds.

- [ ] **Step 1: Write RED tests with mocked fetch/spawn.** Cover request JSON/default voice, one failure then success retry, two failures mapping to `TTS_REQUEST_FAILED` 502, timeout abort, mastering returning original bytes when FFmpeg fails, and the `Math.ceil(probed + 0.3)` duration rule.
- [ ] **Step 2: Run focused tests.** Run `npx vitest run src/server/shared/tts/tts.test.ts`; expect failures because the shared client does not exist.
- [ ] **Step 3: Implement VieNeu client.** Use `fetch` and `AbortController`, apply `TTS_TIMEOUT_MS`, retry exactly once after 1500 ms, validate HTTP success/content bytes, and map exhaustion to `AppError` without exposing response secrets.
- [ ] **Step 4: Implement mastering/probe.** Create temp files under the OS temp directory, invoke configured FFmpeg/ffprobe with argument arrays, collect stderr for diagnostics, clean files in `finally`, and return the unmastered audio on mastering failure with a warning. Keep probing failures explicit (they must not silently invent a duration).
- [ ] **Step 5: Run GREEN tests and commit.** Run the focused suite, then commit `feat(tts): add VieNeu client mastering and probe helpers` with `AGENTS.md`.

### Task 4: Freesound keyword mapping and resilient client

**Files:**
- Create: `src/server/shared/freesound/keyword-map.ts`
- Create: `src/server/shared/freesound/client.ts`
- Create: `src/server/shared/freesound/index.ts`
- Test: `src/server/shared/freesound/freesound.test.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- `normalizeKeyword(value): string`, `extractSearchQueries(prompt): string[]`.
- `FreesoundClient.searchAndDownloadSfx(prompt): Promise<Buffer | null>` and `.searchAndDownloadBgm(mood): Promise<Buffer | null>`.

- [ ] **Step 1: Write RED mapping/client tests.** Pin the reference Vietnamese mappings, `tiếng` stripping, filter-word removal, generic fallback cleaning, query order, missing API key with zero fetch calls, first-hit preview selection, no-result null, malformed response null, and download failure null.
- [ ] **Step 2: Run focused tests.** Run `npx vitest run src/server/shared/freesound/freesound.test.ts`; expect missing module/function failures.
- [ ] **Step 3: Implement keyword data exactly from the reference.** Do not redesign the mapping or fallback order; export pure functions for direct tests.
- [ ] **Step 4: Implement HTTP client.** Use `fetch`, pass the API token, URL-encode query/filter/sort/page-size fields, stop at first SFX result, use the specified BGM query/filter, select HQ then LQ MP3 preview, and catch/log every provider failure to return `null`.
- [ ] **Step 5: Run GREEN tests and commit.** Commit `feat(freesound): add resilient search and download client` with `AGENTS.md`.

### Task 5: FFmpeg renderer and Remotion stub

**Files:**
- Create: `src/server/modules/video/docs.ts`
- Create: `src/server/modules/video/ffmpeg-renderer.ts`
- Create: `src/server/modules/video/remotion-renderer.ts`
- Create: `src/server/modules/video/index.ts`
- Create: `src/server/modules/video/MODULE.md`
- Modify: `src/server/modules/video/video.test.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- `VideoRenderer`, `FfmpegRenderer`, `RemotionRenderer`, `getVideoRenderer(engine)`.
- Pure builders consume `ProjectDetail`, `Scene`, resolved file paths, and durations and produce spawn argument arrays/filter strings.

- [ ] **Step 1: Write RED pure-builder tests.** Assert image/video input arguments, scaling/padding/fps, silent-input creation, voice/SFX `amix`, exact SFX `volume=0.31622777`, concat list arguments, BGM `volume=0.1` second-pass graph, and Remotion 501 code. Add a cleanup test with a mocked spawn failure.
- [ ] **Step 2: Run focused tests.** Run `npx vitest run src/server/modules/video/video.test.ts -t "renderer|filter|remotion"`; expect missing exports/functions.
- [ ] **Step 3: Implement command builders and spawn runner.** Use `spawn(executable, args, { stdio: ['ignore','pipe','pipe'] })`, resolve paths only through file-store, stream progress lines to `appendLog` when present, reject nonzero exit, and preserve stderr in the error message.
- [ ] **Step 4: Implement scene segments.** For each scene, create a temp segment with uniform H.264/AAC, stereo 48 kHz audio, exact duration, silent inputs as needed, and no SFX looping. Use `finally` to remove all segment/temp files.
- [ ] **Step 5: Implement concat and BGM pass.** Write a safe concat list of generated segment paths, concatenate in scene order, then re-encode once more only when BGM exists using the documented `[1:a]...volume=0.1[bgmD];[0:a][bgmD]amix...` graph. Add a one-line MODULE note that this second pass re-encodes the full video and is a deliberate simplicity/performance trade-off.
- [ ] **Step 6: Implement factory/stub and run GREEN tests.** Return singletons for `ffmpeg`/`remotion`; Remotion methods throw `RENDER_ENGINE_NOT_IMPLEMENTED` 501. Run focused renderer tests.
- [ ] **Step 7: Commit renderer/docs.** Commit `feat(video): add FFmpeg renderer and Remotion stub` with `AGENTS.md` and the complete `video/MODULE.md` prerequisites/filter graph/performance note.

### Task 6: Voiceover, SFX/BGM, and render services

**Files:**
- Create: `src/server/modules/video/tts-service.ts`
- Create: `src/server/modules/video/service.ts`
- Modify: `src/server/modules/video/index.ts`
- Test: `src/server/modules/video/video.test.ts`
- Modify: `AGENTS.md`, `src/server/modules/video/MODULE.md`

**Interfaces:**
- `generateSceneVoiceover(projectId, sceneId, opts?): Promise<SceneDoc>`.
- `generateProjectVoiceovers(projectId, appendLog): Promise<void>`.
- `generateSceneSfx(projectId, sceneId): Promise<void>` and `generateProjectBgm(projectId, mood): Promise<void>`.
- `renderFullProject(projectId, appendLog): Promise<void>` and `renderScenePreviewBuffer(projectId, sceneId): Promise<Buffer>`.
- `configureVideoModule(filesDir: string): void` injects the configured file-store factory for production and isolated tests.

- [ ] **Step 1: Write RED service tests.** Mock TTS/Freesound/file-store/renderer adapters. Cover voiceover storage and duration patching, previous-reference preservation on failure, sequential batch continuation/log summary, SFX/BGM no-op-on-miss, project BGM atomic mood/file update, `SCENES_NOT_READY` with scene numbers, render storage and final status update, and preview returning an ephemeral buffer.
- [ ] **Step 2: Run focused tests.** Run `npx vitest run src/server/modules/video/video.test.ts -t "voiceover|SFX|BGM|render service"`; expect failures.
- [ ] **Step 3: Implement voiceover service.** Load project/scene through public APIs, call TTS → master → probe → file-store, then patch audio/duration. Batch in array order with per-scene try/catch and final failed-number log.
- [ ] **Step 4: Implement SFX/BGM services.** Call Freesound clients, no-op on null/empty inputs, store MP3 with correct purpose, and update scene/project through project public APIs only. Use `configureVideoModule(filesDir)` to inject `createFileStoreService(filesDir)` rather than a hard-coded path.
- [ ] **Step 5: Implement render orchestration.** Validate all scene asset IDs before renderer selection, throw `SCENES_NOT_READY` 422 with one-based missing numbers, store MP4 purpose `render`, and call `setProjectRenderFile`.
- [ ] **Step 6: Run GREEN tests and commit.** Commit `feat(video): add voiceover SFX/BGM and render services` with docs/status.

### Task 7: Worker handlers, routes, and app wiring

**Files:**
- Modify: `src/worker/registry.ts`
- Create: `src/server/modules/video/routes.ts`
- Modify: `src/server/modules/video/index.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/modules/video/MODULE.md`, `AGENTS.md`
- Test: `src/server/modules/video/video.test.ts`

**Interfaces:**
- Job types `generate-voiceover` and `render-full-video`, payload `{ projectId }`.
- `createVideoRouter({ enqueueJob })` mounted at `/api/project`.
- Routes: `POST /:id/scenes/generate-voiceover`, `POST /:id/scenes/:sceneId/regenerate-voiceover`, `GET /:id/scenes/:sceneId/render-preview`, `POST /:id/scenes/:sceneId/generate-sfx`, `POST /:id/generate-bgm`, and `POST /:id/render`.

- [ ] **Step 1: Write RED route/registry tests.** Assert 201 job responses, synchronous regenerate response, BGM/SFX success/no-op, preview `video/mp4`, unready render 422, and both handlers checking cancellation and forwarding `context.appendLog`.
- [ ] **Step 2: Run focused route tests.** Run `npx vitest run src/server/modules/video/video.test.ts -t "route|worker"`; expect missing router/handler behavior.
- [ ] **Step 3: Implement handlers and injection.** Register explicit handlers in `registry.ts`; inject `enqueueJob` into the video router like script routes; mount it explicitly in `createApp` after the existing project routers.
- [ ] **Step 4: Implement thin routes.** Validate params/body with Zod, call services or enqueue jobs, stream preview buffers with `Content-Type: video/mp4`, and let the shared error handler map typed errors. The SFX route takes no body and uses the scene's current prompt; the BGM route validates `{ mood: string }` and returns the updated project even when Freesound misses.
- [ ] **Step 5: Run GREEN tests and commit.** Commit `feat(video): add routes worker handlers and app wiring` with updated module docs/status.

### Task 8: Full server integration and binary verification tests

**Files:**
- Modify: `src/server/modules/video/video.test.ts`
- Modify: `src/server/modules/video/MODULE.md`, `AGENTS.md`

- [ ] **Step 1: Add conditional binary tests.** Detect `FFMPEG_PATH` and `FFPROBE_PATH` with a small executable probe. If both are available, run a tiny generated PNG/silence fixture through one scene and one BGM mix; otherwise skip only those tests with the exact missing-binary reason.
- [ ] **Step 2: Run the full video suite.** Run `npx vitest run src/server/modules/video/video.test.ts`; expect all provider/service/route tests plus either real binary tests or documented skips.
- [ ] **Step 3: Run project-wide checks.** Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`; inspect for boundary/dependency changes and the existing Vite chunk warning.
- [ ] **Step 4: Run worker smoke.** Start `node --env-file=.env dist/worker.js`, verify `worker started`, send SIGINT, and verify clean shutdown.
- [ ] **Step 5: Commit test/docs acceptance.** Commit `test(video): cover video pipeline and binary availability` with `AGENTS.md`/`MODULE.md`, recording exactly which FFmpeg paths ran for real and which were skipped.

### Task 9: Studio voiceover, SFX/BGM, and render controls

**Files:**
- Modify: `src/client/features/asset/api.ts`
- Modify: `src/client/features/asset/StudioPage.tsx`
- Modify: `src/client/features/asset/StudioPage.module.css`
- Test: `src/client/features/asset/asset-api.test.ts`
- Modify: `AGENTS.md`, `src/server/modules/video/MODULE.md`

**Interfaces:**
- Typed client calls for all new video routes and `ProjectDetail`/`FileSummary` resolution by purpose.
- Existing `useJobProgress(jobId)` drives project-wide progress/logs.

- [ ] **Step 1: Write RED API-helper tests.** Pin route paths, request bodies, `video/mp4` preview blob handling, file lookup for audio/render purposes, and missing-scene render disable computation as pure helpers.
- [ ] **Step 2: Run focused client tests.** Run `npx vitest run src/client/features/asset/asset-api.test.ts`; expect new helper failures.
- [ ] **Step 3: Implement typed API helpers.** Add generate-all, regenerate, SFX, BGM, render, and preview functions using existing `apiRequest`/`fetch` conventions. Ensure preview object URLs are revoked on replacement/unmount.
- [ ] **Step 4: Extend Studio UI.** Add BGM mood/player, per-scene SFX prompt/player/button, voiceover player/regenerate, job progress/log display, preview button, render button/readiness list, and FFmpeg/Remotion badges. Refresh project/files after mutations and use MIME-aware media elements.
- [ ] **Step 5: Run GREEN client tests and build.** Run focused tests, then `npm run typecheck` and `npm run build`; fix only client/video integration issues.
- [ ] **Step 6: Commit client work.** Commit `feat(client): add voiceover SFX BGM and render controls` with Status updated.

### Task 10: Final documentation and acceptance

**Files:**
- Modify: `src/server/modules/video/MODULE.md`
- Modify: `AGENTS.md`
- Create or modify: `.superpowers/sdd/2026-09-22-phase5-video-implementation/progress.md` (ignored execution ledger)

- [ ] **Step 1: Record acceptance facts.** Include test counts, `mongodb-memory-server` result, FFmpeg/ffprobe availability and real-vs-skipped tests, worker smoke output, external prerequisites, two-pass re-encode trade-off, and all deferred gaps.
- [ ] **Step 2: Run final status audit.** Verify `git status --short` contains only the pre-existing untracked `Claude outputs/`, `eslint.config.js` is unchanged, and no package dependency was added beyond the explicitly chosen implementation (raw spawn means none).
- [ ] **Step 3: Commit docs.** Commit `docs(phase5): record video module acceptance` with the final Status and readiness for Prompt 2.

## Execution Handoff

This plan is intentionally sequential because each task consumes interfaces produced by the previous task and every meaningful commit must update the shared Status/module ledger. Implementation starts only after plan review and confirmation of the execution method; no product code is changed by this plan commit.
