# Phase 5 Prompt 2 — Remotion Render Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Remotion 501 stub with a real bundle-cached renderer, expose atomic project engine selection, and enable the Studio FFmpeg/Remotion toggle while preserving the existing FFmpeg pipeline.

**Architecture:** `src/remotion/` is a runtime-bundled React composition target, excluded from Vite and `tsup`. The server-side `RemotionRenderer` resolves project-owned media through `file-store`, copies it into a fresh `renders/<ULID>/` directory under the stable bundle output `public/` folder, calls `selectComposition()` + `renderMedia()`, reads the MP4, and cleans the directory in `finally`. The project service owns the atomic `renderEngine` update; video routes and the Studio selector call it through public APIs.

**Tech Stack:** TypeScript/React, Remotion (`remotion`, `@remotion/renderer`, `@remotion/bundler`), Express 5/Zod, MongoDB driver, Node `fs/promises`, ULID, Vitest, `mongodb-memory-server`, optional headless Chromium.

**Spec:** `docs/superpowers/specs/2026-09-22-phase5-remotion-design.md`

## Global Constraints

- Add only `remotion`, `@remotion/renderer`, and `@remotion/bundler`; do not add `@remotion/cli` or a preview script.
- `REMOTION_PUBLIC_DIR` defaults to `./data/remotion-public`; the configured directory is the stable bundle root and the effective staged public directory is `<serveUrl>/public`.
- Bundle once per worker process; clear the cached bundle promise on failure and when renderer configuration changes.
- Stage copies into `<serveUrl>/public/renders/<renderId>/`; do not use symlinks, Express `/files` URLs, or arbitrary absolute paths inside composition props.
- Use `selectComposition({ serveUrl, id: 'VideoComposition', inputProps })` followed by `renderMedia({ composition, serveUrl, codec: 'h264', outputLocation, inputProps })`.
- Omit `renderMedia` concurrency configuration; use Remotion's default host-aware behavior.
- Keep FFmpeg/Remotion audio levels bit-for-bit: SFX `0.31622777`, BGM `0.1`; derive numeric values from the existing string constants.
- `src/remotion` is outside `tsconfig.server.json`, `tsconfig.client.json`, Vite's `src/client` root, and `tsup` entry points.
- `project` remains the sole owner of project writes; `video` imports it only through `src/server/modules/project/index.ts`.
- Remotion errors map to `REMOTION_RENDER_FAILED` / HTTP 502; file-store ownership errors preserve their existing error mapping.
- Update `AGENTS.md` Status and `src/server/modules/video/MODULE.md` in the same commit as every meaningful change.
- Stage only files with real content changes; never use `git add -A` or `git add .`; preserve untracked `Claude outputs/`; never push.

## Review Focus

1. **Bundle-output staging:** files copied into the source public directory after `bundle()` must not be assumed visible; tests pin that props point into `<serveUrl>/public/renders/<ULID>/` and that the directory is removed after success and failure (Task 3).
2. **Ownership and media safety:** a file ID owned by another project, an unexpected file purpose/MIME, or an unsafe extension must fail before `copyFile`/`renderMedia`; tests pin resolver arguments and no cross-project copy (Task 3).
3. **Cache/error lifecycle:** concurrent renders share one bundle promise; a rejected bundle can be retried; `configureVideoRenderer()` invalidates the old bundle (Task 3).
4. **Frame/audio parity:** rounded scene offsets, total duration, image/video components, and exact SFX/BGM numeric levels match the spec and FFmpeg constants (Tasks 1 and 3).
5. **Environment/build boundaries:** server/client builds do not include Remotion JSX, while the conditional integration test reports an explicit Chromium skip reason when launch is unavailable (Task 6).

---

### Task 1: Remotion contracts, composition scaffold, and build isolation

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `src/server/config.ts`, `.env.example`
- Modify: `src/contracts/video.ts`
- Create: `src/remotion/index.ts`
- Create: `src/remotion/Root.tsx`
- Create: `src/remotion/VideoComposition.tsx`
- Create: `src/remotion/SceneSequence.tsx`
- Create: `src/remotion/frame-math.ts`
- Test: `src/server/modules/video/remotion.test.ts` (pure scaffold/frame/build-isolation tests)
- Modify: `AGENTS.md`, `src/server/modules/video/MODULE.md`

**Interfaces:**
- `RemotionSceneProps` and `RemotionInputProps` are JSON-safe shared types exported from `src/contracts/video.ts`.
- `SFX_VOLUME_NUMBER` and `BGM_VOLUME_NUMBER` are shared numeric constants derived from the string values; `src/server/modules/video/docs.ts` will re-export them in Task 3.
- `sceneDurationInFrames(durationSec: number, fps: number): number`, `sceneFrameTimings(scenes, fps)`, and `totalDurationInFrames(scenes, fps): number` are pure helpers.
- `REMOTION_PUBLIC_DIR` is present in `Config` and `.env.example` with default `./data/remotion-public`.

