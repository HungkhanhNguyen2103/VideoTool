# Phase 5 Prompt 1 — Voiceover (TTS) + FFmpeg Render Engine (Design Brief)

Phase 4 is complete. Begin Phase 5: the video/render module.

This prompt is a **design brief only**. Commit a spec, then wait for review before implementation.

**Scope note:** Phase 5 is split into two prompts, same pattern as Phase 2. This prompt (Prompt 1) covers TTS voiceover generation and the FFmpeg render engine (the default, fully implemented). A later Prompt 2 will add Remotion as an alternative render engine. Design the `VideoRenderer` interface now so Prompt 2 can slot in without touching this prompt's code, but only implement the FFmpeg side in this prompt.

---

## 0. External prerequisites (not npm packages)

Two external services/binaries this module depends on. Document both clearly in `MODULE.md` as prerequisites, not dependencies this prompt installs:

1. **FFmpeg binary** must be installed on the machine and reachable via `FFMPEG_PATH` env var (fallback: `ffmpeg` on `PATH`). Same for `ffprobe` (`FFPROBE_PATH`, fallback `ffprobe` on PATH).
2. **VieNeu TTS server** — a separate Python FastAPI process the user runs locally. video-tool talks to it over plain HTTP; it is never started or managed by video-tool.

## 1. TTS server contract (reference implementation, already running)

```
POST {TTS_API_URL}
Content-Type: application/json

{
  "text": "...",
  "voice": "Truc Ly",
  "ref_audio_path": null,
  "ref_audio_text": null,
  "speed": 1.0,
  "temperature": 0.3
}
```

Response: raw audio bytes, `Content-Type: audio/wav`. On error: HTTP 4xx/5xx with `{ "detail": "..." }`.

Notes on server behavior (informs client design, do not reimplement server-side):
- The server holds one global async lock — it processes one request at a time. Concurrent requests from video-tool simply queue there. Do not build a client-side concurrency limiter; sequential calls are enough.
- `speed` range `[0.5, 2.0]`, `temperature` range `[0.05, 1.0]`.
- No streaming — one full request/response per utterance.

---

## 2. Environment variables — add to `.env.example`

```dotenv
TTS_API_URL=http://127.0.0.1:8000/api/tts
TTS_DEFAULT_VOICE=Truc Ly
TTS_TIMEOUT_MS=60000
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
```

`loadConfig` validates and exposes these; no secrets involved (this is a local HTTP endpoint, not an API key).

---

## 3. Data contracts

### Project fields — `src/contracts/project.ts`

```ts
export const RENDER_ENGINES = ['ffmpeg', 'remotion'] as const;
export type RenderEngine = (typeof RENDER_ENGINES)[number];
```

Add to `ProjectDocSchema` / `ProjectDetailSchema` / create-project request:

```ts
renderEngine: z.enum(RENDER_ENGINES).default('ffmpeg'),
voiceoverVoice: z.string().default('Truc Ly'),
renderFileId: z.string().nullable().default(null),  // final rendered video, set after full render
```

`renderEngine: 'remotion'` is accepted by the schema now (so the UI can show the option) but the FFmpeg-only implementation in this prompt throws a clear `AppError('RENDER_ENGINE_NOT_IMPLEMENTED', ...)` if a project with `renderEngine: 'remotion'` attempts to render. Document this limitation in `MODULE.md`.

### Scene fields — extend `SceneSchema` / `SceneDocSchema`

```ts
audioFileId: z.string().nullable().default(null),
```

`durationSec` (already present) becomes **authoritative render timing** for a scene once voiceover exists: after TTS succeeds for a scene, `durationSec` is overwritten with the actual audio duration + a small buffer (see §5). Scenes without voiceover keep whatever `durationSec` finalization assigned in Phase 3.

### File-store additions — `src/contracts/file.ts`

```ts
export const FILE_PURPOSES = ['reference', 'voiceover', 'render'] as const;
```

