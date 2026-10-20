# Module: file-store

**Purpose:** Shared disk-backed storage for project reference files and shared visual-style reference packs.
**Owns collection(s):** files, visual_style_samples, visual_style_pack_images
**Boundary:** This directory is shared infrastructure and intentionally is not listed in `eslint.config.js` `MODULES`.

## Invariants
- `storedPath` is relative to `FILES_DIR` and is generated from a new ULID, never from a user path.
- File summaries expose the generated relative `storedPath` so clients can build safe `/files/<storedPath>` preview URLs.
- File purposes are `reference`, `style-reference`, `voiceover`, `sfx`, `bgm`, `render`, `render-draft`, and `depth`; generated audio/video files use the same project-scoped store as references.
- `resolveFilePath(projectId, fileId)` verifies ownership before returning an absolute path for server-side media processing; clients still use `storedPath` URLs.
- Database metadata and disk content are coordinated by the service; deleting an already-missing disk file is allowed.
- Style pack images use server-generated filenames under `FILES_DIR`; their original names are metadata only. Each document is keyed by `<styleId>:<slotId>` and stores style ID, slot ID, relative path, MIME type, original name, and creation time.
- The legacy `visual_style_samples` collection remains readable through the old routes and as a `core` fallback when no pack `core` exists. Uploading or deleting a pack `core` removes the legacy document and file.

## Flow
- Routes validate project ownership and upload MIME/size, then call the injected file-store service.
- Files under `FILES_DIR` are served by `express.static` at `/files`; the Express `send` dependency streams files and supports byte ranges for media playback and downloads.
- `GET /api/visual-style-packs` lists all six styles and their uploaded slots, with the legacy `core` fallback. `PUT /api/visual-style-packs/:styleId/:slotId` replaces one image; `DELETE` on the same path removes it. Uploads accept JPEG, PNG, or WebP using the existing 100 MB limit.
- `GET /api/visual-style-samples` and `PUT /api/visual-style-samples/:styleId` are deprecated but remain available for older clients.
- Repository methods only query the `files` collection.
- ZIP import validates scenes and delegates replacement to the project module; it replaces, never merges, scenes.

## Service surface
- `createFileStoreService(filesDir, options?)` injects the disk root for production and isolated tests; `options.rename` can replace `fs/promises.rename` for cross-volume tests. `deleteProjectFiles` removes owned render metadata and disk files during project deletion.
- `storeFile` writes a generated `{id}.{ext}` path before inserting metadata; `deleteFile` tolerates missing disk files.
- `storeFileFromPath` stats a non-empty source and moves it into the generated `{id}.{ext}` path without buffering the file. On `EXDEV`, it streams the source into the store and removes the source after a successful copy; if metadata insertion fails, it restores the source path (renaming back or streaming across devices) and rethrows the database error. Task 104 deliberately restores instead of deleting the stored copy so the video service can preserve a finished render under `render-failed/` after a metadata failure.

## Known pitfalls
- There is no garbage collection for orphaned files after partial failures or project deletion; defer to Phase 6+.
- Do not add this directory to `eslint.config.js` module boundaries.
- Project scene replacement is delegated to the project service, which performs the direct `projects.updateOne`, so file-store routes never write that collection.
- ZIP import accepts only root-level `scenes.json`; invalid or missing content returns 422 and a valid import replaces the entire scene array.

## Acceptance
- File-store service and route tests use `mongodb-memory-server` plus unique temp directories, all removed in suite teardown.
- Final verification: typecheck, lint, 52 tests passed (4 stub files skipped), production build, unchanged `eslint.config.js`, dependency allowlist check, and worker startup/SIGINT smoke test.
- Final review: project scene replacement ownership is enforced in `project/service.ts`; no Critical or Important findings remain. A later-appended-log duplicate-count assertion remains a low-risk follow-up.
