# Module: asset

**Purpose:** Orchestrate the Google Flow export/import path for per-scene image/video assets.
**Owns collection(s):** none; `project` owns scenes and `file-store` owns stored files.
**May import (via their index.ts only):** project and the shared file-store service; job is reserved for a later generation phase.
**Public API:** only what `index.ts` exports. Nothing else in this module may be imported from outside.

## Invariants

- Scene asset metadata is part of the project-owned `SceneDoc`: `assetType` defaults to `image`, `assetFileId` defaults to `null`.
- Asset code never calls `getCollection('projects')`; all scene writes go through public project-service methods.
- `FileSummary.storedPath` is a generated relative basename used by the client to build preview URLs; no derived `assetUrl` is persisted on scenes.
- Project asset updates use the public `patchProjectScene`, `setProjectScenesAssetType`, and atomic `applySceneAssets` methods; this module owns no scene persistence.

## Flow

- Export scenes as numbered JSON for the external Google Flow tool.
- Flow scene exports may include `referenceTags` after `motionPrompt`, derived only from the scene's persisted `shotType` and `lightType`. Legacy scenes with neither value omit the field. Non-map styles start with `core`, then add `interior`, `night` (including firelight), `wide` (including high angle), and `props` (detail shots) in that order, filtered to slots defined by the selected style pack. Strategic Map omits the field until its scene families are planned. Export never computes or backfills a shot/light plan.
- Import Flow's root-level `SCENE_{N}_{anything}.{ext}` ZIP entries and attach stored file IDs to matching scenes.
- Image MIME mapping is `png -> image/png`, `jpg|jpeg -> image/jpeg`, `webp -> image/webp`; video mapping is `mp4 -> video/mp4`, `mov -> video/quicktime`, `webm -> video/webm`.
- Asset ZIP uploads are limited to 200 MB and unsupported, malformed, nested, out-of-range, or asset-type-mismatched entries are reported in `skipped[]` without aborting valid entries.
- This module currently imports existing files from ZIPs and adjusts asset types/distribution; it has no image/video generation route or worker.

## Known pitfalls

- Re-import overwrites a scene reference and leaves the old file orphaned; cleanup is deferred.
- Together AI, voice, and video rendering are out of scope for this phase.
- `assetUrl` is derived on the client from `FileSummary.storedPath`; it is not stored on scenes and `project` does not import file-store.
- Integration tests cover mixed ZIP skips, type mismatches, duplicate/re-import replacement, malformed ZIP enumeration/extraction, route validation, the 200 MB Multer limit, and MIME-based preview classification.
- The Studio client uses `FileSummary.storedPath` for previews, XHR upload progress, and no DOM test dependency; browser rendering remains an acceptance check. It selects media elements by stored MIME and flags a scene/file type mismatch. Visual-prompt generation is queued through the script API, and its button stays disabled while the current project job is queued or running, including before the first progress event.
- `FlowSceneExport` is canonicalized in `contracts/asset.ts` so the client shares the route shape without importing this server module.

## Inactive scenes — Task 98 Part A

Flow JSON export omits inactive scenes while keeping their original scene numbers. ZIP import skips files targeting inactive scenes, returns the skipped filenames with a Vietnamese reason, and reports `skippedInactive`; project-wide asset-type changes, video-distribution preview/apply, and automatic depth-map enqueueing only target active scenes. `fitSceneToClip` rejects an inactive target through the project module's shared guard.

## Studio inactive-scene controls — Task 98 Part C

The Studio client displays active/inactive counts and active-only total duration. Each scene card and detail panel has an accessible, version-guarded activation switch; inactive cards remain selectable and editable while single-scene generation and preview actions are disabled. Batch labels use the shared scene-activity helper, and popup/readiness/progress/listening summaries use the active timeline. Successful batch notices report `skippedInactive`; a 409 from the activation route is shown as a Vietnamese conflict notice.

## Acceptance

- `npm run typecheck`, `npm run lint`, and the Task 6 asset API suite pass; the client visual-prompt action uses the typed enqueue route and has enqueue-gap/terminal-state predicate coverage.
- `mongodb-memory-server` ran successfully; asset ZIP tests use a temporary files directory and cover the 200 MB limit.
- Flow export/import, project scene mutation ownership, route error mapping, and Studio API/client behavior are implemented.
- `eslint.config.js` and package dependencies were unchanged in Phase 4; no Together AI integration was added.
- Built worker logged startup and graceful SIGINT shutdown. Task 98 Part C Studio acceptance was verified on a disposable duplicate through Chrome CDP at exact 1920×1080, 1440×900, and 390×844 captures; Playwright was unavailable and live SFX search was not run.
