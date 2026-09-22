# Phase 5 Prompt 2 — Remotion Render Engine Design Specification

**Date:** 2026-09-22  
**Status:** Design only; implementation is intentionally blocked until this spec is reviewed and approved.  
**Sources:** Phase 5 Prompt 2 — Remotion Render Engine design brief, the accepted Phase 5 Prompt 1 implementation, and the current Remotion server-rendering API.

## Goal

Replace the `RemotionRenderer` 501 stub with a real server-side renderer and let Studio switch a project between FFmpeg and Remotion. Both engines implement the existing `VideoRenderer` interface and produce the same project-level MP4 contract. Remotion renders the project scenes as a React composition, resolves project-owned media through `file-store`, stages portable copies into a renderer-owned public directory, and returns the rendered file as a `Buffer` for the existing `video` service to persist.

The existing one-way ownership model remains unchanged: `project` owns project and scene writes, `file-store` owns file metadata and disk paths, `job` owns queue state, and `video` orchestrates renderers. Remotion source is a separate top-level bundle target and is never imported by the client or included in the Node `tsup` entry points.

## Non-goals

- Scene transitions, subtitles, auto-ducking, partial rerendering, timeline scrubbing, or a Remotion-specific visual style.
- Replacing the existing FFmpeg renderer or changing its filter graph.
- A live Remotion Player/editor in Studio; the existing preview-render button remains the UI entry point.
- Serving staged render media through the Express `/files` route.
- A configurable render concurrency setting in this prompt.
- Downloading, pinning, or managing Chrome/Chromium binaries in the repository.

## Existing-repo baseline and boundaries

- `src/server/modules/video/remotion-renderer.ts` currently implements `VideoRenderer` but throws `RENDER_ENGINE_NOT_IMPLEMENTED` for both methods.
- `getVideoRenderer(engine)` already branches on `renderEngine`; the Remotion branch will return the real renderer after this prompt.
- `renderFullProject()` and `renderScenePreviewBuffer()` already select the renderer from the persisted project field. No new collection is needed.
- `project` is the only module allowed to write the `projects` collection. The new `setProjectRenderEngine()` method is exported from `src/server/modules/project/index.ts`; video routes call that public method rather than writing MongoDB directly.
- `file-store.resolveFilePath(projectId, fileId)` remains the only path-resolution entry point. Remotion never reconstructs a path from an untrusted file ID.
- `StudioPage` already renders the project-level engine as a read-only badge and sends preview/render requests through typed asset APIs. The badge becomes a two-option selector after the route is added.

## Review decisions

### 1. Public-dir copy strategy

Use a copy-based strategy, isolated from the Express server. The worker resolves every referenced file through `resolveFilePath(projectId, fileId)`, copies it into a per-render directory with generated names, and passes only relative paths to the Remotion composition. This keeps rendering correct when the web process is down, avoids coupling a worker to an HTTP port, validates ownership before any copy, and is portable on Windows because it does not use symlinks.

Remotion's `bundle()` copies its configured public directory when the bundle is created. Staging new files into the source directory after a process-lifetime bundle would therefore leave the bundle unable to see those files. The implementation will use one stable configured bundle root (`REMOTION_PUBLIC_DIR`, default `./data/remotion-public`), bundle into that root once, and stage each render under the bundle's effective `public/` directory:

```text
data/remotion-public/              # stable bundle root
  public/
    renders/<renderId>/             # fresh files for one render
```

The bundle is created with an empty seed public directory; dynamic assets are copied into `serveUrl/public/renders/<renderId>/` after bundling and before `renderMedia()`. `staticFile('renders/<renderId>/...')` then resolves to the copied file in the bundle that is actually being served. The source staging root is never exposed through `/files`, and the per-render directory is removed in `finally` after the output has been read. This explicit bundle-output staging is the copy-based variant chosen to satisfy both “bundle once” and “fresh files per render”; the HTTP-URL-against-running-server alternative is rejected because it would make render correctness depend on web-server availability and port configuration.

### 2. Bundle cache lifetime

