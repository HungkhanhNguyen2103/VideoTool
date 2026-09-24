# Phase 4 Prompt 1 — Asset Module (Design Brief)

Phase 3 is complete. Begin Phase 4: the asset module.

This prompt is a **design brief only**. Commit a spec, then wait for review before implementation.

---

## Context

Pipeline so far: project → script → scenes[]. Phase 4 adds the asset workflow:

1. User edits `visualPrompt` per scene in the Studio page.
2. User copies the scene JSON export and pastes into Google Flow (external tool, not our concern).
3. Google Flow generates images/videos and returns a ZIP.
4. User imports the ZIP back via the Studio page.
5. Each scene gets an `assetFileId` pointing to a stored file.

No Together AI integration in this phase. The Flow path is the only asset generation method for now.

**No new npm dependencies are allowed for this prompt.**  
All needed infrastructure already exists: `adm-zip` (Phase 2), `file-store` module, multer.

---

## 1. Extend `SceneDoc` — `src/contracts/project.ts`

Add two fields to `SceneDocSchema`:

```ts
assetType: z.enum(['image', 'video']).default('image'),
assetFileId: z.string().nullable().default(null),
```

`assetType` controls what Flow generates and what the import parser accepts. `assetFileId` is a reference to a `FileDoc._id` in the `files` collection (via `file-store`).

Existing documents: read with defaults (`assetType: 'image'`, `assetFileId: null`), no migration required.

---

## 2. Scene export format

The JSON array sent to Google Flow has this shape:

```ts
export type FlowSceneExport = {
  sceneId: number;      // 1-based sequential index (same value as sceneNumber)
  sceneNumber: number;  // 1-based sequential index
  title: string;        // narration truncated to first 60 chars, slugified for display
  prompt: string;       // scene.visualPrompt
  assetType: 'image' | 'video';
};
```

`sceneNumber` is the scene's 1-based position in `project.scenes[]`. The matching key on import is this number.

---

## 3. ZIP import filename convention

Current format (from real ZIP):
```
SCENE_001_Truoc_khi_nhung_chiec_coc_giu_chan_ham_oi.png
SCENE_028_Tu_Tay_Xoa_Bo_Di_San.png
```

Pattern: `SCENE_{N:3-digit-zero-padded}_{anything}.{ext}`

Supported extensions:
- Images: `png`, `jpg`, `jpeg`, `webp`
- Video (future): `mp4`, `mov`, `webm`

The parser extracts `N` from the filename, looks up `project.scenes[N - 1]`, stores the file via `file-store.storeFile()`, and writes the returned `FileDoc._id` to `scene.assetFileId`.

Files with unrecognised extensions → skip silently and include in a `skipped[]` list in the response.  
Files where `N` is out of range → skip and include in `skipped[]`.  
**Do not fail the entire import if some files are unrecognised.**

MIME type is inferred from the file extension for storage (e.g. `png` → `image/png`, `mp4` → `video/mp4`).

---

## 4. `SceneDoc` write ownership

`project` module remains the sole writer of `projects`. Add the following public project-service methods (exported from `src/server/modules/project/index.ts`):

```ts
// Patch a single scene's mutable fields
patchProjectScene(
  projectId: string,
  sceneId: string,
  patch: Partial<Pick<SceneDoc, 'visualPrompt' | 'assetType' | 'assetFileId'>>,
): Promise<ProjectDetail>

// Bulk-set assetType for all scenes at once
setProjectScenesAssetType(
  projectId: string,
  assetType: 'image' | 'video',
): Promise<ProjectDetail>

// Write assetFileId for multiple scenes in one atomic update
// assetUpdates: array of { sceneId, assetFileId }
applySceneAssets(
  projectId: string,
  assetUpdates: Array<{ sceneId: string; assetFileId: string }>,
): Promise<ProjectDetail>
```

The asset module must not call `getCollection('projects')` directly.

---

## 5. Asset module — `src/server/modules/asset/`

This is a new domain module. Add `'asset'` to `MODULES` in `eslint.config.js` and add `asset: ['project', 'job']` to the `ALLOWED` map (same as what the existing `ALLOWED` map specifies for asset — check first and do not duplicate).

### `src/server/modules/asset/docs.ts`

