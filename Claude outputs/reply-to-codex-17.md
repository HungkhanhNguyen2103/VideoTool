# Phase 5 Prompt 1 — Addendum: SFX + BGM (read before committing the spec)

If the spec commit from the previous brief is already in progress, fold this in before committing — do not commit the spec without this section, and do not commit two separate specs for one prompt. If the spec is already committed, treat this as a required amendment to that same spec file (append/revise it, one commit).

This adds two more audio layers on top of the TTS voiceover already designed: per-scene **sound effects (SFX)** and project-wide **background music (BGM)**, both sourced from Freesound.org. This changes the FFmpeg audio-mixing requirements in §6 of the original brief — read the mixing rules below carefully, they supersede the "voiceover only" assumption.

---

## A. New environment variable

```dotenv
FREESOUND_API_KEY=
```

Empty placeholder, same convention as `DEEPSEEK_API_KEY`/`ANTHROPIC_API_KEY`. No key required at import time; a missing key only fails when SFX/BGM generation is actually attempted (warn, don't throw).

## B. New scene field — extend `SceneSchema`/`SceneDocSchema`

```ts
sfxPrompt: z.string().default(''),        // free text, e.g. "tiếng tích tắc đồng hồ, tiếng gió"
sfxFileId: z.string().nullable().default(null),
```

`sfxPrompt` is user-editable in the Studio page, same pattern as `visualPrompt` (edit/save via `patchProjectScene`, extend its Pick type again to include `sfxPrompt` and `sfxFileId`).

## C. New project fields — extend `ProjectDocSchema`/`ProjectDetailSchema`

```ts
bgmMood: z.string().default(''),          // e.g. "epic cinematic dramatic"
bgmFileId: z.string().nullable().default(null),
```

## D. File-store purposes — extend `FILE_PURPOSES`

```ts
export const FILE_PURPOSES = ['reference', 'voiceover', 'sfx', 'bgm', 'render'] as const;
```

Add `'audio/mpeg'` to `ALLOWED_MIME_TYPES` if not already added by the voiceover section (Freesound previews are MP3, not WAV).

**No shared cross-project SFX cache in this phase.** The reference implementation cached SFX/BGM in a shared directory across all projects/histories to avoid re-downloading the same sound. Phase 5 stores every SFX/BGM download through `file-store`, scoped to its own project like every other file — accept the minor inefficiency of occasionally re-downloading the same clip for a different project rather than breaking the per-project file model. If Codex sees a clean way to add a cache later without violating file-store's ownership, note it as a future improvement in `MODULE.md`, but do not implement it now.

## E. New shared client — `src/server/shared/freesound/`

### `src/server/shared/freesound/keyword-map.ts`

Port the Vietnamese→English keyword dictionary and `normalizeKeyword`/`extractSearchQueries` logic from the reference `sfxService.ts` verbatim (the mapping table, the `tiếng` prefix stripping, the `sfx|sound effect|sound|value` filter, the multi-query fallback list). This is domain data, not something to redesign.

### `src/server/shared/freesound/client.ts`

```ts
export interface FreesoundClient {
  // Returns the downloaded audio buffer, or null if no match / no API key / on any failure.
  // Never throws — SFX/BGM are enhancements, a miss should not fail scene/project processing.
  searchAndDownloadSfx(prompt: string): Promise<Buffer | null>;
  searchAndDownloadBgm(mood: string): Promise<Buffer | null>;
}
```

- `searchAndDownloadSfx`: run `extractSearchQueries(prompt)`, try each query against `GET https://freesound.org/apiv2/search/text/` with `filter: license:"Creative Commons 0" duration:[0.3 TO 8.0]`, `sort: rating_desc`, `page_size: 1`, stop at the first hit, download `previews["preview-hq-mp3"] ?? previews["preview-lq-mp3"]`, return the buffer.
- `searchAndDownloadBgm`: single query `"{mood} ambient cinematic music"`, `filter: duration:[30.0 TO 240.0]`, same sort/fields, download the same way.
- Both: empty/missing prompt, missing `FREESOUND_API_KEY`, no search results, or a download failure all return `null` with a logged warning — never throw up into the caller.
- Use `fetch`, not `axios` (no new dependency; the reference implementation used axios, but this repo has no axios dependency yet and `fetch` covers this use case — do not add axios).

### `src/server/shared/freesound/index.ts`

Export `FreesoundClient`, `getFreesoundClient(): FreesoundClient`.

## F. Service additions — `src/server/modules/video/`

```ts
// Generates SFX for one scene from its sfxPrompt, stores via file-store (purpose 'sfx'),
// patches sfxFileId. No-op (logs and returns) if sfxPrompt is empty or the search misses.
generateSceneSfx(projectId: string, sceneId: string): Promise<void>

// Generates project BGM from bgmMood, stores via file-store (purpose 'bgm'), patches bgmFileId.
generateProjectBgm(projectId: string, mood: string): Promise<void>
```

Both are synchronous (fast HTTP search + download, no job needed — same reasoning as single-scene voiceover regen).

## G. Routes — add to `src/server/modules/video/routes.ts`

- `POST /:id/scenes/:sceneId/generate-sfx` — no body needed (uses the scene's current `sfxPrompt`). Returns `200` updated `ProjectDetail`.
- `POST /:id/generate-bgm` — body `{ mood: string }`. Returns `200` updated `ProjectDetail`.

## H. FFmpeg mixing rules — supersedes §6 of the original brief

Per-scene segment audio, in mixing order:

1. **Voiceover** (`audioFileId`) is the primary track, at full/unmodified volume, driving `durationSec` as before.
2. **SFX** (`sfxFileId`), if present: mixed in under the voiceover for that scene only, starting at the scene's start, at a reduced volume (target roughly -10dB relative to voiceover — pick a concrete `volume=` filter value and document it in `MODULE.md`). If the SFX clip is shorter than the scene, it plays once and silence fills the rest (do not loop SFX). If longer, trim it to `durationSec`.
3. If neither `audioFileId` nor `sfxFileId` is present, the scene segment has no audio track (or a silent one, per whatever concat approach the original brief's review question #2 settled on).

After all scene segments are concatenated into the full-length track:

4. **BGM** (`bgmFileId`), if present on the project: loop (or trim, if already longer) to match the exact final video duration, mixed under the entire concatenated voiceover+SFX track at a further reduced, constant volume (target roughly -20dB — pick a concrete value, document it). No auto-ducking/sidechain compression in this phase — a fixed low BGM volume is acceptable; note auto-ducking as a future improvement in `MODULE.md` if you think it's worth flagging.

Document the exact `ffmpeg` filter graph used for this three-layer mix (`amix`, `volume`, `aloop`/`-stream_loop`, whichever you choose) in `MODULE.md` so the mixing behavior is inspectable without reading the command-builder source.

## I. Studio UI additions

- Per-scene card: `sfxPrompt` text field (same edit/save pattern as `visualPrompt`), "Generate SFX" button, small audio player for the result if `sfxFileId` is set.
- Project header: `bgmMood` text field, "Generate BGM" button, audio player for the result if `bgmFileId` is set.

## J. Tests

Mock the Freesound HTTP calls (no real network calls in tests, no API key required to run the suite). Cover:

- `extractSearchQueries`/`normalizeKeyword`: at least the VI→EN mapping cases already in the reference dictionary, plus the generic fallback cleaning path.
- `generateSceneSfx`: stores file, updates `sfxFileId`, on a mocked "no results" response leaves `sfxFileId` unchanged and does not throw.
- `generateProjectBgm`: same no-throw-on-miss behavior.
- Missing `FREESOUND_API_KEY`: client returns `null` without attempting a request.
- Route tests for both new endpoints (success + graceful no-op-on-miss case).

## K. Out of scope (still, even with this addendum)

- Auto-ducking/sidechain compression for BGM under dialogue.
- A shared cross-project SFX cache.
- Any UI for browsing/choosing among multiple Freesound search results — always take the first hit.
- Uploading a user-supplied BGM/SFX file directly (only Freesound search in this prompt; a manual upload path could reuse file-store later if wanted).

---

Everything else in the original Phase 5 Prompt 1 brief (TTS, FFmpeg renderer skeleton, Remotion stub, job/route structure, commit discipline, review questions) stands as written. Commit one spec covering both the original brief and this addendum together.
