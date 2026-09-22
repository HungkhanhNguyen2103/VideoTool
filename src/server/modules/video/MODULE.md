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
- The `remotion` engine remains an explicit 501 `RENDER_ENGINE_NOT_IMPLEMENTED` stub.

## Rendering flow

`FfmpegRenderer` creates a temporary segment for each scene, scales/pads the visual to the project render settings, mixes voiceover and optional SFX, and concatenates segments in scene order. When BGM exists, a second FFmpeg pass loops/trims the BGM and mixes it with the concatenated audio.

The BGM pass intentionally re-encodes the full video a second time. This is a deliberate simplicity/performance trade-off for this phase; long projects may benefit from a future single-pass filter graph.

`buildSceneArguments`, `buildConcatArguments`, and `buildBgmArguments` are pure argument builders so filter graphs can be tested without an installed binary. The renderer uses raw `child_process.spawn` argument arrays, streams stdout lines to `appendLog`, preserves stderr on failure, and removes temporary files in `finally` blocks.

The orchestration services call VieNeu and Freesound adapters, store generated voiceover/SFX/BGM/render files through the configured file-store service, and mutate scene/project references only through the public project API. Voiceover batches run sequentially and continue after an individual failure; a failed scene keeps its previous reference and duration.

## Prerequisites and known gaps

- FFmpeg and ffprobe are external prerequisites selected by `FFMPEG_PATH`/`FFPROBE_PATH`, falling back to binaries on `PATH`.
- Real-binary integration tests are conditional on those executables being available; pure builder and Remotion tests do not require them.
- Scene transitions, subtitles, partial rerenders, auto-ducking, and orphan-file cleanup are intentionally deferred.

## Acceptance

- Task 5 pure renderer tests cover scaling/padding/fps, silent inputs, voice/SFX mixing, exact volume constants, concat/BGM arguments, and the Remotion 501 error.
- Task 6 service tests cover voiceover storage/duration, failure preservation, batch continuation, SFX/BGM no-op and storage, render readiness, and atomic final render metadata.