Add to `ALLOWED_MIME_TYPES`: `'audio/wav'`, `'audio/mpeg'`.

No new MongoDB collection. Voiceover audio and the final rendered video are both stored through the existing `file-store` module with these new `purpose` values.

---

## 4. Project-service additions

Extend the existing `patchProjectScene` method's patch type (from Phase 4) to also allow `audioFileId` and `durationSec`:

```ts
patchProjectScene(
  projectId: string,
  sceneId: string,
  patch: Partial<Pick<SceneDoc, 'visualPrompt' | 'assetType' | 'assetFileId' | 'audioFileId' | 'durationSec'>>,
): Promise<ProjectDetail>
```

Add a new method for the final render output:

```ts
setProjectRenderFile(
  projectId: string,
  renderFileId: string,
): Promise<ProjectDetail>
// Sets renderFileId and status: 'rendered' in one atomic write (same pattern as replaceProjectScenes with newStatus).
```

`video` module must not call `getCollection('projects')` directly — same ownership rule as every prior phase.

---

## 5. TTS client — `src/server/shared/tts/`

### `src/server/shared/tts/types.ts`

```ts
export type TtsOptions = {
  voice?: string;
  speed?: number;
  temperature?: number;
  refAudioPath?: string;
  refAudioText?: string;
};

export interface TtsClient {
  synthesize(text: string, opts?: TtsOptions): Promise<Buffer>; // raw WAV bytes
}
```

### `src/server/shared/tts/vieneu.ts`

