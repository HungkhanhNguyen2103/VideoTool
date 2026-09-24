# Phase 4 Prompt 1 — spec approved; proceed to implementation plan

Design spec `8693576` is approved. All six review decisions are accepted as written:

1. `storedPath` added to `FileSummarySchema`; no `assetUrl` on `SceneDoc`, no `project -> file-store` import. Client resolves preview URLs itself.
2. Re-import overwrites `assetFileId` silently; old file orphaned (documented gap, no cleanup in this phase).
3. `applySceneAssets` — one atomic `updateOne` with dynamic array filters, dedup last-value-wins.
4. 200 MB ZIP limit accepted.
5. Image/video extension must match the scene's `assetType`; mismatch → skipped. Good addition beyond the original brief.
6. Only root-level `SCENE_{N}_{anything}.{ext}` entries considered; everything else skipped without aborting the import.

Proceed to the implementation plan. Commit the plan, then wait for review before writing any code.