Cache the `bundle()` result as a module-level promise for the lifetime of the worker process. A deployment is assumed to restart the worker, so a source-code change cannot leave a stale bundle in a running process. If bundling fails, clear the cached promise so a later request can retry. `configureVideoRenderer()` resets the cache when tests or an explicitly reconfigured process change the bundle root.

### 3. Render concurrency

Do not add an environment variable. Omit `concurrency` from `renderMedia()` and use Remotion's host-aware default. This keeps the worker's resource policy simple and avoids inventing a tuning contract before real render workloads are measured; a later operational prompt can add a bounded setting if needed.

### 4. Volume parity

Keep the existing FFmpeg string constants exactly as `SFX_VOLUME = '0.31622777'` and `BGM_VOLUME = '0.1'`. Add numeric counterparts derived from those strings (`SFX_VOLUME_NUMBER = Number(SFX_VOLUME)` and `BGM_VOLUME_NUMBER = Number(BGM_VOLUME)`) and use those numeric exports in `SceneSequence`. The same source values therefore reach FFmpeg filter text and Remotion `<Audio volume={...}>` bit-for-bit.

## Dependencies and build isolation

Add the three runtime packages at one compatible Remotion version line:

```text
remotion
@remotion/renderer
@remotion/bundler
```

Do not add `@remotion/cli` or a `remotion:preview` script in this prompt. The repository has no existing Remotion CLI convention, and the server-side renderer plus conditional integration test provide the required verification without another dependency.

`src/remotion/` is a sibling of `src/server`, `src/client`, and `src/contracts`:

```text
src/remotion/
  index.ts
  Root.tsx
  VideoComposition.tsx
  SceneSequence.tsx
  frame-math.ts
  props.ts
```

Build isolation is explicit and tested:

- `tsconfig.server.json` includes `src/server`, `src/worker`, `src/contracts`, test utilities, and build/test config, but not `src/remotion`.
- `tsconfig.client.json` includes `src/client`, `src/contracts`, and Vite config, but not `src/remotion`.
- `tsup.config.ts` has only `src/server/main.ts` and `src/worker/main.ts` as entries; it will not discover `src/remotion`.
- Vite's root is `src/client`, so the Remotion tree is outside the client build graph.
- The Remotion bundler is the only build that compiles `src/remotion/**/*.tsx`, at render time.

The implementation will add a type/build-isolation test or a static scan proving that `npm run build` does not pull React/JSX Remotion code into `dist/server.js`, `dist/worker.js`, or the Vite client chunk.

## Configuration and process wiring

Add to `EnvSchema` and `.env.example`:

```dotenv
REMOTION_PUBLIC_DIR=./data/remotion-public
```

Extend the existing configuration injection without hiding process configuration inside the renderer:

```ts
configureVideoModule(filesDir: string, remotionPublicDir: string): void
configureVideoRenderer(filesDir: string, remotionPublicDir: string): void
```

`src/server/app.ts` and `src/worker/main.ts` pass both `config.FILES_DIR` and `config.REMOTION_PUBLIC_DIR`. The worker is the process that performs project-wide renders; the web process receives the same configuration so synchronous scene previews select the same renderer and public root. The renderer resolves the bundle entry point from the repository's `src/remotion/index.ts` under the configured `rootDir`; deployments must include the Remotion source tree alongside the built server because it is bundled at render time, not by `tsup`.

## Shared Remotion props and frame math

Define the internal JSON-serializable props type in `src/contracts/video.ts` so both the server-side prop builder and the Remotion bundle share one source of truth without importing server modules into the bundle:

```ts
export type RemotionSceneProps = {
  id: string;
  assetType: 'image' | 'video';
  assetRelPath: string;
  voiceRelPath: string | null;
  sfxRelPath: string | null;
  durationSec: number;
};

export type RemotionInputProps = {
  fps: number;
  width: number;
  height: number;
  scenes: RemotionSceneProps[];
  bgmRelPath: string | null;
};
```

Props are plain JSON values only. The builder validates that every relative path uses forward slashes and begins with the generated `renders/<ULID>/` prefix; no absolute path or user-provided filename is passed into the composition.

