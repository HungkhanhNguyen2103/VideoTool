# Phase 4 Prompt 1 — Asset Module Design Specification

**Date:** 2026-09-22  
**Status:** Design only; implementation is intentionally blocked until review.  
**Source brief:** Phase 4 Prompt 1 — Asset Module (Design Brief)

## Goal

Add the Studio asset workflow after script finalization: edit each scene's visual prompt and asset type, export a Flow-compatible JSON array, import the ZIP returned by Google Flow, store supported files through `file-store`, and attach each stored file to its project scene.

The implementation keeps the existing modular-monolith boundaries, adds no npm dependencies, and leaves Together AI, audio, and video rendering out of this phase.

## Non-goals

- Together AI or any automatic image/video generation.
- Audio, voice-over, video rendering, scene reordering, or scene deletion.
- A new MongoDB collection owned by `asset`.
- A second asset URL persistence field or a project-to-file-store ownership exception.
- File deletion/garbage collection when a scene is replaced or an asset is re-imported.

## Existing-repo baseline

- `SceneDocSchema` currently stores `{ id, narration, visualPrompt, durationSec }`; `ProjectDocSchema` is parsed on reads, so nested scene defaults will normalize old scene documents without a migration.
- `project` owns every write to the `projects` collection and already exposes `replaceProjectScenes` through its public index.
- `file-store` owns the `files` collection and writes disk files through `createFileStoreService(filesDir).storeFile`; its public summaries currently omit `storedPath`, even though the server document has it.
- `file-store` currently has a 50 MB ZIP multer middleware and the shared error handler already maps Multer `LIMIT_FILE_SIZE` to `FILE_TOO_LARGE`; Phase 4 adds a separate 200 MB upload middleware for asset ZIPs.
- `asset` is already present in `eslint.config.js` `MODULES` and already allows `asset -> project` and `asset -> job`; no boundary-rule change is needed. This phase does not use `job`.
- `createApp` mounts routers explicitly under `/api/project`; the new asset router follows that composition pattern.
- The client uses `src/client/features/<module>/`, so the Studio implementation belongs in `features/asset/`, not a new `client/modules/` tree.

## Design decisions for the review questions

1. **Asset URL resolution:** do not add a derived `assetUrl` to `SceneDoc` or make `project` import `file-store`. Extend the shared `FileSummarySchema` with the generated relative `storedPath`; the Studio page fetches the existing `GET /api/project/:id/files` list, maps `assetFileId` to `/files/{storedPath}` in client state, and keeps project ownership one-way. This avoids persisting a derived URL that can become stale.
2. **Re-import behavior:** importing a valid file for a scene overwrites that scene's `assetFileId` silently and increments the project version. The old file remains on disk and in `files`; orphan cleanup is an explicit later concern, so the response counts the scene as `updated` rather than inventing a new skip code.
3. **Bulk scene write:** `applySceneAssets` uses one `projects.updateOne` with dynamic `$set` paths (`scenes.$[s0].assetFileId`, `scenes.$[s1].assetFileId`, …), matching array filters, and one `$inc: { version: 1 }`. Because scenes are embedded in one project document, this is atomic and more correct than `updateMany` or a loop of writes. Duplicate scene updates are deduplicated with the last value winning before building the update.
4. **ZIP size:** 200 MB is accepted as specified. It is large enough for the stated ~40 MB typical ZIP while still bounded by multer memory storage; the limit is covered by the existing `FILE_TOO_LARGE` error mapping.
5. **Asset-type compatibility:** image extensions (`png`, `jpg`, `jpeg`, `webp`) are accepted only for scenes whose `assetType` is `image`; video extensions (`mp4`, `mov`, `webm`) are accepted only for `video`. A supported extension with the wrong scene type is skipped rather than partially written.
6. **Malformed/extra ZIP entries:** only root-level files matching `SCENE_{N:3-digit}_{anything}.{ext}` are considered. Directories and files below a directory are ignored; root-level non-matches, unsupported extensions, type mismatches, and out-of-range numbers are added to `skipped[]`. One bad entry never aborts the rest of the import.

## Contracts and project ownership

### File summary for previews

Extend `src/contracts/file.ts` so `FileSummarySchema` exposes `storedPath: z.string()`. `file-store` already generates this basename from a ULID and an inferred extension, so exposing it does not expose a user path. Existing upload/list responses gain this additive field; the client constructs `/files/${storedPath}` only after matching the file's `projectId` and `assetFileId`.

### Scene fields

Extend `src/contracts/project.ts`:

