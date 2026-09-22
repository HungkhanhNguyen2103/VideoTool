# Phase 2 Prompt 2: File Store, Reference Upload, and ZIP Scene Import

## Goal

Add disk-backed reference-file storage and a ZIP scene-import backend without UI wiring or Phase 3+ generation work.

## Scope and constraints

- New dependencies are exactly `multer`, `adm-zip`, `@types/multer`, and `@types/adm-zip`.
- `src/server/modules/file-store/` is shared infrastructure, not a domain module; it must not be added to `MODULES` in `eslint.config.js`, and that file remains untouched.
- The `files` collection is owned by file-store. Project scene replacement remains owned by the project module.
- No UI changes, `/files` static-serving changes, job endpoints, script generation, asset/video handlers, or push.
- Preserve untracked `Claude outputs/` and stage only files with real content changes.
- Every meaningful commit updates `AGENTS.md` Status and the relevant module `MODULE.md` in the same commit.

## Data contracts and persistence

`src/contracts/file.ts` defines `FILE_PURPOSES = ['reference']`, the eight allowed MIME types from the prompt, and `FileSummarySchema` with ISO `createdAt`.

`FileDoc` in `modules/file-store/docs.ts` stores `_id`, `projectId`, `originalName`, `mimeType`, extension without a dot, byte size, literal purpose `reference`, a path relative to `FILES_DIR`, and `createdAt`.

The file-store indexes are `{ projectId: 1, createdAt: -1 }` and `{ purpose: 1 }`, registered explicitly from `db/ensure-indexes.ts`.

## File-store service

The service is constructed with `filesDir` so tests use a unique temporary directory. `storeFile` derives an extension from the original filename, falls back to a MIME mapping when absent, writes `{filesDir}/{newId}.{ext}` with `fs/promises.writeFile`, then inserts the document and returns `FileSummary`. The stored path never contains user-controlled directory components.

`deleteFile` loads the document, throws `NotFound` when absent, removes the disk file while ignoring `ENOENT`, then deletes the database row. `listProjectFiles` returns summaries ordered by newest creation time.

## HTTP routes and upload policy

`shared/upload.ts` uses Multer memory storage. Reference uploads are limited to 100 MB; ZIP imports use a separate 50 MB limiter. The file-store router is mounted at `/api/project` alongside the existing project router.

- `POST /:id/files` verifies the project, checks the uploaded MIME against `ALLOWED_MIME_TYPES`, stores the reference, and returns 201.
- `GET /:id/files` verifies the project and returns summaries.
- `DELETE /:id/files/:fileId` verifies the project and ownership before deleting; a file belonging to another project is treated as not found.
- `POST /:id/import-zip` verifies the project, accepts only ZIP MIME types, requires root-level `scenes.json`, parses it, validates `z.array(SceneDocSchema)`, replaces all scenes, increments project version, and returns the updated detail.

Invalid MIME uses `{ code: 'INVALID_FILE_TYPE', message: 'File type not supported.' }`. Missing root `scenes.json` uses HTTP 422 and `{ code: 'MISSING_SCENES_JSON', message: 'ZIP must contain scenes.json at the root.' }`. Invalid scene JSON uses HTTP 422 with field errors.

To preserve the module ownership rule while honoring the prompt's direct `findOneAndUpdate` semantics, the route calls a new public project service operation (for example `replaceProjectScenes`) and the project module performs the direct compare-and-update internally. The route never imports the project repository or writes the `projects` collection itself.

Multer file-size errors are converted to a client 400 response by the upload route/error mapping rather than leaking as a 500. ZIP parse errors and malformed JSON are 422 responses with stable error codes/messages.

## Tests and verification

`file-store.test.ts` uses `mongodb-memory-server` and a unique `os.tmpdir()` directory per suite, cleaned in `afterAll`. It covers service write/read/delete/list behavior, ENOENT-tolerant deletion, unknown-id `NotFound`, valid PNG upload, disallowed MIME, cross-project delete protection, valid ZIP replacement, missing root `scenes.json`, and invalid scene schema with 422 field errors. ZIP buffers are generated in memory with `adm-zip`.

Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. Verify `eslint.config.js` is unchanged, no UI files or job public endpoints were added, and the existing worker/SSE behavior remains green.

## Known gap

There is no garbage collection for orphaned disk files after partial failures or project deletion; this is intentionally deferred to Phase 6+.
