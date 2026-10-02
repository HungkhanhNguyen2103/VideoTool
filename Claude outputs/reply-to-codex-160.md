# Task 62 — Manual chapter import must keep restore history

Found in review of `9a87a09`: `POST /:id/chapters/:chapterId/regenerate/manual-import` calls `applyRegeneratedChapter` (`src/server/modules/script/service.ts`), which calls `patchProjectChapter(...)` WITHOUT a snapshot. The automatic path (`regenerateChapter`) takes `snapshotOf(project.chapters)` before writing, and `patchProjectChapter` pushes it to `chapterHistory` (max 10) so "Khôi phục" can undo. As a result, a manual import silently overwrites the chapter and cannot be restored.

## Change
1. In the manual-import route (or inside `applyRegeneratedChapter` via an optional `snapshot` parameter — choose the smaller change, and keep the automatic path's behavior identical: it must still snapshot exactly once, at the same point as today), take `snapshotOf(project.chapters)` BEFORE applying the imported chapter and pass it as the third argument to `patchProjectChapter` for the chapter write.
2. Take the snapshot only after the JSON has been parsed successfully. Order: parse/validate → snapshot → apply. Invalid JSON (422 `SCRIPT_PARSE_ERROR`) must not add a history entry and must leave the chapter unchanged.
3. The follow-up write that marks the next chapter `upstream-changed` must NOT push a second snapshot.
4. Do not change any client code unless an existing test needs updating.

## Tests
- Manual import of valid JSON adds exactly one `chapterHistory` entry whose chapters equal the pre-import state.
- `restoreChapters` with that entry brings the chapter back to its previous paragraphs.
- Invalid JSON → 422, chapter unchanged, `chapterHistory` length unchanged.
- Automatic regenerate still adds exactly one history entry (existing test).
- History cap of 10 still holds after repeated manual imports.

## Verification
Typecheck, lint, full tests pass. One commit: `fix(script): snapshot chapters on manual import`. Report the hash, files changed, tests added. No `.env` changes, no deletions, no secrets in the report.