- POST to `TTS_API_URL` with the JSON body from §1.
- Timeout via `AbortController` using `TTS_TIMEOUT_MS`.
- Retry once on failure (matching the reference client's `MAX_RETRIES = 2`), with a short fixed backoff (1.5s). Do not fall back to any Gradio path — that was legacy infrastructure this project does not have.
- Throw a mapped `AppError('TTS_REQUEST_FAILED', ..., 502)` after retries are exhausted.

### `src/server/shared/tts/mastering.ts`

Post-process the raw WAV through ffmpeg before storing, reproducing the reference filter chain:

```
highpass=f=75,
equalizer=f=100:width_type=h:width=50:g=2,
equalizer=f=3200:width_type=h:width=1000:g=2,
loudnorm=I=-16:TP=-1.5:LRA=11
```

Input and output via temp files in the OS temp dir (or `filesDir/tmp/`), cleaned up after. If ffmpeg mastering fails for any reason, log a warning and fall back to the unmastered buffer rather than failing the whole voiceover generation — mirrors the reference implementation's fault tolerance.

### `src/server/shared/tts/index.ts`

Export `TtsClient`, `TtsOptions`, `getTtsClient(): TtsClient` (singleton), `masterAudio(buffer: Buffer): Promise<Buffer>`.

### Duration measurement

Use `ffprobe` (via `FFPROBE_PATH`) to read the mastered audio's duration in seconds. Add a small fixed buffer: `AUDIO_BUFFER_SECONDS = 0.3` (matching the reference constant). Final scene `durationSec = Math.ceil(probedDuration + 0.3)`.

---

## 6. `src/server/modules/video/` — new domain module

`video` is already present in `eslint.config.js` `MODULES` with `ALLOWED: video -> [project, asset, job]`. No boundary changes needed.

### `src/server/modules/video/docs.ts`

FFmpeg command-building helpers and constants (extension/codec tables), no MongoDB schema (no new collection, same pattern as `asset`).

### `src/server/modules/video/tts-service.ts`

```ts
// Generates voiceover for one scene, stores via file-store (purpose 'voiceover'),
// and patches the scene's audioFileId + durationSec.
generateSceneVoiceover(
  projectId: string,
  sceneId: string,
  opts?: { voice?: string; speed?: number; temperature?: number },
): Promise<ChapterlessSceneResult>  // returns the updated SceneDoc

// Iterates all scenes in project order, calling generateSceneVoiceover for each,
// sequentially (the TTS server itself is single-threaded; do not parallelize).
generateProjectVoiceovers(
  projectId: string,
  appendLog: (message: string) => Promise<void>,
): Promise<void>
```

`generateProjectVoiceovers` logs progress per scene (`Generating voiceover for scene 3/40…`) and continues past a single scene's failure — log the error and mark that scene's `audioFileId` unchanged (null or previous value), rather than aborting the whole batch. Collect a summary of failed scene numbers and log it at the end.

### `src/server/modules/video/ffmpeg-renderer.ts`

```ts
export interface VideoRenderer {
  renderScenePreview(project: ProjectDetail, scene: SceneDoc): Promise<Buffer>; // short MP4, single scene
  renderFullVideo(project: ProjectDetail, appendLog: (msg: string) => Promise<void>): Promise<Buffer>; // full MP4
}

export class FfmpegRenderer implements VideoRenderer { ... }
```

Design the exact `ffmpeg`/`ffprobe` command construction in the spec commit (filter graph, concat strategy, codec choices) — this brief sets the requirements, not the literal command lines:

- Each scene becomes one video segment matching `project.renderSettings` (`width`, `height`, `fps`, aspect already exist on `ProjectDoc` since Phase 1).
- Image scenes (`assetType: 'image'`): loop the still image for the scene's `durationSec`.
- Video scenes (`assetType: 'video'`): use the stored video clip, trimmed or padded to `durationSec`.
- If `audioFileId` is set: mux the voiceover audio into the segment as its audio track (replacing/muting any audio in a video-type asset — narration is authoritative).
- If `audioFileId` is null: segment is silent (generate a silent audio track matching `durationSec` so concatenation stays uniform, or omit audio entirely if your concat approach tolerates mixed audio/no-audio segments — document whichever you choose and why).
- Concatenate all segments into the final output, in scene array order.
- `renderScenePreview` runs the same per-scene segment-building logic for exactly one scene and returns that segment directly (no concatenation).
- Use `fluent-ffmpeg` (new dependency, see §7) or direct `child_process.spawn` with argument arrays — Codex's choice, document the decision.
- Clean up all intermediate segment files (temp directory) after the final output is produced, success or failure.

### `src/server/modules/video/remotion-renderer.ts`

Stub only in this prompt:

```ts
export class RemotionRenderer implements VideoRenderer {
  async renderScenePreview(): Promise<Buffer> {
    throw new AppError('Remotion render engine is not yet implemented.', 501, 'RENDER_ENGINE_NOT_IMPLEMENTED');
  }
  async renderFullVideo(): Promise<Buffer> {
    throw new AppError('Remotion render engine is not yet implemented.', 501, 'RENDER_ENGINE_NOT_IMPLEMENTED');
  }
}
```

### `src/server/modules/video/index.ts`

```ts
export function getVideoRenderer(engine: RenderEngine): VideoRenderer;
```

Factory returns `FfmpegRenderer` or `RemotionRenderer` singleton.

### `src/server/modules/video/service.ts`

```ts
renderFullProject(projectId: string, appendLog: (msg: string) => Promise<void>): Promise<void>
```

Steps: load project, verify every scene has `assetFileId` set (throw `AppError('SCENES_NOT_READY', ..., 422)` listing which scene numbers are missing an asset, if any), call `getVideoRenderer(project.renderEngine).renderFullVideo(project, appendLog)`, store the resulting buffer via file-store (`purpose: 'render'`, infer `.mp4` extension), call `setProjectRenderFile(projectId, fileId)`.

```ts
renderScenePreviewBuffer(projectId: string, sceneId: string): Promise<Buffer>
```

Loads project/scene, calls the renderer, returns the buffer directly (no persistence — preview is ephemeral, streamed straight to the response).

---

## 7. New npm dependencies

```
npm install fluent-ffmpeg
npm install -D @types/fluent-ffmpeg
```

No TTS SDK needed (plain `fetch`). No Remotion packages in this prompt — those come in Prompt 2.

---

## 8. Worker job handlers — `src/worker/registry.ts`

Two new job types:

```ts
type GenerateVoiceoverPayload = { projectId: string };
type RenderVideoPayload = { projectId: string };
```

```ts
jobHandlers['generate-voiceover'] = async (job, context) => {
  if (await context.isCancelled()) return;
  await generateProjectVoiceovers(job.payload.projectId, context.appendLog);
};

jobHandlers['render-full-video'] = async (job, context) => {
  if (await context.isCancelled()) return;
  await renderFullProject(job.payload.projectId, context.appendLog);
};
```

Scene preview render is **not** a job — it is fast enough (single scene) to run synchronously within an HTTP request (see routes below). If implementation testing shows otherwise, flag it in the report rather than silently converting it to a job.

---

## 9. HTTP routes — `src/server/modules/video/routes.ts`

Mount at `/api/project` in `app.ts`.

- `POST /:id/scenes/generate-voiceover` — enqueue `generate-voiceover` job. Returns `201 { jobId }`.
- `POST /:id/scenes/:sceneId/regenerate-voiceover` — body `{ voice?, speed?, temperature? }` (all optional, fall back to project default voice / TTS defaults). Calls `generateSceneVoiceover` directly (no job — single scene, synchronous). Returns `200` updated `ProjectDetail`.
- `GET /:id/scenes/:sceneId/render-preview` — calls `renderScenePreviewBuffer`, streams the MP4 buffer directly with `Content-Type: video/mp4` (no persistence, no file-store write). This is a `GET` (not POST) so the client can point a `<video src>` at it directly if useful, but document that repeated `GET`s re-render every time (no caching) — acceptable for a preview endpoint.
- `POST /:id/render` — verify scenes are asset-ready (or let the service throw `SCENES_NOT_READY`), enqueue `render-full-video` job. Returns `201 { jobId }`.

All routes validate `req.params`/`req.body` with Zod and stay thin — no direct Mongo access, no direct ffmpeg calls in route handlers.

---

## 10. Client — Studio page additions

Extend the existing `StudioPage` (Phase 4) rather than creating a new page — voiceover and render are the next steps in the same per-scene workflow.

- **Header actions:** "Generate All Voiceovers" (enqueues job, shows `useJobProgress` bar + logs), "Render Full Video" (enqueues job, shows progress; on completion, shows a download/preview link to the rendered file via file-store's `storedPath`), render-engine indicator (read-only badge for now — `renderEngine` is set at project creation, no runtime switch UI in this prompt unless trivial to add; if trivial, add a disabled "Remotion (coming soon)" option next to "FFmpeg").
- **Per-scene card additions:** audio waveform/player if `audioFileId` is set (`<audio src="/files/{storedPath}">`, resolved the same way asset previews are in Phase 4), "Regenerate voiceover" button (synchronous call, shows a spinner), "Preview render" button that calls the `GET render-preview` endpoint and plays the returned video inline (use a `Blob`/object URL from the fetch response, since this is a streamed response, not a static file).
- Disable "Render Full Video" until every scene has `assetFileId` set; show which scenes are missing if disabled (reuse the `SCENES_NOT_READY` error detail if the route already reports it, or compute client-side from the loaded project).

---

## 11. Tests — `src/server/modules/video/video.test.ts`

Mock the TTS HTTP call (do not hit a real server) and mock/stub ffmpeg execution where feasible — if `ffmpeg`/`ffprobe` binaries are unavailable in the test/CI environment, design tests so the ffmpeg-dependent paths are either skipped with a clear documented reason (same fallback pattern used for `mongodb-memory-server` in earlier phases) or exercised against tiny generated fixtures (e.g., a 1-frame PNG + `ffmpeg -f lavfi` generated silence) only if the binary is confirmed present at test time.

Cover at minimum (whatever is feasible given ffmpeg/ffprobe availability):
- `generateSceneVoiceover`: stores file with purpose `voiceover`, updates `audioFileId` and `durationSec` (mocked TTS response + mocked/real ffprobe).
- `generateProjectVoiceovers`: continues past one scene's failure, logs correctly, does not abort the batch.
- `TtsClient` retry behavior on a simulated failure then success.
- `renderFullProject`: throws `SCENES_NOT_READY` when a scene lacks `assetFileId`.
- `getVideoRenderer('remotion')` methods throw `RENDER_ENGINE_NOT_IMPLEMENTED`.
- Route: `POST /generate-voiceover` → `201 { jobId }`.
- Route: `POST /:sceneId/regenerate-voiceover` → `200` updated scene.
- Route: `POST /render` with an unready project → 422 `SCENES_NOT_READY`.
- Worker registry: both job types registered and adapt payload/context correctly.

Document explicitly in `MODULE.md` and the acceptance report which ffmpeg-dependent behaviors were verified against the real binary versus left as documented gaps, so this is never silently assumed to be fully covered.

---

## 12. `src/server/modules/video/MODULE.md`

Cover: purpose, external prerequisites (ffmpeg/ffprobe binaries, VieNeu TTS server) and how to configure them, the `VideoRenderer` interface and why Remotion is stubbed, the FFmpeg filter graph/concat strategy actually implemented, audio mastering filter chain, the `AUDIO_BUFFER_SECONDS` convention, known gaps (no waveform trimming UI, no partial re-render of only changed scenes, no cleanup of superseded `renderFileId` on re-render).

---

## 13. Commit discipline

Same rules as every prior phase: `AGENTS.md` + `MODULE.md` updated per meaningful commit, no `git add -A`, no push.

Suggested order:
1. `feat(contracts): add renderEngine, voiceoverVoice, audioFileId, renderFileId`
2. `feat(project): add setProjectRenderFile, extend patchProjectScene`
3. `feat(tts): add VieNeu client and audio mastering`
4. `feat(video): add FFmpeg renderer and Remotion stub`
5. `feat(video): add voiceover/render service and job handlers`
6. `feat(video): add routes and app wiring`
7. `feat(video): add tests`
8. `feat(client): add voiceover and render controls to StudioPage`
9. `docs(phase5): record video module acceptance (prompt 1)`

---

## 14. Review questions before planning

1. Is throwing `RENDER_ENGINE_NOT_IMPLEMENTED` for `remotion` (rather than rejecting it at the schema level) the right way to keep the field forward-compatible for Prompt 2?
2. For scenes with no voiceover (`audioFileId: null`), should the render include a silent audio track for concat uniformity, or should Codex's spec propose a different concat strategy that tolerates mixed audio presence? State the chosen approach and why.
3. Is synchronous (non-job) single-scene voiceover regeneration and preview render the right call, given the TTS server's single-threaded lock could make a regen wait behind an in-progress batch job with no visible queue position to the user? Should the route instead return a "busy, try again" response if the lock is likely held, or is a plain wait acceptable?
4. Should `fluent-ffmpeg` or raw `child_process.spawn` be used for command construction — your call, but state the reasoning in the spec.

---

## 15. Out of scope for this prompt

- Remotion renderer implementation (Prompt 2).
- Runtime render-engine switch in the UI beyond a disabled placeholder.
- Deleting/GC of superseded `renderFileId` when a project is re-rendered.
- Background music, subtitles/captions, transitions between scenes.
- Voice cloning (`ref_audio_path`/`ref_audio_text`) exposed in the UI — the client/server plumbing may pass these through if trivial, but no UI for uploading a reference clip in this prompt.
- Do not push.

---

## 16. Report format

When done:
1. Checklist of each section.
2. Commits with hashes.
3. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
4. Confirm whether `ffmpeg`/`ffprobe` binaries were available in this environment during verification, and exactly which tests ran for real versus were skipped/documented as a gap.
5. Decisions made outside this spec.
6. Blockers or open questions.
7. Confirm ready for Phase 5 Prompt 2 (Remotion engine).
