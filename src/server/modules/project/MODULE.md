# Module: project

**Purpose:** Project CRUD and the scene model (scenes are embedded in the project document); optimistic locking via version.
**Owns collection(s):** projects
**May import (via their index.ts only):** none
**Public API:** only what `index.ts` exports. Nothing else in this module may be imported from outside.

## Invariants
- `_id` is a ULID string, never an ObjectId.
- `titleSearch` is always `normalizeTitle(title)` (title-search.ts): NFD, strip diacritics, `đ`->`d`, lowercase. Kept in sync on create and duplicate; if `title` is ever updated in place, `titleSearch` must be recomputed in the same write.
- `status` starts at `draft` on create. `duplicateProject` clears scene asset references because files are not copied, maps `rendered` -> `assets` (a copy has no video file), and copies every other status as-is.
- `scenesCount`/`durationSec` in `ProjectSummary` are never stored; they are computed from `scenes` at query time (`repo.listProjectSummaries`), and are `null` when `scenes` is empty.
- `version` starts at 1 on create and on duplicate (a duplicate is a new document, not a revision), then increments on every scene/chapter mutation. Scene asset metadata defaults to `assetType: 'image'` and `assetFileId: null` when legacy documents are read.
- Scene asset mutations are public service APIs: `patchProjectScene` targets one scene, `setProjectScenesAssetType` updates all scenes, and `applySceneAssets` applies deduplicated file references in one atomic update.
- `applyEmptySceneVisualPrompts` keeps its `ProjectDetail` return contract and delegates to `applyEmptySceneVisualPromptsWithResult`. The companion is the sole atomic writer for AI visual prompts: it validates scene IDs, keeps the last submitted prompt per ID, and updates only scenes whose `visualPrompt` is still empty. A single `findOneAndUpdate` returns the pre-image used to identify exactly which scene IDs changed. The top-level empty-target predicate and per-target array filters let concurrent manual edits win; a batch with no eligible target returns an empty ID list and leaves `version` unchanged. The existing scene schema already stores `visualPrompt`, so no migration is needed.
- Scene schema defaults now also include `audioFileId: null`, `sfxPrompt: ''`, and `sfxFileId: null`; project defaults include `renderEngine: 'ffmpeg'`, `voiceoverVoice: 'Truc Ly'`, `renderFileId: null`, `bgmMood: ''`, and `bgmFileId: null`.
- Duplicating a project never carries `assetFileId`, `audioFileId`, or `sfxFileId` scene references, and clears project `bgmFileId`/`renderFileId`; prompts, mood, and render settings remain. File metadata and disk files remain owned by the source project.
- `setProjectBgm` atomically updates `bgmMood` and `bgmFileId`; `setProjectRenderFile` atomically updates `renderFileId` and `status: 'rendered'`. Both increment `version` once.
- `setProjectRenderEngine` atomically updates the engine selection and increments `version` once; consumers call it through the public module index.
- Delete is a hard delete (`repo.deleteProjectById`); `// TODO(phase-4)` marks where asset/render file cleanup will be added.

## Flow
- `POST /api/project` -> `routes.ts` parses the body with `CreateProjectRequestSchema` (validation + Vietnamese messages live in `contracts/project.ts`, copied from `docs/prototypes/khoi-tao-du-an/app.js`) -> `service.createProject` builds the `ProjectDoc` and inserts it -> `service.toDetail` shapes the response (`ProjectDetail`, dates as ISO strings).
- `GET /api/project` -> `ListProjectsQuerySchema` (optional `q`, `status`) -> `repo.listProjectSummaries` runs an aggregation: `$match` (status + accent-insensitive `titleSearch` regex, query escaped by `escapeRegex`), `$sort` by `updatedAt desc`, `$limit` 200, `$project` computing `scenesCount`/`durationSec`.
- `GET /api/project/:id` -> `service.getProject` -> `NotFound` (404) if missing.
- `POST /api/project/:id/duplicate` -> `service.duplicateProject`: loads the source doc, clones it under a new id/title/timestamps, clears scene asset references, resets `version`, and applies the `rendered -> assets` status rule.
- `DELETE /api/project/:id` -> `service.deleteProject` -> `NotFound` (404) if nothing was deleted.

## Known pitfalls
- `contracts/project.ts` validates the whole payload in one `superRefine` so each field surfaces exactly one Vietnamese message (matching the prototype's `validate()`), instead of zod's default per-check messages; don't add plain `.min()/.max()` messages on those fields; they should be silently added to the same `superRefine`.
- `escapeRegex` is required on every user-supplied `q` before building the `$regex` filter; skipping it would let a search string break out of the intended match (ReDoS/incorrect matches).
- No automated tests were written for this module in Phase 1 (by explicit request); it has been checked with `npm run typecheck`, `npm run lint`, and throwaway scripts for `CreateProjectRequestSchema` and `title-search.ts`. The live MongoDB endpoints, health check, browser CRUD flow, reload persistence, search/filter behavior, and delete fallback were manually verified on Windows on 2026-09-22.
