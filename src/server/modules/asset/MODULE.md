# Module: asset

**Purpose:** Orchestrate the Google Flow export/import path for per-scene image/video assets.
**Owns collection(s):** none; `project` owns scenes and `file-store` owns stored files.
**May import (via their index.ts only):** project and the shared file-store service; job is reserved for a later generation phase.
**Public API:** only what `index.ts` exports. Nothing else in this module may be imported from outside.

## Invariants

- Scene asset metadata is part of the project-owned `SceneDoc`: `assetType` defaults to `image`, `assetFileId` defaults to `null`.
- Asset code never calls `getCollection('projects')`; all scene writes go through public project-service methods.
- `FileSummary.storedPath` is a generated relative basename used by the client to build preview URLs; no derived `assetUrl` is persisted on scenes.

## Flow

- Export scenes as numbered JSON for the external Google Flow tool.
- Import Flow's root-level `SCENE_{N}_{anything}.{ext}` ZIP entries and attach stored file IDs to matching scenes.

## Known pitfalls

- Re-import overwrites a scene reference and leaves the old file orphaned; cleanup is deferred.
- Together AI, voice, and video rendering are out of scope for this phase.