No new MongoDB collection needed. All files are stored in `file-store`. The asset module only orchestrates.

### `src/server/modules/asset/service.ts`

```ts
// Build the JSON array to send to Flow
exportScenesJson(project: ProjectDetail): FlowSceneExport[]

// Parse a ZIP buffer, store files via file-store, apply assetFileIds to scenes
// Returns: { updated: number; skipped: string[] }
importAssetsFromZip(
  projectId: string,
  zipBuffer: Buffer,
): Promise<{ updated: number; skipped: string[] }>
```

`importAssetsFromZip` steps:
1. Load project (via `getProject`).
2. Parse ZIP with `adm-zip`. Iterate root-level entries only (ignore subdirectories).
3. For each file: match `SCENE_{N}_{*}.{ext}` regex. If no match → push filename to `skipped[]`.
4. Parse `N` as integer. If `N < 1 || N > project.scenes.length` → push to `skipped[]`.
5. Infer MIME from extension. If unsupported → push to `skipped[]`.
6. Call `storeFile({ projectId, originalName, mimeType, buffer, purpose: 'reference' })` from file-store.
7. Collect `{ sceneId: project.scenes[N-1].id, assetFileId: result.id }`.
8. After processing all files, call `applySceneAssets(projectId, updates)` in one write.
9. Return `{ updated: updates.length, skipped }`.

### `src/server/modules/asset/routes.ts`

Mount at `/api/project` in `app.ts`.

#### `GET /api/project/:id/scenes/export-json`

Returns `200 FlowSceneExport[]`. Also sets `Content-Disposition: attachment; filename="scenes-export.json"` so the browser offers a download (the UI also provides a copy-to-clipboard button).

Verify project exists first.

#### `POST /api/project/:id/scenes/import-assets`

```
Content-Type: multipart/form-data
field: file (single ZIP)
```

Max size: **200 MB** (larger than the script ZIP because it contains images/video).  
Accept only `application/zip` or `application/x-zip-compressed`; otherwise 400 `INVALID_FILE_TYPE`.

Call `importAssetsFromZip`. Return `200 { updated, skipped }`.

#### `PATCH /api/project/:id/scenes/:sceneId`

Body schema:
```ts
z.object({
  visualPrompt: z.string().optional(),
  assetType: z.enum(['image', 'video']).optional(),
}).refine((v) => Object.keys(v).length > 0)
```

Calls `patchProjectScene`. Returns `200 ProjectDetail`.

#### `POST /api/project/:id/scenes/set-asset-type`

Body: `{ assetType: 'image' | 'video' }`.  
Calls `setProjectScenesAssetType`. Returns `200 ProjectDetail`.  
Convenience bulk endpoint so the UI can switch all scenes with one click.

### `src/server/modules/asset/index.ts`

Export: `assetRouter`, `exportScenesJson`, `importAssetsFromZip`.

---

## 6. Client — Studio page

Route: `/production/:projectId/studio` (already navigated to by `finalizeScript`).

### `src/client/modules/asset/api.ts`

```ts
getProject(id: string): Promise<ProjectDetail>
exportScenesJson(projectId: string): Promise<FlowSceneExport[]>
patchScene(projectId, sceneId, body): Promise<ProjectDetail>
setAllAssetType(projectId, assetType): Promise<ProjectDetail>
importAssetsZip(projectId, file, onProgress?): Promise<{ updated: number; skipped: string[] }>
```

`exportScenesJson` fetches the JSON (not a file download — the client uses it to copy to clipboard and/or trigger a browser download via `URL.createObjectURL`).

### `src/client/pages/StudioPage.tsx`

**Header area:**
- Project title + status badge.
- Two action buttons:
  - "Copy JSON" — calls `exportScenesJson`, copies the JSON string to clipboard and shows a brief "Copied!" toast.
  - "Export JSON" — same fetch, triggers browser file download as `scenes-export.json`.
- "Import ZIP" — file input (accept `.zip`) → calls `importAssetsZip` → shows `{ updated, skipped }` result toast. If `skipped.length > 0`, show a collapsible list of skipped filenames.
- "All images / All videos" toggle → calls `setAllAssetType`.

