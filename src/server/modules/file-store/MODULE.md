# Module: file-store

**Purpose:** Shared disk-backed storage for project reference files and the file metadata collection.
**Owns collection(s):** files
**Boundary:** This directory is shared infrastructure and intentionally is not listed in `eslint.config.js` `MODULES`.

## Invariants
- `storedPath` is relative to `FILES_DIR` and is generated from a new ULID, never from a user path.
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
- Project scene replacement is delegated to the project service so file-store routes never write the `projects` collection.
- ZIP import accepts only root-level `scenes.json`; invalid or missing content returns 422 and a valid import replaces the entire scene array.
