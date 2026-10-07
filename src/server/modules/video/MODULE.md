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
- The Remotion composition is isolated under `src/remotion`; the server renderer resolves only project-owned media, stages generated names under the bundle-output `public/renders/<renderId>/`, and cleans that directory after each render. An optional project logo is resolved with purpose `logo`, staged as `logo.<ext>`, and rendered once at composition level at 25% opacity outside FilmLook. FFmpeg intentionally ignores it.

## Rendering flow

`FfmpegRenderer` creates a temporary segment for each scene, scales/pads the visual to the project render settings, mixes voiceover and optional SFX, and concatenates segments in scene order. When BGM exists, a second FFmpeg pass loops/trims the BGM and mixes it with the concatenated audio.

The BGM pass intentionally runs a second FFmpeg pass over the full video: it copies the video stream and re-encodes the mixed audio. This is a deliberate simplicity/performance trade-off for this phase; long projects may benefit from a future single-pass filter graph.

`buildSceneArguments`, `buildConcatArguments`, and `buildBgmArguments` are pure argument builders so filter graphs can be tested without an installed binary. The renderer uses raw `child_process.spawn` argument arrays, streams stdout lines to `appendLog`, preserves stderr on failure, and removes temporary files in `finally` blocks.

The scene graph scales/pads visuals, adds first-frame padding at the start of measured short video assets, and trims the result to the scene duration. It creates silent stereo 48 kHz inputs when audio is absent and mixes voice/SFX at the fixed levels above. Remotion uses the keyframe when present or holds the clip's frame 0 before starting the clip at its own frame 0; embedded source-video audio is muted so it cannot bypass the explicit voice/SFX mix. Voiceover, SFX, and keyword overlays remain anchored to scene time 0 and do not move with the visual clip offset. The legacy `videoTailFileId` remains project/import data but is not staged or used by rendering. Cleanup failures are logged without replacing the primary render/staging error. Voiceover mastering uses the shared high-pass/loudness filter with an unmastered fallback; duration is `ceil(ffprobeSeconds + 0.3)`.

The orchestration services call VieNeu and Freesound adapters, store generated voiceover/SFX/BGM/render files through the configured file-store service, and mutate scene/project references only through the public project API. Freesound keyword normalization and query extraction use the Vietnamese reference dictionary verbatim, including its matching order, delimiter splitting, two-word fallback prefix, and first-seen deduplication. Voiceover batches run sequentially and continue after an individual failure; a failed scene keeps its previous reference and duration.

The router is mounted explicitly at `/api/project`. Project-wide voiceover and render requests enqueue jobs; single-scene voiceover regeneration, SFX/BGM generation, and preview rendering remain synchronous. Worker handlers check cancellation before invoking the service and forward `appendLog` for progress events.

Logo uploads use a dedicated 5 MB memory-upload route. Replacement stores the new logo and updates the project pointer before best-effort cleanup of the old file; removal clears the pointer before cleanup. Studio previews and Remotion drafts retain the logo; only the existing preview BGM omission remains special-cased.

## Word-timing groundwork (Task 34)

After storing each mastered WAV, video sends its bytes and original narration to the Python `/api/align` endpoint. Alignment is best-effort: a failure is logged and leaves the voiceover valid. The Python model is lazy-loaded from a pre-downloaded local path; see `lib/README.md` for the Python 3.12/CUDA setup. The TS request timeout is 120 seconds, covering cold model load and ordinary scene alignment.

The pure sequence alignment keeps narration whitespace tokens and maps normalized Whisper words in order. Insertions in the transcript are ignored; unmatched narration tokens receive spans interpolated between neighboring matched words (or the WAV boundaries). The named `MIN_WORD_ALIGNMENT_MATCH_RATIO` is 0.7: a result below that ratio is rejected to `null`. Negative, non-monotonic, and out-of-WAV spans are also rejected. Stored `wordTimings` carry the source `audioFileId`. Project-owned writes compare both that file ID and narration atomically, and audio replacement or narration replacement clears stale timings. The queued `align-word-timings` job backfills scenes sequentially, skips scenes without audio or with current timings, and checks cancellation between scenes. Rendering uses current timings for name/place popups.

## AI name and place popups (Task 82)

The video module analyzes eligible project scenes in one JSON-mode request and validates each phrase against a contiguous run in the scene's narration and timed words. Up to two ranked candidates are persisted per scene through the project service with a captured narration/audio stale guard. The prompt orders by importance and breaks equal-importance ties by first appearance; it requires verbatim contiguous wording, includes meaningful proper-name prefixes, and rejects generic nouns unless part of a proper name. Both AI clients honor JSON mode when requested; DeepSeek analysis explicitly sends `temperature: 0` (the SDK HTTP body is covered by a fake-fetch serialization test). Only malformed JSON is retried once; schema or scene-number validation failures fail without a second AI call. A valid empty candidate list is persisted as a fresh empty record, clearing prior choices; provider/parse errors and responses whose candidates are all rejected leave existing data unchanged. Render-time selection rechecks the narration hash, audio ID, and timed-word match; stale or invalid records are ignored and rule-based extraction remains the fallback. On narration edits, the prior record is retained but stale while `audioFileId` and `wordTimings` are cleared; there is no popup until new aligned audio exists, then rules are used while the record remains stale. Re-analysis refreshes the record and restores AI selection (`có kết quả mới`). Per-scene voiceover regeneration also retains its prior record as stale. Records are cleared only for duplicate projects or a bulk scene reset that sets `audioFileId` to `null` (`chưa phân tích`). Completion of the project-wide `align-word-timings` job triggers best-effort analysis; per-scene voiceover regeneration does not, so users may request analysis manually.

