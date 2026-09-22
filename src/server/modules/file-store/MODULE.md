# Module: file-store

**Purpose:** Shared disk-backed storage for project reference files and the file metadata collection.
**Owns collection(s):** files
**Boundary:** This directory is shared infrastructure and intentionally is not listed in `eslint.config.js` `MODULES`.

## Invariants
- `storedPath` is relative to `FILES_DIR` and is generated from a new ULID, never from a user path.
- File summaries expose the generated relative `storedPath` so clients can build safe `/files/<storedPath>` preview URLs.
- Only reference files are supported in this phase.
- Database metadata and disk content are coordinated by the service; deleting an already-missing disk file is allowed.

## Flow
- Routes validate project ownership and upload MIME/size, then call the injected file-store service.
- Repository methods only query the `files` collection.
- ZIP import validates scenes and delegates replacement to the project module; it replaces, never merges, scenes.

## Service surface
- `createFileStoreService(filesDir)` injects the disk root for production and isolated tests.
- `storeFile` writes a generated `{id}.{ext}` path before inserting metadata; `deleteFile` tolerates missing disk files.

## Known pitfalls
- There is no garbage collection for orphaned files after partial failures or project deletion; defer to Phase 6+.
- Do not add this directory to `eslint.config.js` module boundaries.
- Project scene replacement is delegated to the project service, which performs the direct `projects.updateOne`, so file-store routes never write that collection.
- ZIP import accepts only root-level `scenes.json`; invalid or missing content returns 422 and a valid import replaces the entire scene array.

## Acceptance
- File-store service and route tests use `mongodb-memory-server` plus unique temp directories, all removed in suite teardown.
- Final verification: typecheck, lint, 52 tests passed (4 stub files skipped), production build, unchanged `eslint.config.js`, dependency allowlist check, and worker startup/SIGINT smoke test.
- Final review: project scene replacement ownership is enforced in `project/service.ts`; no Critical or Important findings remain. A later-appended-log duplicate-count assertion remains a low-risk follow-up.
