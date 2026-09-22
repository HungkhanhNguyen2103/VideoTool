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
- Import Flow's root-level `SCENE_{N}_{anything}.{ext}` ZIP entries and attach stored file IDs to matching scenes.
- Image MIME mapping is `png -> image/png`, `jpg|jpeg -> image/jpeg`, `webp -> image/webp`; video mapping is `mp4 -> video/mp4`, `mov -> video/quicktime`, `webm -> video/webm`.
- Asset ZIP uploads are limited to 200 MB and unsupported, malformed, nested, out-of-range, or asset-type-mismatched entries are reported in `skipped[]` without aborting valid entries.

## Known pitfalls

- Re-import overwrites a scene reference and leaves the old file orphaned; cleanup is deferred.
- Together AI, voice, and video rendering are out of scope for this phase.
- `assetUrl` is derived on the client from `FileSummary.storedPath`; it is not stored on scenes and `project` does not import file-store.
- Integration tests cover mixed ZIP skips, type mismatches, duplicate/re-import replacement, malformed ZIP enumeration/extraction, route validation, the 200 MB Multer limit, and MIME-based preview classification.
- The Studio client uses `FileSummary.storedPath` for previews, XHR upload progress, and no DOM test dependency; browser rendering remains an acceptance check. It selects media elements by stored MIME and flags a scene/file type mismatch.
- `FlowSceneExport` is canonicalized in `contracts/asset.ts` so the client shares the route shape without importing this server module.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass; Vitest reports 101 passed and 2 stub files skipped.
- `mongodb-memory-server` ran successfully; asset ZIP tests use a temporary files directory and cover the 200 MB limit.
- Flow export/import, project scene mutation ownership, route error mapping, and Studio API/client behavior are implemented.
- `eslint.config.js` and package dependencies were unchanged in Phase 4; no Together AI integration was added.
- Built worker logged startup and graceful SIGINT shutdown. Studio browser visual acceptance remains pending in the headless environment.
