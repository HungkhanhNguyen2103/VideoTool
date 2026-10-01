# Remotion Render Timing, Smarter Concurrency, and Draft Render

## Goal

Improve observability and memory-aware throughput for the Remotion render path, and add a fast draft preview path, without changing the FFmpeg renderer or non-draft Remotion visuals.

## Scope and constraints

- Changes are limited to the Remotion path, the shared render job/API data needed to invoke it, and Studio controls for the draft action.
- FFmpeg rendering remains behaviorally unchanged. Draft requests on FFmpeg are rejected with HTTP 422 and are never enqueued.
- No dependencies, bundle-cache behavior, GPU/NVENC settings, or non-draft composition visuals change.
- Work is committed in three implementation commits:
  - `feat(video): log remotion render timings`
  - `perf(video): limit remotion concurrency only for depth scenes`
  - `feat(video): add draft render for fast previews`

## Current behavior verified

- `RemotionRenderer.render()` forces `concurrency: 1` whenever input props have `parallax: 'auto'`, regardless of actual eligible depth scenes.
- `REMOTION_CHROMIUM_OPTIONS` is `{ gl: 'angle' }` and Remotion uses codec `h264`.
- Progress logs are emitted only when the progress fraction enters a new 10% bucket.
- Installed `@remotion/renderer` is 4.0.527. Its `RenderMediaOptions` supports `scale` and `everyNthFrame`; the implementation renders every Nth source frame and uses `composition.fps / everyNthFrame` for the output/stitching FPS.

## Part A: timing and memory telemetry

`RemotionRenderer` will time bundle acquisition, staging, composition selection, media rendering, output read, and total render duration using a monotonic clock. The cached bundle path is identified in the bundle log. Each timing is sent to `appendLog` when present and to `logger.info`.

At render start, the renderer logs `os.freemem()`. On every Remotion progress callback it samples `process.memoryUsage().rss`, tracks the peak RSS, and includes elapsed seconds and a current frame-rate estimate in every 10% progress line. The final line keeps this exact shape:

`Remotion render done: <frames> frames in <s>s (<fps_eff> frames/s), concurrency <n>, <width>x<height>@<fps>, scenes <n> (video <v>, depth <d>), output <MB>`

The timing commit reports the existing legacy concurrency decision but does not change it. Timing tests use injected fake bundle/select/render/read functions and assert the stage, progress, and summary lines without relying on wall-clock values.

## Part B: depth-aware concurrency

The concurrency decision is based on the existing depth eligibility rule: the project must use parallax `auto`, and a scene must be an image whose depth map points at the current asset and has an eligible score. A helper in `depth-eligibility.ts` is shared by this decision and remains consistent with Remotion asset staging.

- Eligible depth scene present: pass `concurrency: 1` and log `concurrency 1: depth scenes present`.
- No eligible depth scene and validated `REMOTION_CONCURRENCY` present: pass the value capped at `os.cpus().length` and log `env override N` using the capped value.
- Otherwise: omit the `concurrency` option and log `default`.

`REMOTION_CONCURRENCY` is optional, must be a positive integer when non-empty, and empty means Remotion default. The validated value is passed through web and worker video-module configuration into `RemotionRenderer`; the FFmpeg renderer does not consume it.

## Part C: draft render and persistence

The render request body is strict `{ draft?: boolean }` with default `false`. The normalized boolean is included in the `render-full-video` job payload. Existing jobs without the field are treated as final renders.

The render interface accepts an optional render request `{ draft?: boolean }`. For Remotion drafts only:

- pass `scale: 0.5` and `everyNthFrame: 2` to `renderMedia`;
- render a parallax-off project copy so depth maps are not staged or processed;
- preserve keyword popups, transitions, narration/audio, and other representative composition behavior;
- label timing logs/summary with `DRAFT`.

The installed Remotion behavior will be checked in a real smoke render. If `everyNthFrame: 2` causes audio drift, it will be removed and the draft will use scale-only; the report will state that fallback explicitly.

Draft output is stored separately:

- add `render-draft` to the file-purpose contract and validation lists;
- add additive `draftRenderFileId` to project documents and `ProjectDetail`, defaulting to `null` so legacy projects parse safely;
- add a project-owned `setProjectDraftRenderFile()` mutation that changes only the draft pointer/version;
- store generated drafts as `render-draft` files with a clearly labeled `render-draft.mp4` name;
- final renders continue to use `renderFileId`, `purpose: 'render'`, and status `rendered`;
- `duplicateProject` clears both render pointers, and project deletion removes both referenced files plus their disk files while retaining the existing deletion behavior for other files.

Studio adds a `Render nháp (nhanh)` button beside `Render video`, with the same busy/readiness rules. On FFmpeg it is disabled and has tooltip `Chi co o engine Remotion`. A valid `render-draft` video is shown as `Bản nháp` with preview and download link; the final render display remains unchanged.

## Error handling and ownership

- Render readiness remains checked before enqueueing.
- Draft-on-FFmpeg returns an application 422 error and does not create a job.
- Project and file-store module ownership is preserved: video stores bytes through file-store and updates render pointers through project APIs.
- Remotion staging cleanup and output cleanup preserve existing failure handling.

## Test and acceptance strategy

Part A tests cover all timing log stages, cache annotation, progress elapsed/FPS text, memory telemetry, effective concurrency logging, and final summary format using fakes.

Part B tests cover auto-parallax with no depth (no concurrency option), eligible depth (1), environment override, CPU capping, empty env default, and invalid configuration.

Part C tests cover strict request parsing/defaults, job payload propagation, Remotion draft options and parallax suppression, unchanged final options, separate draft persistence, legacy/default/duplicate behavior, deletion cleanup, FFmpeg rejection, and client API/control contracts.

Verification includes focused tests after each commit, the full test suite, typecheck, lint, build, and a real small 720p/24fps project render for both final and draft paths. The smoke report will include the complete job logs, elapsed time, frames/s, peak RSS, start free memory, and visual/audio assessment.