**Scene list (one card per scene):**
- Scene number (1-based), first ~80 chars of `narration` as subtitle.
- Asset type badge: `image` / `video` (click to toggle, calls `patchScene`).
- `visualPrompt` field: display as read-only text with an "Edit" button. On edit: show `<textarea>` + Save/Cancel (calls `patchScene`).
- Asset preview area:
  - If `assetFileId` is null: grey placeholder with "No asset yet".
  - If `assetFileId` is set and `assetType === 'image'`: `<img src="/files/{storedPath}">` — but we don't have storedPath on the client. Use `GET /api/project/:id/files` (file-store list) to look up the file URL, or add `assetUrl` to `ProjectDetail` scene mapping (see note below).
  - If `assetType === 'video'`: `<video>` tag.

**Note on asset URL:** The simplest approach is to add a derived `assetUrl: string | null` field to `SceneDoc` in the `ProjectDetail` response — computed server-side as `/files/${fileDoc.storedPath}` when `assetFileId` is set, null otherwise. This avoids a second API call from the client. Codex should design this in the spec.

**Progress indicator:** Show `updated / total scenes` asset fill rate as a simple `X / Y scenes have assets` counter in the header.

---

## 7. Tests — `src/server/modules/asset/asset.test.ts`

Use `mongodb-memory-server` + `os.tmpdir()` for `filesDir`. No real file generation.

Cover:
- `exportScenesJson`: returns correct `sceneNumber`, `prompt`, `assetType` for each scene.
- `importAssetsFromZip`: valid ZIP with `SCENE_001_*`.png → stores file, updates `assetFileId`.
- `importAssetsFromZip`: file with unrecognised extension → skipped, other files still imported.
- `importAssetsFromZip`: `SCENE_999_*.png` where 999 > scene count → skipped.
- `importAssetsFromZip`: filename not matching pattern → skipped.
- `patchProjectScene`: updates `visualPrompt`, `assetType`, or `assetFileId` atomically.
- `setProjectScenesAssetType`: updates all scenes.
- `applySceneAssets`: updates multiple scenes in one write.
- Route `GET /export-json` → 200 JSON array.
- Route `POST /import-assets` with valid ZIP → 200 `{ updated, skipped }`.
- Route `POST /import-assets` with non-ZIP → 400 `INVALID_FILE_TYPE`.
- Route `PATCH /scenes/:sceneId` → 200 updated ProjectDetail.

---

## 8. `src/server/modules/asset/MODULE.md`

Cover: module purpose, Flow integration pattern (export → external → import ZIP), filename convention, MIME inference table, `assetUrl` derivation, no Together AI in this phase (placeholder for Phase 5), known gap: no asset deletion when scene is removed.

---

## 9. Commit discipline

Same rules: update `AGENTS.md` + `MODULE.md` in each meaningful commit. No `git add -A`. No push.

Suggested commit order:
1. `feat(contracts): extend SceneDoc with assetType and assetFileId`
2. `feat(project): add patchProjectScene, setProjectScenesAssetType, applySceneAssets`
3. `feat(asset): docs, service (export + ZIP import), routes`
4. `feat(asset): tests`
5. `feat(client): StudioPage and asset API`
6. `docs(phase4): record asset module acceptance`

---

## 10. Review questions before planning

1. Is deriving `assetUrl` server-side in `ProjectDetail` (looking up file by `assetFileId` at query time) acceptable, or should the client resolve it separately via the file-store list endpoint?
2. Should `importAssetsFromZip` be idempotent — i.e., if a scene already has `assetFileId` set, does re-importing overwrite it silently, or should it skip and report in `skipped[]`?
3. The `applySceneAssets` write: should it use a bulk `updateMany` with `arrayFilters`, or individual `findOneAndUpdate` per scene? (Prefer bulk for atomicity.)
4. Is 200 MB the right ZIP size limit, given a typical 163-scene ZIP is ~40 MB of PNGs?

---

## 11. Out of scope

- Together AI / automated image generation (Phase 5).
- Video rendering / combining scenes into final video (Phase 5+).
- Audio / voice-over (Phase 5+).
- Scene reordering.
- Do not push.

---

## 12. Report format

When done:
1. Checklist of each section.
2. Commits with hashes.
3. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
4. Decisions outside this spec.
5. Blockers or open questions.
6. Confirm ready for Phase 5.