Export pure helpers from `src/remotion/frame-math.ts` (and unit-test them without importing the Remotion runtime):

- `sceneDurationInFrames(durationSec, fps) = Math.round(durationSec * fps)`.
- Scene `from` values are cumulative sums of the preceding rounded scene durations.
- `durationInFrames = Math.round(totalDurationSec * fps)` where `totalDurationSec` is the sum of authored scene durations.
- `calculateMetadata` returns the input `fps`, `width`, `height`, and computed `durationInFrames`.

The implementation must preserve the required rounding rule even when the sum of individually rounded scene lengths differs by one frame from rounding the total; tests pin both the per-scene sequence values and total metadata rule.

## Remotion composition

`src/remotion/index.ts` calls `registerRoot(RemotionRoot)` and imports no server-only module. `Root.tsx` registers one composition with id `VideoComposition`. It provides a small JSON-safe default props value for Studio discovery, while the render pipeline always supplies real `inputProps`. `calculateMetadata` computes dynamic dimensions and duration from those props; no fixed project duration is compiled into the bundle.

`VideoComposition.tsx` renders scenes in order with `<Sequence from={...} durationInFrames={...}>` and includes the project BGM once at composition scope. `SceneSequence.tsx` renders one scene:

- Image assets use `<Img src={staticFile(assetRelPath)} style={{ objectFit: 'contain', width: '100%', height: '100%' }} />`.
- Video assets use `<OffthreadVideo src={staticFile(assetRelPath)} style={{ objectFit: 'contain', width: '100%', height: '100%' }} />` and are clipped by the enclosing sequence.
- Every scene is wrapped in `<AbsoluteFill style={{ backgroundColor: 'black' }}>` for FFmpeg-compatible letterboxing.
- `voiceRelPath` adds `<Audio src={staticFile(voiceRelPath)} />` at full volume.
- `sfxRelPath` adds `<Audio src={staticFile(sfxRelPath)} volume={SFX_VOLUME_NUMBER} />`.
- Missing voiceover/SFX adds no `<Audio>` element; Remotion does not need FFmpeg's generated silence streams.
- `bgmRelPath`, when present, adds one root-level `<Audio src={staticFile(bgmRelPath)} volume={BGM_VOLUME_NUMBER} loop />` spanning the composition.

`renderScenePreview` builds props with exactly one scene and `bgmRelPath: null`, matching the existing FFmpeg preview scope. The preview does not persist a file.

## Public-dir staging and renderer API

Add a focused staging module (separate from React composition code) with an injectable file resolver/copy/remove dependency for deterministic tests. For every full render or preview:

1. Resolve the visual asset through `resolveFilePath(project.id, scene.assetFileId)` and optional `audioFileId`, `sfxFileId`, and project `bgmFileId`. Verify expected purpose/MIME category before copying.
2. Generate a ULID render id and create `path.join(remotionServeUrl, 'public', 'renders', renderId)`.
3. Copy files, never symlink them, to generated names such as `scene-01-asset.png`, `scene-01-voice.wav`, `scene-01-sfx.mp3`, and `bgm.mp3`. Preserve a safe extension needed by browser media decoding; never use a database filename or original upload name directly.
4. Build relative props using forward-slash paths such as `renders/<renderId>/scene-01-asset.png`.
5. Call `selectComposition({ serveUrl, id: 'VideoComposition', inputProps })`, then `renderMedia({ composition, serveUrl, codec: 'h264', outputLocation, inputProps, onProgress })`.
6. Read the output MP4 into a `Buffer` before entering cleanup.
7. Remove the entire render directory in `finally` on success, render failure, browser failure, or read failure. Cleanup is awaited; if cleanup itself fails, log it without replacing the primary render error.

`RemotionRenderer` receives `filesDir`, `remotionPublicDir`, and injectable seams for tests. Both public methods use the same staging/render path. `renderFullVideo` emits `appendLog` milestones for staging complete, render started, progress buckets at most once per 10%, and render complete. `renderScenePreview` does not require a log callback.