- [ ] **Step 1: Add the failing pure tests.** Write tests for `Math.round(durationSec * fps)`, cumulative `from` offsets, total-duration rounding, JSON-safe props shape, exact numeric volume values, and a build-isolation scan that confirms the server/client TypeScript include globs and build entries do not include `src/remotion`.
- [ ] **Step 2: Run the focused tests to verify RED.** Run `npx vitest run src/server/modules/video/remotion.test.ts`; expect missing exports and missing Remotion scaffold/config failures, not a test-runner startup error.
- [ ] **Step 3: Install the approved Remotion packages at one compatible version line.** Run `npm install remotion @remotion/renderer @remotion/bundler`; do not install the optional CLI. Extend `EnvSchema` and `.env.example` with `REMOTION_PUBLIC_DIR`.
- [ ] **Step 4: Implement shared contracts and pure frame helpers.** Add the exact props types, numeric constants derived from the existing string literals, and frame-math functions with no filesystem or Remotion runtime dependency.
- [ ] **Step 5: Implement the composition scaffold.** Register `RemotionRoot` from `src/remotion/index.ts`; register `VideoComposition` with JSON-safe defaults and dynamic `calculateMetadata`; render scene sequences and media layers with `staticFile`, `Img`, `OffthreadVideo`, `Audio`, and black `AbsoluteFill`. Keep composition imports limited to `remotion` and `src/contracts`.
- [ ] **Step 6: Run GREEN tests and build-isolation checks.** Re-run the focused test, then `npm run typecheck` and `npm run build`; verify `dist/server.js`, `dist/worker.js`, and the Vite client output do not contain Remotion composition module paths.
- [ ] **Step 7: Update docs and commit.** Record the new dependency/external Chromium prerequisite and the design-only implementation boundary in `AGENTS.md`/`MODULE.md`. Stage exact files and commit `feat(remotion): scaffold composition and build-isolation config`.

### Task 2: Project-owned render-engine mutation

**Files:**
- Modify: `src/server/modules/project/service.ts`
- Modify: `src/server/modules/project/index.ts`
- Modify: `src/server/modules/project/MODULE.md`, `AGENTS.md`
- Test: `src/server/modules/video/video.test.ts` (project mutation block)

**Interfaces:**
- `setProjectRenderEngine(projectId: string, engine: RenderEngine): Promise<ProjectDetail>` performs one optimistic-lock update with `$set` and `$inc: { version: 1 }`.
- The method is exported only through `src/server/modules/project/index.ts`; no video code imports `project/service.ts`.

- [ ] **Step 1: Write the failing mutation tests.** Seed a project, call the public method for both `'ffmpeg'` and `'remotion'`, assert the returned persisted engine and exactly one version increment, and assert an unknown project throws `NotFound`.
- [ ] **Step 2: Run the focused test to verify RED.** Run `npx vitest run src/server/modules/video/video.test.ts -t "render engine mutation"`; expect the missing export/method failure.
- [ ] **Step 3: Implement the atomic service method.** Use the existing project update helper with a filter on `_id`, `$set: { renderEngine, updatedAt: new Date() }`, and `$inc: { version: 1 }`; parse and return the updated document, mapping `matchedCount === 0` to existing `NotFound`/conflict behavior.
- [ ] **Step 4: Run GREEN and boundary checks.** Re-run the focused test and `npm run lint`; verify no direct `projects` collection access is added outside `project`.
- [ ] **Step 5: Update docs and commit.** Document that project owns the engine field and commit `feat(project): add render-engine mutation API` with `AGENTS.md`.

### Task 3: Remotion bundle, staging, renderer, and pure failure tests

**Files:**
- Create: `src/server/modules/video/remotion-bundle.ts`
- Create: `src/server/modules/video/remotion-props.ts`
- Create: `src/server/modules/video/remotion-staging.ts`
- Modify: `src/server/modules/video/remotion-renderer.ts`
- Modify: `src/server/modules/video/index.ts`
- Modify: `src/server/modules/video/docs.ts`
- Test: `src/server/modules/video/remotion.test.ts`
- Modify: `AGENTS.md`, `src/server/modules/video/MODULE.md`