Re-analysis can select differently in an ambiguous/tied scene. The accepted tie-break is first appearance for equal-importance names; on the 2026-10-07 Rạch Gầm smoke pair, renderer keyword arrays matched across all scenes. Two candidate records differed only in the category assigned to the same phrase `Xiêm` (scene 32: `place`/`group`; scene 38: `place`/`group`); neither category variant changed the selected popup or Remotion props. Because render-time input comes from persisted candidates, it remains stable between analyses. This is not a claim that future analyses always return identical candidate records.

## Prerequisites and known gaps

- FFmpeg and ffprobe are external prerequisites selected by `FFMPEG_PATH`/`FFPROBE_PATH`, falling back to binaries on `PATH`.
- Remotion requires a compatible headless Chromium; the renderer may download it on first use. This is an external/first-run prerequisite and is not bundled or managed by this module.
- Real-binary integration tests are conditional on those executables being available; this acceptance run used FFmpeg/ffprobe and Remotion Chrome Headless Shell successfully. Pure builder/props/staging tests remain binary-free.
- Scene transitions, subtitles, partial rerenders, auto-ducking, and orphan-file cleanup are intentionally deferred.
- VieNeu/Freesound live-provider calls and browser Studio visual checks remain environment-dependent gaps; the Remotion Chromium prerequisite was launched successfully in this acceptance run and adapter tests continue to use mocks.

## Phase 5 Prompt 2 implementation

The written design and seven-task implementation plan are committed at `docs/superpowers/specs/2026-09-22-phase5-remotion-design.md` and `docs/superpowers/plans/2026-09-22-phase5-remotion-implementation.md`. Tasks 1–7 are complete: `src/contracts/video.ts` owns JSON-safe props and exact numeric audio volumes, `src/remotion/` owns the independent composition/frame-math entry, the bundle is cached per process with reset-on-failure/reconfiguration, staging validates file ownership/purpose/MIME/extension before copy, `PATCH /api/project/:id/render-engine` is wired through project ownership with matching web/worker public roots, Studio offers the persisted engine selector, progress log writes are serialized/awaited, and the acceptance suite rendered a real one-second MP4 via local Chrome Headless Shell. The build-isolation scan found no `src/remotion`, `VideoComposition`, `registerRoot`, or `@remotion/` composition code in `dist/server.js`, `dist/worker.js`, or client JS.

## Acceptance

- Task 5 pure renderer tests cover scaling/padding/fps, silent inputs, voice/SFX mixing, exact volume constants, concat/BGM arguments, and Remotion renderer selection.
- Task 6 service tests cover voiceover storage/duration, failure preservation, batch continuation, SFX/BGM no-op and storage, render readiness, and atomic final render metadata.
- Task 7 route/worker tests cover job payloads, synchronous regeneration/preview content type, provider no-op responses, and cancellation checks.
- Task 8 ran the real scene+BGM and short-video duration integrations with `C:\ffmpeg\bin\ffmpeg.exe` and `C:\ffmpeg\bin\ffprobe.exe`; no binary tests were skipped. Project acceptance is 138 passing tests, typecheck/lint/build green, and worker startup plus SIGINT shutdown logs verified.
- Task 9 adds typed Studio API helpers and controls for voiceover, SFX, BGM, previews, render readiness, engine selection badges, and SSE job progress/logs; generated media remains resolved from `FileSummary` purpose/MIME metadata.
- Task 80 adds conservative generic name-prefix handling to `keywords.ts`: geography prefixes are included in place popup text and timing, event/polity prefixes omit `nameRole`, role phrases remain subtitles, sentence-start prefixed names are allowed, and dedupe compares the bare capitalized run. Focused keyword tests pass 24/24; the full suite passes 722 tests with 1 skipped; typecheck, lint, and build pass.
- Phase 5 Prompt 1 acceptance: 138 tests pass, 1 existing stub test file is skipped, `npm run typecheck`, `npm run lint`, and `npm run build` pass, and the built worker starts and logs clean SIGINT shutdown. Prompt 2 final acceptance: 156 tests pass, the pre-existing `project` todo file is skipped, Remotion 4.0.527 renders a non-empty one-second MP4 with local Chrome Headless Shell, FFmpeg/ffprobe integrations run, source-video audio is muted for engine parity, progress-log failures are controlled, typecheck/lint/build pass, and only the existing Vite >500 kB chunk warning remains. No `eslint.config.js` boundary change was made; Studio’s live 1440px visual check remains deferred.