The renderer wraps bundle/browser/render failures in an `AppError` with a stable `REMOTION_RENDER_FAILED` (502) code while preserving the original error in logs. Ownership/path errors from file-store continue to map through their existing error types. The existing `renderFullProject()` persistence flow remains unchanged: it stores the returned buffer with purpose `render`, then atomically calls `setProjectRenderFile()`.

## Project mutation and HTTP API

Add to the public project service and `src/server/modules/project/index.ts`:

```ts
setProjectRenderEngine(projectId: string, engine: RenderEngine): Promise<ProjectDetail>
```

The service performs one optimistic-lock update with `$set: { renderEngine: engine, updatedAt: new Date() }` and `$inc: { version: 1 }`, returning the updated parsed document. A missing project remains `NotFound`; a version mismatch follows the existing `Conflict` pattern.

Add to the existing video router mounted at `/api/project`:

```text
PATCH /api/project/:id/render-engine
body: { engine: 'ffmpeg' | 'remotion' }
response: ProjectDetail
```

The route belongs in the video router because engine selection is part of the render workflow and all neighboring render endpoints already live there. The route remains thin: parse params/body with Zod, call `setProjectRenderEngine`, and respond. It never writes MongoDB directly.

Add a typed client API helper and make the Studio engine badge a two-option selector. Selecting FFmpeg or Remotion calls the route, refreshes the project query on success, and leaves Preview/Render buttons unchanged because server-side factory dispatch already follows `project.renderEngine`. While the request is pending, disable the selector using the existing `busy` state; on failure, preserve the previous selection and show the existing toast error.

## Tests and verification

Use existing Vitest conventions and `mongodb-memory-server` where project/repository state is involved. Do not add a DOM test dependency just for the selector; test the client API helper and pure UI decision helpers in the existing environment, with browser visual verification documented separately.

Pure tests, with no Remotion browser/runtime required:

- Frame math and dynamic metadata, including cumulative scene offsets and total rounding.
- Remotion props building from a `ProjectDetail`/scene list, including relative path normalization and null optional media.
- Staging file names, `resolveFilePath(projectId, fileId)` ownership propagation, and cleanup in `finally` on simulated render failure.
- Bundle promise caching (one `bundle()` call for multiple renders) and reset after a failed bundle/configuration change.
- Numeric volume parity with FFmpeg constants.
- Build-isolation scan confirming no `src/remotion` import enters Vite/tsup output.

Route/project tests:

- `PATCH /:id/render-engine` accepts both engines, rejects invalid values, persists the field/version increment, and subsequent `getVideoRenderer()` selection reflects the persisted engine.
- Remotion selection no longer returns `RENDER_ENGINE_NOT_IMPLEMENTED` in the factory; FFmpeg selection remains unchanged.

Conditional real-browser integration:

- Probe whether `@remotion/renderer` can launch its configured headless browser in the current environment.
- If available, create a tiny fixture image, render one short image-only composition through `RemotionRenderer`, and assert a non-empty MP4 plus successful cleanup.
- If unavailable, skip only the browser-dependent test with an explicit reason naming the missing/unlaunchable Chromium prerequisite. The acceptance report and `MODULE.md` must state exactly which Remotion behaviors were real-tested versus skipped.

Run the full verification set after implementation:

```text
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run build` must still produce the normal Vite client and `tsup` server/worker artifacts without compiling Remotion JSX into them. `eslint.config.js` boundary rules remain unchanged.

## Documentation and commit discipline

`src/server/modules/video/MODULE.md` will document the Chromium/first-run download prerequisite, effective bundle-public staging rationale, process-lifetime bundle cache, dynamic frame math, FFmpeg/Remotion volume parity, cleanup guarantees, concurrency choice, and real-versus-skipped integration coverage. `AGENTS.md` Status is updated in the same commit as each meaningful implementation change. The design-only commit updates both docs to say Prompt 2 is specified but implementation is blocked pending review; it does not add dependencies or code. Stage only files with real content changes, preserve untracked `Claude outputs/`, and do not push.

Implementation remains blocked until this written spec is reviewed and approved, followed by a separate implementation plan review.
