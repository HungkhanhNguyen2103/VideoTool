# Module: video

**Purpose:** Build scene previews and project renders from project-owned scenes, voiceovers, SFX, and BGM.
**Owns collection(s):** none in this phase; `project` owns scene/project references and `file-store` owns binary metadata.
**May import (via public `index.ts` APIs):** project, asset, job, shared file-store, TTS, and Freesound adapters.
**Public API:** renderer interfaces/factory and orchestration functions exported from `index.ts`.

## Invariants

- Video code never calls `getCollection('projects')`; scene/project writes stay in the project service.
- Every FFmpeg input path is resolved through file-store ownership checks for the current project.
- Scene segments always have H.264 video plus stereo 48 kHz AAC audio, including generated silence when voiceover or SFX is absent.
- SFX is mixed at `0.31622777` (~-10 dB); BGM is mixed at `0.1` (-20 dB). SFX is never looped.
- The Remotion composition is isolated under `src/remotion`; the server renderer resolves only project-owned media, stages generated names under the bundle-output `public/renders/<renderId>/`, and cleans that directory after each render.

## Rendering flow

`FfmpegRenderer` creates a temporary segment for each scene, scales/pads the visual to the project render settings, mixes voiceover and optional SFX, and concatenates segments in scene order. When BGM exists, a second FFmpeg pass loops/trims the BGM and mixes it with the concatenated audio.

The BGM pass intentionally runs a second FFmpeg pass over the full video: it copies the video stream and re-encodes the mixed audio. This is a deliberate simplicity/performance trade-off for this phase; long projects may benefit from a future single-pass filter graph.

`buildSceneArguments`, `buildConcatArguments`, and `buildBgmArguments` are pure argument builders so filter graphs can be tested without an installed binary. The renderer uses raw `child_process.spawn` argument arrays, streams stdout lines to `appendLog`, preserves stderr on failure, and removes temporary files in `finally` blocks.

The scene graph scales/pads visuals, adds temporal last-frame padding for short video assets, creates silent stereo 48 kHz inputs when audio is absent, and mixes voice/SFX at the fixed levels above. Voiceover mastering uses the shared high-pass/loudness filter with an unmastered fallback; duration is `ceil(ffprobeSeconds + 0.3)`.

The orchestration services call VieNeu and Freesound adapters, store generated voiceover/SFX/BGM/render files through the configured file-store service, and mutate scene/project references only through the public project API. Freesound keyword normalization and query extraction use the Vietnamese reference dictionary verbatim, including its matching order, delimiter splitting, two-word fallback prefix, and first-seen deduplication. Voiceover batches run sequentially and continue after an individual failure; a failed scene keeps its previous reference and duration.

The router is mounted explicitly at `/api/project`. Project-wide voiceover and render requests enqueue jobs; single-scene voiceover regeneration, SFX/BGM generation, and preview rendering remain synchronous. Worker handlers check cancellation before invoking the service and forward `appendLog` for progress events.

## Prerequisites and known gaps

- FFmpeg and ffprobe are external prerequisites selected by `FFMPEG_PATH`/`FFPROBE_PATH`, falling back to binaries on `PATH`.
- Remotion requires a compatible headless Chromium; the renderer may download it on first use. This is an external/first-run prerequisite and is not bundled or managed by this module.
- Real-binary integration tests are conditional on those executables being available; pure builder and Remotion tests do not require them.
- Scene transitions, subtitles, partial rerenders, auto-ducking, and orphan-file cleanup are intentionally deferred.
- VieNeu/Freesound live-provider calls, Chromium launchability, and browser Studio visual checks remain environment-dependent acceptance gaps until Prompt 2 implementation verification; adapter tests use mocks.

## Phase 5 Prompt 2 implementation

The written design and seven-task implementation plan are committed at `docs/superpowers/specs/2026-09-22-phase5-remotion-design.md` and `docs/superpowers/plans/2026-09-22-phase5-remotion-implementation.md`. Tasks 1–5 are complete: `src/contracts/video.ts` owns JSON-safe props and exact numeric audio volumes, `src/remotion/` owns the independent composition/frame-math entry, the bundle is cached per process with reset-on-failure/reconfiguration, staging validates file ownership/purpose/MIME/extension before copy, `PATCH /api/project/:id/render-engine` is wired through project ownership with matching web/worker public roots, and Studio offers the persisted engine selector. Task 6 adds conditional Chromium and build-isolation acceptance coverage.

## Acceptance

- Task 5 pure renderer tests cover scaling/padding/fps, silent inputs, voice/SFX mixing, exact volume constants, concat/BGM arguments, and the Remotion 501 error.
- Task 6 service tests cover voiceover storage/duration, failure preservation, batch continuation, SFX/BGM no-op and storage, render readiness, and atomic final render metadata.
- Task 7 route/worker tests cover job payloads, synchronous regeneration/preview content type, provider no-op responses, and cancellation checks.
- Task 8 ran the real scene+BGM and short-video duration integrations with `C:\ffmpeg\bin\ffmpeg.exe` and `C:\ffmpeg\bin\ffprobe.exe`; no binary tests were skipped. Project acceptance is 138 passing tests, typecheck/lint/build green, and worker startup plus SIGINT shutdown logs verified.
- Task 9 adds typed Studio API helpers and controls for voiceover, SFX, BGM, previews, render readiness, engine selection badges, and SSE job progress/logs; generated media remains resolved from `FileSummary` purpose/MIME metadata.
- Phase 5 Prompt 1 acceptance: 138 tests pass, 1 existing stub test file is skipped, `npm run typecheck`, `npm run lint`, and `npm run build` pass, and the built worker starts and logs clean SIGINT shutdown. No dependency or `eslint.config.js` boundary change was made. Prompt 2 Task 1 adds the scaffold and passes its focused tests, typecheck, and build-isolation scan.
