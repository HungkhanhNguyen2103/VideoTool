# Phase 2 Prompt 2 — File Store + Reference Upload + ZIP Import

Phase 2 Prompt 1 is accepted. Proceed to Phase 2 Prompt 2.

---

## Scope

Implement the backend for file storage, reference-file upload, and ZIP scene import. No UI wiring, no Phase 3+ work (script generation, asset handling).

**New npm dependencies — install these before starting:**
```
npm install multer adm-zip
npm install -D @types/multer @types/adm-zip
```
These are the only new dependencies allowed for this prompt. Do not add anything else.

---

## 1. Architecture decision: `file-store` is NOT a domain module

Place `file-store` under `src/server/modules/file-store/` but do **not** add it to the `MODULES` array in `eslint.config.js` — do not touch that file at all. Because `file-store` is not in `MODULES`, it is treated as shared infrastructure and any module may import from it freely, same as `src/server/shared/`. This is intentional.

---

## 2. New file: `src/contracts/file.ts`

```ts
import { z } from 'zod';

export const FILE_PURPOSES = ['reference'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

export const ALLOWED_MIME_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'video/mp4',
  'video/quicktime',
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const FileSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  ext: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  purpose: z.enum(FILE_PURPOSES),
  createdAt: z.string(),
});
export type FileSummary = z.infer<typeof FileSummarySchema>;
```

---

## 3. `src/server/modules/file-store/docs.ts`

```ts
import { z } from 'zod';

export const FileDocSchema = z.object({
  _id: z.string(),            // ULID
  projectId: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  ext: z.string(),            // without leading dot, e.g. "zip", "mp4"
  sizeBytes: z.number().int(),
  purpose: z.literal('reference'),
  storedPath: z.string(),     // path relative to FILES_DIR, e.g. "01HXY...abc.zip"
  createdAt: z.date(),
});
export type FileDoc = z.infer<typeof FileDocSchema>;
```

## 4. `src/server/modules/file-store/indexes.ts`

```ts
export async function ensureFileStoreIndexes(): Promise<void> {
  const col = getCollection<FileDoc>('files');
  await col.createIndex({ projectId: 1, createdAt: -1 });
  await col.createIndex({ purpose: 1 });
}
```

Register `ensureFileStoreIndexes()` in `src/server/db/ensure-indexes.ts` (same pattern as `ensureProjectIndexes`).

## 5. `src/server/modules/file-store/repo.ts`

Queries only — no business logic.

```ts
insertFile(doc: FileDoc): Promise<void>
findFileById(id: string): Promise<FileDoc | null>
deleteFileById(id: string): Promise<void>
listFilesByProjectId(projectId: string): Promise<FileDoc[]>
```

## 6. `src/server/modules/file-store/service.ts`

Business logic. Constructor-inject `filesDir: string` (from config) so tests can use a temp directory.

```ts
export type StoreFileParams = {
  projectId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  purpose: 'reference';
};

// Derive ext from originalName. If none, derive from mimeType.
// Write file to {filesDir}/{newId}.{ext} using fs/promises.writeFile.
// Insert FileDoc. Return FileSummary.
storeFile(params: StoreFileParams): Promise<FileSummary>

// Find doc, delete from disk (ignore ENOENT — file already gone is fine),
// delete from DB. Throw NotFound if doc doesn't exist.
deleteFile(id: string): Promise<void>

// Returns FileSummary[].
listProjectFiles(projectId: string): Promise<FileSummary[]>
```

Max file size: **100 MB** enforced via multer limits, not in service.

## 7. `src/server/modules/file-store/index.ts`

Export: `fileStoreRouter`, `ensureFileStoreIndexes`, `storeFile`, `deleteFile`, `listProjectFiles`.

## 8. New routes mounted in `src/server/app.ts`

Mount `fileStoreRouter` at `/api/project`. This adds routes alongside `projectRouter` — Express resolves them in order.

### `POST /api/project/:id/files`

```
Content-Type: multipart/form-data
field: file (single file)
```

1. Verify project exists (call `getProject(id)` — throws `NotFound` if absent).
2. Accept only `ALLOWED_MIME_TYPES`. Reject anything else with 400 `{ error: { code: 'INVALID_FILE_TYPE', message: 'File type not supported.' } }`.
3. Enforce 100 MB max via multer `limits: { fileSize: 100 * 1024 * 1024 }`.
4. Call `storeFile(...)`. Return 201 `FileSummary`.

### `GET /api/project/:id/files`

Return `FileSummary[]` for the project. Verify project exists first (404 if not).