**Interfaces:**
- `configureVideoRenderer(filesDir: string, remotionPublicDir: string): void` resets both renderer singletons and the bundle cache.
- `getRemotionBundle(): Promise<string>` returns the cached absolute bundle root/serve URL and retries after a rejected bundle promise.
- `buildRemotionInputProps(project, scenes, renderId, resolver): Promise<RemotionInputProps>` resolves and validates project-owned files, returning only relative paths.
- `stageRemotionRender(options): Promise<{ renderId: string; renderDir: string; outputPath: string; inputProps: RemotionInputProps; cleanup(): Promise<void> }>` copies generated asset/audio names into the effective bundle `public/` directory.
- `RemotionRenderer` implements the existing `VideoRenderer` methods and accepts injectable bundle/render/file seams for tests.

- [ ] **Step 1: Write RED tests for props and staging.** Cover one image scene, one video scene, optional voice/SFX/BGM nulls, forward-slash relative paths, generated extensions, resolver ownership arguments, purpose/MIME mismatch rejection before copy, and cleanup after a simulated render/read failure.
- [ ] **Step 2: Write RED tests for bundle lifecycle and renderer calls.** Assert two renders call `bundle()` once, a rejected bundle can be retried, `configureVideoRenderer()` invalidates the cache, `selectComposition()` receives the same props as `renderMedia()`, progress logs are emitted at milestones/10% buckets, and render failures map to `REMOTION_RENDER_FAILED` 502.
- [ ] **Step 3: Run the focused tests to verify RED.** Run `npx vitest run src/server/modules/video/remotion.test.ts`; expect missing staging/bundle/renderer exports and the old 501 behavior.
- [ ] **Step 4: Implement bundle caching.** Use `@remotion/bundler` `bundle({ entryPoint: absolute src/remotion/index.ts, outDir: remotionPublicDir, publicDir: empty seed dir, rootDir: process.cwd() })`; cache the promise, clear it on rejection, and use `serveUrl/public` as the dynamic staging root. Do not bundle per render.
- [ ] **Step 5: Implement props and staging.** Resolve each required file via `createFileStoreService(filesDir).resolveFilePath(projectId, fileId)`, validate expected purpose/MIME and safe extensions, copy to `serveUrl/public/renders/<ULID>/`, build forward-slash props, and provide awaited force-cleanup.
- [ ] **Step 6: Implement renderer orchestration.** Call `selectComposition()` and `renderMedia()` with `codec: 'h264'`, no concurrency option, generated output path, same `inputProps`, and coarse progress logging. Read the output before cleanup and wrap bundle/browser/render errors in `AppError(..., 502, 'REMOTION_RENDER_FAILED')`.
- [ ] **Step 7: Add numeric parity exports and factory wiring.** Re-export numeric constants from `video/docs.ts`; return the configured `RemotionRenderer` singleton for `'remotion'` while preserving FFmpeg singleton behavior. Extend `configureVideoModule` to pass `REMOTION_PUBLIC_DIR` through.
- [ ] **Step 8: Run GREEN tests and commit.** Run the focused Remotion suite plus `npm run typecheck`; update module docs with the staging/cache/cleanup contract and commit `feat(video): implement Remotion renderer with public-dir staging`.

### Task 4: Render-engine route and process wiring

**Files:**
- Modify: `src/server/modules/video/routes.ts`
- Modify: `src/server/modules/video/index.ts`
- Modify: `src/server/app.ts`
- Modify: `src/worker/main.ts`
- Test: `src/server/modules/video/video.test.ts`
- Modify: `AGENTS.md`, `src/server/modules/video/MODULE.md`

**Interfaces:**
- `PATCH /api/project/:id/render-engine` accepts `{ engine: 'ffmpeg' | 'remotion' }` and returns `ProjectDetail`.
- `configureVideoModule(filesDir, remotionPublicDir)` is called by both web and worker startup paths.

- [ ] **Step 1: Write RED route/wiring tests.** Assert valid FFmpeg/Remotion updates, invalid engine `400`, missing project `404`, and that route code uses the public project API. Add a config propagation assertion that worker/app pass the same `REMOTION_PUBLIC_DIR` value.
- [ ] **Step 2: Run the focused route tests.** Run `npx vitest run src/server/modules/video/video.test.ts -t "render-engine route|Remotion configuration"`; expect missing route/config behavior.
- [ ] **Step 3: Implement the thin route.** Parse `req.params.id` and `z.object({ engine: z.enum(RENDER_ENGINES) })`, call `setProjectRenderEngine`, and return the updated project. Keep it in the existing video router mounted at `/api/project`.
- [ ] **Step 4: Wire configuration.** Add `config.REMOTION_PUBLIC_DIR` to `createVideoRouter`/module setup as appropriate; call `configureVideoModule(config.FILES_DIR, config.REMOTION_PUBLIC_DIR)` in `app.ts` and after DB connection in `worker/main.ts` before handlers are loaded.
- [ ] **Step 5: Run GREEN tests and commit.** Run focused route/wiring tests and `npm run lint`; commit `feat(video): add render-engine route and configuration wiring` with Status/module docs.

