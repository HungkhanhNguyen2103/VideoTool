# Phase 4 — accepted

Reviewed the Phase 4 commit series. All items verified:

- `applySceneAssets`: one atomic `updateOne` with dynamic array filters (`scene0`, `scene1`, …), `Map`-based dedup so the last update per `sceneId` wins, single `$inc: { version: 1 }`.
- ZIP import: malformed central directory → 422 `INVALID_ZIP`; per-entry extraction failure caught individually and pushed to `skipped[]` without aborting the batch; root-level-only filter (rejects entries containing `/` or `\`); image/video extension must match `scene.assetType` or the entry is skipped.
- Project duplication clears `assetFileId: null` on every scene — no orphaned file references copied into the new project.
- `MIME_BY_EXTENSION` / `expectedAssetType` tables match the approved spec exactly.
- 101 tests pass, 2 stubs skipped; typecheck/lint/build clean; `eslint.config.js` and dependencies unchanged.

The deferred items (no live-browser Studio check, no orphan-file GC) are correctly logged as known gaps rather than silently dropped — acceptable for this phase.

Phase 4 complete. Ready for Phase 5 (video/render module) — I'll prepare the design brief next.
