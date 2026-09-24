# Phase 3 Prompt 1 — accepted

Reviewed commits `1e3a3a7` through `bd502b6`. All items verified:

- `ChapterDocSchema`/`ChapterSnapshotSchema` live in `contracts/script.ts`; no script file calls `getCollection('projects')` in runtime code.
- `replaceProjectScenes` extended to accept `newStatus?: ProjectStatus`; `finalizeScript` sets scenes + `status: 'assets'` in one atomic write.
- Abort path in `regenerateChapter`: `needs-fix` persisted in catch, old paragraphs preserved, no `done` event emitted.
- SSE route: `closed` flag prevents writes after disconnect; `res.on('close')` is the reliable signal once headers are sent.
- `patchChapter` normalises paragraph edits to `status: 'pending'` automatically.
- `eslint.config.js` unchanged; `openai` and `@anthropic-ai/sdk` are the only new runtime deps.
- 81 tests pass, 3 stubs skipped (confirmed on Windows); worker smoke confirmed `worker started` + clean SIGINT shutdown.

Phase 3 complete. Ready for Phase 4 (asset module).