### Task 5: Studio Remotion selector

**Files:**
- Modify: `src/client/features/asset/api.ts`
- Modify: `src/client/features/asset/StudioPage.tsx`
- Modify: `src/client/features/asset/StudioPage.module.css`
- Test: `src/client/features/asset/asset-api.test.ts`
- Modify: `AGENTS.md`, `src/server/modules/video/MODULE.md`

**Interfaces:**
- `setRenderEngine(projectId: string, engine: RenderEngine): Promise<ProjectDetail>` calls the new route through `apiRequest`.
- Studio exposes two mutually exclusive engine choices, disables them while busy, refreshes on success, and preserves the previous value on failure.

- [ ] **Step 1: Write RED client API/helper tests.** Assert the exact PATCH URL/body and a pure selector-state helper maps persisted `renderEngine` to the selected option without introducing DOM dependencies.
- [ ] **Step 2: Run focused client tests.** Run `npx vitest run src/client/features/asset/asset-api.test.ts`; expect the missing helper failure.
- [ ] **Step 3: Implement the typed API helper.** Import `RenderEngine` from `contracts/project`, call `PATCH /api/project/:id/render-engine`, and parse `ProjectDetail`.
- [ ] **Step 4: Implement the selector UI.** Replace the read-only badge with FFmpeg/Remotion buttons/select, call the helper, refresh project data, show existing toast errors, and keep existing preview/render actions unchanged.
- [ ] **Step 5: Run GREEN client checks and commit.** Run focused client tests, `npm run typecheck`, and `npm run build`; commit `feat(client): enable Remotion engine selector` with docs/status updates.

### Task 6: Conditional browser integration, build isolation, and full verification

**Files:**
- Modify: `src/server/modules/video/remotion.test.ts`
- Modify: `src/server/modules/video/video.test.ts`
- Modify: `src/server/modules/video/MODULE.md`, `AGENTS.md`

- [ ] **Step 1: Add the RED conditional integration test.** Probe `@remotion/renderer` browser launchability. When available, generate a tiny fixture image and render one short image-only composition through the real renderer, asserting a non-empty MP4 and no leftover `renders/<ULID>` directory. When unavailable, skip with an explicit reason containing the missing/unlaunchable Chromium condition.
- [ ] **Step 2: Add build-isolation regression coverage.** After a build, assert the generated server/worker/client artifacts contain no `src/remotion` module path or Remotion composition code, while the Remotion entry remains bundleable independently.
- [ ] **Step 3: Run the focused Remotion/integration suites.** Run `npx vitest run src/server/modules/video/remotion.test.ts src/server/modules/video/video.test.ts`; record whether Chromium ran for real or was skipped and why.
- [ ] **Step 4: Run the complete verification set.** Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`; inspect dependency/boundary changes and retain only the existing Vite chunk-size warning if present.
- [ ] **Step 5: Commit test evidence.** Commit `test(video): verify Remotion integration and build isolation` with exact real-vs-skipped evidence in `AGENTS.md`/`MODULE.md`.

### Task 7: Final acceptance documentation

**Files:**
- Modify: `src/server/modules/video/MODULE.md`
- Modify: `AGENTS.md`
- Modify: `.superpowers/sdd/2026-09-22-phase5-remotion-implementation/progress.md` (ignored execution ledger)

- [ ] **Step 1: Record acceptance facts.** Document Remotion package versions, Chromium availability/launchability, real integration output or explicit skip reason, frame/volume/staging tests, route/client coverage, build-isolation result, full test count, typecheck/lint/build output, and deferred gaps.
- [ ] **Step 2: Run the final status audit.** Verify `git status --short` contains only the pre-existing untracked `Claude outputs/`, `eslint.config.js` is unchanged, all meaningful commits include Status/module updates, and no public create/list job routes or unrelated file-store/ZIP changes were introduced.
- [ ] **Step 3: Commit acceptance docs.** Commit `docs(phase5): record Remotion render engine acceptance` and report checklist, files, commands, decisions, gaps, and readiness for the next prompt.

## Execution Handoff

This plan is intentionally sequential: Task 1 defines the Remotion props/composition contracts, Task 2 defines the project mutation, Task 3 consumes both to implement the renderer, Task 4 exposes the route and process configuration, Task 5 consumes that route in Studio, and Task 6 verifies the complete path. Implementation starts only after this plan is reviewed and the execution method is confirmed; no product code is changed by this plan commit.
