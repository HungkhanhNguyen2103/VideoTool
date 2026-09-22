# Phase 5 Prompt 1 — Video/Render Design Specification

**Date:** 2026-09-22  
**Status:** Design only; implementation is intentionally blocked until review.  
**Sources:** Phase 5 Prompt 1 — Voiceover (TTS) + FFmpeg Render Engine, plus the required SFX/BGM addendum.

## Goal

Add the first video module after asset import: sequential VieNeu voiceover generation, per-scene SFX and project BGM from Freesound.org, an FFmpeg renderer, render jobs/routes, and the Studio controls that expose the workflow. The render engine is selected by a forward-compatible project field. FFmpeg is fully implemented in this prompt; Remotion is a typed stub reserved for Prompt 2.

The module keeps the existing one-way ownership model: `project` owns project and scene writes, `file-store` owns files and disk paths, `job` owns queue state, and `video` orchestrates TTS, Freesound, and rendering. No new MongoDB collection is introduced.

## Non-goals

- Remotion implementation; only its `VideoRenderer` stub and factory branch are added.
- Auto-ducking/sidechain compression, waveform trimming UI, scene transitions, subtitles, or partial re-rendering.
- A shared cross-project Freesound cache. Every downloaded SFX/BGM file is stored under its project through `file-store`.
- Uploading user-supplied BGM/SFX files; the new audio generation endpoints use Freesound only.
- Voice cloning UI (`ref_audio_path`/`ref_audio_text`) or a client render-engine switch.
- Garbage collection of superseded voiceover, SFX, BGM, or render files.

## Existing-repo baseline and boundaries

- `project` owns the `projects` collection and all scene/project writes. `video` calls its public index only; it never imports `project/repo` or calls `getCollection('projects')`.
- `file-store` owns the `files` collection and generated relative paths. It is shared infrastructure outside the module boundary list, as in Phase 4.
- `job` is the generic queue; heavy project-wide voiceover and rendering run through jobs. Single-scene voiceover regeneration and preview rendering remain synchronous.
- `worker/registry.ts` is the only place that registers the new job types.
- `StudioPage` is the existing asset page and is extended rather than replaced.

## Decisions for the review questions

1. **Forward compatibility:** `renderEngine: 'remotion'` is accepted by contracts and persisted. `getVideoRenderer('remotion')` returns a `RemotionRenderer`, whose methods throw `AppError('Remotion render engine is not yet implemented.', 501, 'RENDER_ENGINE_NOT_IMPLEMENTED')`. Rejecting it at schema validation would make Prompt 2 require a data migration.
2. **Silent audio:** every scene segment contains a stereo 48 kHz silent audio track when it has no voiceover or SFX. This gives the concat demuxer uniform streams and avoids mixed audio/no-audio edge cases. A scene with SFX but no voiceover mixes SFX under the same fixed reduced level against the generated silence.
3. **Synchronous single-scene work:** regeneration and preview wait for the TTS/FFmpeg request to finish. VieNeu already serializes requests; adding a second client-side queue or a speculative “busy” response would make the API less deterministic. The project-wide operations expose progress through jobs and SSE. Preview GETs intentionally re-render and do not cache.
4. **FFmpeg invocation:** use raw `child_process.spawn` with argument arrays. This avoids an additional runtime wrapper, keeps Windows executable selection (`FFMPEG_PATH`/`FFPROBE_PATH`) explicit, and makes the exact filter graph testable as pure argument data. No `fluent-ffmpeg` dependency is added.

## Configuration and external prerequisites

Add to `.env.example` and `loadConfig`:

```dotenv
TTS_API_URL=http://127.0.0.1:8000/api/tts
TTS_DEFAULT_VOICE=Truc Ly
TTS_TIMEOUT_MS=60000
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
FREESOUND_API_KEY=
```

`FREESOUND_API_KEY` is intentionally empty by default. Missing keys only disable SFX/BGM generation at call time and produce a warning; startup does not fail. The TTS endpoint is a separately managed VieNeu FastAPI process. FFmpeg and ffprobe must be installed and available through the configured executable paths or `PATH`; this phase does not install or manage either binary.

## Contracts and file-store extensions

### Project and scene contracts

Extend `src/contracts/project.ts` and the server-owned `ProjectDocSchema`/`SceneDocSchema` with schema defaults:

```ts
export const RENDER_ENGINES = ['ffmpeg', 'remotion'] as const;
export type RenderEngine = (typeof RENDER_ENGINES)[number];

// project fields
renderEngine: z.enum(RENDER_ENGINES).default('ffmpeg'),
voiceoverVoice: z.string().default('Truc Ly'),
renderFileId: z.string().nullable().default(null),
bgmMood: z.string().default(''),
bgmFileId: z.string().nullable().default(null),

// scene fields
audioFileId: z.string().nullable().default(null),
sfxPrompt: z.string().default(''),
sfxFileId: z.string().nullable().default(null),
```

Legacy project/scene documents receive defaults through the existing schema parse path; no migration is required. `durationSec` remains the authored timing until a voiceover is generated, after which it is replaced with `ceil(ffprobeDuration + 0.3)`.

### File purposes and safe path resolution

Extend `FILE_PURPOSES` to `reference | voiceover | sfx | bgm | render` and allow `audio/wav`, `audio/mpeg`, and the existing image/video/document MIME types. `FileDocSchema`, `StoreFileParams`, `FileSummarySchema`, and file-store routes/services all use the shared enum.

Add a public file-store service method such as:

```ts
resolveFilePath(projectId: string, fileId: string): Promise<{
  absolutePath: string;
  mimeType: string;
  purpose: FilePurpose;
}>;
```

It verifies that the file exists and belongs to the project, then joins the generated `storedPath` to the configured files directory. Video code uses this public method instead of querying `files` directly or reconstructing a path from an untrusted ID. The generated basename remains the only persisted path vocabulary.

Extend the public project service with:

```ts
patchProjectScene(
  projectId: string,
  sceneId: string,
  patch: Partial<Pick<SceneDoc,
    'visualPrompt' | 'assetType' | 'assetFileId' |
    'audioFileId' | 'durationSec' | 'sfxPrompt' | 'sfxFileId'>>,
): Promise<ProjectDetail>;

setProjectBgm(projectId: string, mood: string, bgmFileId: string | null): Promise<ProjectDetail>;
setProjectRenderFile(projectId: string, renderFileId: string): Promise<ProjectDetail>;
```

`setProjectBgm` writes the current mood and file reference together. `setProjectRenderFile` writes `renderFileId` and `status: 'rendered'` in one `$set` plus one version increment. Both preserve project ownership and atomicity.

## Shared TTS client

Create `src/server/shared/tts/`:

- `types.ts`: `TtsOptions` and `TtsClient` (`synthesize(text, opts?) -> Buffer`).
- `vieneu.ts`: POST JSON `{ text, voice, ref_audio_path, ref_audio_text, speed, temperature }` to `TTS_API_URL` with an `AbortController` timeout. Retry once after a fixed 1.5 s backoff. Exhaustion maps to `AppError('TTS_REQUEST_FAILED', ..., 502)`.
- `mastering.ts`: write temporary WAV input/output, run FFmpeg with `highpass=f=75,equalizer=f=100:width_type=h:width=50:g=2,equalizer=f=3200:width_type=h:width=1000:g=2,loudnorm=I=-16:TP=-1.5:LRA=11`, clean temporary files in `finally`, and return the original buffer with a warning if mastering fails.
- `index.ts`: export the types, `getTtsClient()`, and `masterAudio()`.

Duration is measured with `FFPROBE_PATH` using a duration query against the mastered WAV. `AUDIO_BUFFER_SECONDS = 0.3`; the stored scene duration is `Math.ceil(duration + 0.3)`.

## Shared Freesound client

Create `src/server/shared/freesound/`:

- `keyword-map.ts` ports the reference Vietnamese-to-English mapping, `tiếng` prefix stripping, `sfx|sound effect|sound|value` filtering, normalization, and multi-query fallback list verbatim.
- `client.ts` implements `FreesoundClient` with `fetch`, never throwing for missing keys, empty prompts, no hits, HTTP failures, malformed responses, or download failures. SFX queries use `GET https://freesound.org/apiv2/search/text/` with `filter=license:"Creative Commons 0" duration:[0.3 TO 8.0]`, `sort=rating_desc`, `page_size=1`; BGM uses `"{mood} ambient cinematic music"` and `duration:[30.0 TO 240.0]`. The first result's `preview-hq-mp3` or `preview-lq-mp3` is downloaded.
- `index.ts` exports `FreesoundClient` and `getFreesoundClient()`.

No cross-project cache is implemented. A future cache can be considered only if it preserves file-store ownership.

## Video module architecture

Planned files under `src/server/modules/video/`:

- `docs.ts`: codec/extension constants, `AUDIO_BUFFER_SECONDS`, pure FFmpeg argument/filter builders, and job payload schemas.
- `tts-service.ts`: `generateSceneVoiceover` and sequential `generateProjectVoiceovers`.
- `ffmpeg-renderer.ts`: `VideoRenderer` interface and `FfmpegRenderer`.
- `remotion-renderer.ts`: `RemotionRenderer` stub only.
- `service.ts`: `renderFullProject` and `renderScenePreviewBuffer` orchestration.
- `routes.ts`, `index.ts`, `video.test.ts`, and `MODULE.md`.

### Voiceover and SFX/BGM services

`generateSceneVoiceover` loads the project/scene, synthesizes narration using the scene/project voice settings, masters and probes the audio, stores it through file-store with purpose `voiceover`, then patches `audioFileId` and authoritative `durationSec`. A failed regeneration leaves any previous audio reference and duration unchanged.

`generateProjectVoiceovers` iterates scenes in array order, sequentially. It logs `Generating voiceover for scene N/M…`, catches individual failures, logs the error, continues, and emits a final failed-scene summary. It never clears a previous successful reference because another scene failed.

`generateSceneSfx` no-ops with a log when `sfxPrompt` is empty or Freesound returns `null`; otherwise it stores the MP3 with purpose `sfx` and patches `sfxFileId`. `generateProjectBgm` follows the same no-throw-on-miss rule, stores purpose `bgm`, and atomically updates `bgmMood` plus `bgmFileId`.

### Renderer interface and FFmpeg strategy

```ts
export interface VideoRenderer {
  renderScenePreview(project: ProjectDetail, scene: SceneDoc): Promise<Buffer>;
  renderFullVideo(project: ProjectDetail, appendLog: (msg: string) => Promise<void>): Promise<Buffer>;
}
```

`FfmpegRenderer` resolves every asset/audio path through file-store and creates a temporary directory. It always produces uniform H.264/AAC scene segments at the project's width, height, and FPS, then concatenates them in scene order with the concat demuxer. All intermediates are removed in `finally`.

For an image input, FFmpeg loops the still image. For a video input, it trims/pads to `durationSec`. The video filter is:

```text
scale=W:H:force_original_aspect_ratio=decrease,
pad=W:H:(ow-iw)/2:(oh-ih)/2:color=black,
fps=FPS,format=yuv420p,setsar=1
```

Each segment always has a stereo 48 kHz audio stream. Missing voiceover is an `anullsrc`; missing SFX is also a silent input. The concrete per-scene filter graph is:

```text
[voice]aformat=sample_rates=48000:channel_layouts=stereo,
  atrim=0:D,apad=whole_dur=D[voiceD];
[sfx]aformat=sample_rates=48000:channel_layouts=stereo,
  atrim=0:D,apad=whole_dur=D,volume=0.31622777[sfxD];
[voiceD][sfxD]amix=inputs=2:duration=first:dropout_transition=0[sceneA]
```

`D` is the scene duration and `0.31622777` is approximately -10 dB. SFX is played once, trimmed when longer, and padded with silence when shorter. The scene command maps the filtered video and `[sceneA]`, encodes `libx264` + `aac`, and uses `-t D`/`-shortest` so each segment is exactly its scene duration.

After concat, if `bgmFileId` exists, a second FFmpeg pass mixes the project-wide music:

```text
[1:a]aloop=loop=-1:size=2e+09,atrim=0:TOTAL,
  apad=whole_dur=TOTAL,volume=0.1[bgmD];
[0:a][bgmD]amix=inputs=2:duration=first:dropout_transition=0[fullA]
```

`0.1` is exactly -20 dB. The final command maps the concatenated video unchanged, maps `[fullA]`, encodes AAC, and limits output to `TOTAL`. There is no sidechain/auto-ducking. `renderScenePreview` uses the same scene graph but excludes project BGM because a preview represents one scene; it returns the MP4 buffer without persistence.

`RemotionRenderer` implements the same interface and throws the explicit 501 error for both methods.

### Render orchestration

`renderFullProject` loads the project and rejects missing scene assets with `AppError('SCENES_NOT_READY', ..., 422)`, including one-based scene numbers. It selects the renderer from `project.renderEngine`, renders, stores the resulting MP4 through file-store with purpose `render`, and calls `setProjectRenderFile` for the atomic `renderFileId` + `rendered` update. `renderScenePreviewBuffer` validates the scene and returns the ephemeral renderer buffer.

## Worker and HTTP API

Register these handlers in `src/worker/registry.ts`:

- `generate-voiceover`, payload `{ projectId }`: return immediately if cancelled, then call `generateProjectVoiceovers(projectId, context.appendLog)`.
- `render-full-video`, payload `{ projectId }`: return immediately if cancelled, then call `renderFullProject(projectId, context.appendLog)`.

Create `createVideoRouter({ enqueueJob })` and mount it at `/api/project`:

- `POST /:id/scenes/generate-voiceover` → enqueue and return `201 { jobId }`.
- `POST /:id/scenes/:sceneId/regenerate-voiceover` → validate optional voice/speed/temperature and return updated project after synchronous generation.
- `GET /:id/scenes/:sceneId/render-preview` → render and stream `video/mp4`; repeated GETs re-render and are intentionally uncached.
- `POST /:id/generate-bgm` → validate `{ mood: string }`, generate synchronously, return updated project (a miss is a successful no-op with unchanged `bgmFileId`).
- `POST /:id/render` → validate readiness and enqueue `render-full-video`, returning `201 { jobId }`.

All handlers validate params/body with Zod and contain no direct MongoDB or FFmpeg logic.

## Studio client

Extend `src/client/features/asset/StudioPage.tsx` and its API/types:

- Add a project-level `bgmMood` field, Generate BGM button, and `<audio>` player when `bgmFileId` resolves in the file list.
- Add per-scene `sfxPrompt` editing, Generate SFX button, and `<audio>` player for `sfxFileId`.
- Add Generate All Voiceovers, `useJobProgress` progress/log display, and refresh project/files when the job completes or fails.
- Add synchronous Regenerate Voiceover controls per scene.
- Add Preview Render, consuming the streamed MP4 as a Blob/object URL and revoking it on replacement/unmount.
- Add Render Full Video, disabled until all scenes have `assetFileId`; display missing scene numbers. On job completion, show the stored render file as a preview/download link.
- Show a read-only FFmpeg badge and a disabled Remotion-coming-soon option.

No client code imports server modules or filesystem paths; all previews resolve through validated `FileSummary.storedPath`.

## Verification strategy

Use `mongodb-memory-server` and isolated temporary directories. Mock all TTS/Freesound HTTP calls; no network key is needed. Test pure FFmpeg argument/filter builders regardless of binary availability. When ffmpeg/ffprobe are unavailable, skip only binary-dependent tests with an explicit reason recorded in `MODULE.md` and the acceptance report; do not silently claim full render coverage. If binaries are available, run a tiny generated fixture through the real path.

Minimum coverage:

- Legacy project/scene defaults and file-purpose/MIME schemas.
- Vietnamese keyword normalization/query fallbacks and Freesound missing-key/no-result behavior.
- TTS retry-once, timeout/error mapping, mastering fallback, and duration buffer calculation.
- Voiceover storage/scene patching; project voiceover continuation after one failure.
- SFX/BGM storage, atomic project updates, and no-op-on-miss behavior.
- `renderFullProject` `SCENES_NOT_READY`, renderer factory, Remotion 501 errors, and pure FFmpeg filter/argument builders.
- Route success/no-op/error cases for voiceover, SFX, BGM, preview, and render enqueue.
- Worker registry payload/context adaptation for both new job types.

Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. Keep `eslint.config.js` boundary rules unchanged.

## Documentation and commit discipline

`src/server/modules/video/MODULE.md` must document the external FFmpeg/ffprobe and VieNeu prerequisites, renderer interface, Remotion limitation, exact filter graphs and volume constants, audio mastering, `AUDIO_BUFFER_SECONDS`, synchronous preview behavior, and deferred cleanup/ducking gaps. `AGENTS.md` Status is updated in the same commit as each meaningful implementation change. Stage only files with real content changes; never push.

Suggested implementation commits after spec approval:

1. `feat(contracts): add render, voiceover, sfx and bgm fields`
2. `feat(project): add render/audio mutation APIs`
3. `feat(file-store): support audio/render purposes and safe paths`
4. `feat(tts): add VieNeu client, mastering and probe helpers`
5. `feat(freesound): add keyword mapping and resilient client`
6. `feat(video): add FFmpeg renderer and Remotion stub`
7. `feat(video): add voiceover, SFX/BGM and render services`
8. `feat(video): add routes, worker handlers and app wiring`
9. `feat(video): add tests`
10. `feat(client): add voiceover, SFX/BGM and render controls`
11. `docs(phase5): record video module acceptance`

Implementation remains blocked until this combined spec is reviewed and approved.