```ts
export const SceneSchema = z.object({
  id: z.string(),
  narration: z.string(),
  visualPrompt: z.string(),
  durationSec: z.number().int().nonnegative(),
  assetType: z.enum(['image', 'video']).default('image'),
  assetFileId: z.string().nullable().default(null),
});
```

The server-owned `SceneDocSchema` in `src/server/modules/project/docs.ts` uses the same two defaults. Existing scene documents are normalized on read; no migration or eager rewrite is required. New finalization scenes persist `assetType: 'image'` and `assetFileId: null` explicitly (or receive the same schema defaults before insertion).

### Public project-service methods

Add and export these methods from `src/server/modules/project/index.ts`; the asset module must call them instead of importing the project repository or `getCollection`:

```ts
patchProjectScene(
  projectId: string,
  sceneId: string,
  patch: Partial<Pick<SceneDoc, 'visualPrompt' | 'assetType' | 'assetFileId'>>,
): Promise<ProjectDetail>

setProjectScenesAssetType(
  projectId: string,
  assetType: 'image' | 'video',
): Promise<ProjectDetail>

applySceneAssets(
  projectId: string,
  assetUpdates: Array<{ sceneId: string; assetFileId: string }>,
): Promise<ProjectDetail>
```

`patchProjectScene` uses a filtered positional `$set` and increments `version`. `setProjectScenesAssetType` uses `$set: { 'scenes.$[].assetType': assetType }` and increments `version`. `applySceneAssets` validates the project and all referenced scene IDs before its single atomic update; an empty update list returns the current project without a write. A missing project or scene maps to the existing typed 404 behavior.

## Asset module architecture

The module owns orchestration only and no MongoDB collection:

- `src/server/modules/asset/docs.ts`: Flow export types, supported extension/MIME tables, and import filename parsing types.
- `src/server/modules/asset/service.ts`: pure export mapping plus ZIP parsing/storage orchestration.
- `src/server/modules/asset/routes.ts`: thin HTTP validation, multer handling, response mapping, and content-disposition headers.
- `src/server/modules/asset/index.ts`: public router, configuration hook, and service functions.
- `src/server/modules/asset/asset.test.ts`: Mongo/file-store integration tests using `mongodb-memory-server` and a temporary files directory.
- `src/server/modules/asset/MODULE.md`: purpose, Flow round trip, filename/MIME rules, URL resolution, and known orphan-file gap.

The service uses a configured `storeFile` function obtained from `createFileStoreService(filesDir).storeFile`. `createApp` calls `configureAssetModule(options.filesDir)` beside `configureFileStore`; tests configure a temporary directory. This reuses file-store's public service factory without exposing its private configured singleton or letting asset write the `files` collection directly.

### Flow export

```ts
export type FlowSceneExport = {
  sceneId: number;
  sceneNumber: number;
  title: string;
  prompt: string;
  assetType: 'image' | 'video';
};
```

`exportScenesJson(project)` enumerates `project.scenes` in array order. Both numeric IDs are `index + 1`. `title` is the first 60 characters of `narration`, Unicode-normalized, accent-stripped, converted to display-safe words separated by `_`, and falls back to `scene_{N}` when empty. `prompt` is `visualPrompt` unchanged and `assetType` is the scene value after schema defaults.

### ZIP import

`importAssetsFromZip(projectId, zipBuffer)` performs:

1. Load the project through `getProject`.
2. Parse the buffer with `adm-zip`; invalid ZIP data maps to `INVALID_ZIP` (422).
3. Iterate root-level file entries and match `^SCENE_(\d{3})_[^/]+\.([A-Za-z0-9]+)$` case-insensitively.
4. Convert the number to a one-based scene index; out-of-range numbers are skipped.
5. Infer MIME using this table: `png -> image/png`, `jpg|jpeg -> image/jpeg`, `webp -> image/webp`, `mp4 -> video/mp4`, `mov -> video/quicktime`, `webm -> video/webm`.
6. Reject unsupported extensions and image/video type mismatches into `skipped[]` before writing anything for that entry.
7. Call the configured file-store `storeFile({ projectId, originalName, mimeType, buffer, purpose: 'reference' })` for each accepted entry.
8. Apply all `{ sceneId, assetFileId }` pairs through one `applySceneAssets` call.
9. Return `{ updated: assetUpdates.length, skipped }`.

An accepted file is stored before the final project update; if the final update fails, the file is orphaned and remains subject to the documented cleanup gap. Re-importing a scene stores the new file and replaces the reference silently.

## HTTP API