### `DELETE /api/project/:id/files/:fileId`

Verify project exists. Verify file belongs to this project (security: check `fileDoc.projectId === id`). Delete. Return 204.

### `POST /api/project/:id/import-zip`

```
Content-Type: multipart/form-data
field: file (single ZIP file)
```

Expected ZIP structure — must contain `scenes.json` at the root level:
```json
[
  { "id": "...", "narration": "...", "visualPrompt": "...", "durationSec": 5 },
  ...
]
```

Steps:
1. Verify project exists.
2. Accept only `application/zip` or `application/x-zip-compressed`. Enforce 50 MB max for ZIP imports.
3. Parse ZIP using `adm-zip`. Extract `scenes.json`. If absent → 422 `{ error: { code: 'MISSING_SCENES_JSON', message: 'ZIP must contain scenes.json at the root.' } }`.
4. Parse JSON. Validate as `z.array(SceneDocSchema)` from `src/server/modules/project/docs.ts`. On validation failure → 422 with Zod field errors (same shape as other 400s).
5. Replace `project.scenes` with the imported array. Use `findOneAndUpdate` directly on the projects collection: `{ $set: { scenes: importedScenes, updatedAt: new Date() }, $inc: { version: 1 } }`.
6. Return 200 with updated `ProjectDetail` (call `getProject(id)` after update).

**Important:** Import replaces scenes entirely — no merge/append. Document this in MODULE.md.

---

## 9. multer setup

Create `src/server/shared/upload.ts`:
```ts
import multer from 'multer';

// Memory storage: we write to disk ourselves in file-store service.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB default; routes override per-endpoint
});

// Specific limiters used in routes:
export const uploadReference = upload.single('file');
export const uploadZip = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
}).single('file');
```

---

## 10. `src/server/modules/file-store/MODULE.md`

Cover: purpose (disk-backed reference file storage), storedPath convention, ENOENT-tolerant delete, why `file-store` is not in the `MODULES` boundary list, ZIP import replaces scenes (not merges), known gap: no GC for orphaned files (Phase 6+).

---

## 11. Tests: `src/server/modules/file-store/file-store.test.ts`

Use `mongodb-memory-server` (same pattern as `job.test.ts`). Use `os.tmpdir()` + a unique subfolder for `filesDir` in each test; clean up in `afterAll`.

Cover:
- `storeFile` writes file to disk, inserts doc, returns correct `FileSummary`.
- `deleteFile` removes from disk and DB; second delete (ENOENT) does not throw.
- `deleteFile` on unknown id throws `NotFound`.
- `listProjectFiles` returns only files for the given project.
- Route: `POST /api/project/:id/files` with a valid PNG buffer → 201 `FileSummary`.
- Route: `POST /api/project/:id/files` with a disallowed MIME → 400.
- Route: `DELETE /api/project/:id/files/:fileId` where `fileId` belongs to a different project → 404.
- Route: `POST /api/project/:id/import-zip` with a valid ZIP containing `scenes.json` → 200, project scenes updated.
- Route: `POST /api/project/:id/import-zip` with a ZIP missing `scenes.json` → 422.
- Route: `POST /api/project/:id/import-zip` with invalid `scenes.json` (fails Zod) → 422 with field errors.

Build test ZIP buffers in-memory using `adm-zip` in the test file itself — no fixture files needed.

---

## 12. AGENTS.md + MODULE.md rule (rule 11)

Same discipline as Phase 2 Prompt 1:
- Update `## Status` and relevant `MODULE.md` in **the same commit** as each meaningful code change.
- Commit order suggestion: contracts/docs/indexes → repo → service → routes → tests → acceptance docs.
- No `git add -A`/`git add .`. Only stage files with real content changes. Verify with `git diff --ignore-cr-at-eol --stat` before staging.

---

## 13. Out of scope for this prompt

- No UI wiring (upload buttons, import dialog) — UI comes in Phase 3/4.
- No `GET /files/:storedPath` static serving changes — `app.ts` already serves `FILES_DIR` as `/files`.
- No script generation, asset handling, or video pipeline.
- No changes to `eslint.config.js`.
- No public job create/list endpoints.
- Do not push.

---

## 14. Report format (same as previous prompts)

When done:
1. Checklist of each item above (done / skipped + reason).
2. Commits with hashes and one-line descriptions.
3. `npm run typecheck`, `npm run lint`, `npm test` (counts), `npm run build` — results.
4. Decisions made outside this spec.
5. Blockers or open questions.
6. Confirm ready for Phase 3 (script module).