Mount `assetRouter` at `/api/project` in `app.ts`:

- `GET /:id/scenes/export-json`: verify the project, return `FlowSceneExport[]` as JSON, set `Content-Disposition: attachment; filename="scenes-export.json"`.
- `POST /:id/scenes/import-assets`: use a 200 MB memory-storage multer middleware, require field `file`, accept only `application/zip` or `application/x-zip-compressed`, call `importAssetsFromZip`, and return `200 { updated, skipped }`. Multer size errors use the existing `FILE_TOO_LARGE` mapping.
- `PATCH /:id/scenes/:sceneId`: validate a non-empty body containing only optional `visualPrompt` and `assetType`; call `patchProjectScene`; return `ProjectDetail`.
- `POST /:id/scenes/set-asset-type`: validate `{ assetType: 'image' | 'video' }`; call `setProjectScenesAssetType`; return `ProjectDetail`.

No public asset-generation job routes are added. Routes do not write MongoDB directly.

## Client Studio design

Create `src/client/features/asset/api.ts` with typed functions for project detail, project file listing, Flow JSON export, scene patching, bulk type changes, and ZIP upload. `importAssetsZip` uses `XMLHttpRequest` so the optional `onProgress(percent)` callback can report upload progress without adding a dependency; the response remains `{ updated, skipped }`.

Create `src/client/features/asset/StudioPage.tsx` and CSS module, then route `/production/:projectId/studio` to it. The page:

- Shows project title/status, Copy JSON, Export JSON, Import ZIP, and All images/All videos controls.
- Copies the fetched JSON to the clipboard and shows a brief toast; Export JSON creates a Blob/object URL and downloads `scenes-export.json`.
- Loads `GET /files` metadata once per project and maps `assetFileId` to `/files/{storedPath}` for previews; no `assetUrl` is added to the project contract.
- Renders one card per scene with one-based number, narration subtitle, asset type toggle, editable `visualPrompt`, and image/video/no-asset preview.
- Shows `X / Y scenes have assets` and a collapsible skipped-file list after import.
- Refreshes the project and file list after scene edits or import. It does not implement generation, audio, rendering, reordering, or deletion.

## Verification strategy

Use `mongodb-memory-server` and `os.tmpdir()` for the file-store directory; no real provider or media generation is used. If the Mongo binary cannot download, document the exact fallback and reason in the acceptance status rather than changing the Mongo URI or adding a dependency.

Tests cover:

- Scene defaults for old documents and Flow export numbering/title/prompt/type.
- File summaries expose the generated relative `storedPath` needed for client previews without exposing arbitrary filesystem paths.
- Valid image ZIP storage and `assetFileId` assignment.
- Unsupported extension, filename mismatch, out-of-range number, subdirectory, and image/video type mismatch skipping while valid entries still import.
- Re-import overwrite behavior and empty ZIP update behavior.
- `patchProjectScene`, `setProjectScenesAssetType`, and one-write `applySceneAssets` behavior.
- Export route status/header/body, valid import route response, invalid MIME, missing file, and 200 MB Multer limit mapping.
- Scene patch route validation and updated `ProjectDetail` response.
- Existing project documents whose scenes lack the new fields read with `assetType: 'image'` and `assetFileId: null`.

The implementation must run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` before acceptance. `eslint.config.js` must remain unchanged.

## Commit and documentation discipline

Suggested implementation commits, each with `AGENTS.md` Status and `src/server/modules/asset/MODULE.md` updated in the same meaningful commit:

1. `feat(contracts): extend SceneDoc with asset references`
2. `feat(project): add scene asset mutation methods`
3. `feat(asset): add Flow export and ZIP import service/routes`
4. `feat(asset): add Mongo/file-store integration tests`
5. `feat(client): add Studio asset workflow`
6. `docs(phase4): record asset module acceptance`

Stage only files with real content changes. Never use `git add -A` or `git add .`; never push. Do not add Together AI or any other npm dependency.

## Review focus

Before implementation review, pay particular attention to:

1. Old scene documents missing `assetType`/`assetFileId` receiving defaults without a migration or undefined client fields.
2. ZIPs containing a mix of valid, malformed, unsupported, out-of-range, and type-mismatched entries continuing successfully with an accurate `skipped[]` list.
3. Duplicate scene numbers and duplicate re-imports not causing ambiguous updates or partial project writes.
4. `applySceneAssets` updating the correct embedded scenes with one version increment, without a per-scene write loop.
5. Upload size/MIME failures returning the established JSON error shape rather than leaking Multer or ZIP exceptions.
