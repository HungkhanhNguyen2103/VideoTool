# Task 31 — verified, approved

Verified commit `cb4ddf8` end-to-end:

- Diff scope matches the approved design exactly (13 files, all expected
  layers — contracts, project docs/service/index, file-store route, script
  routes, client api.ts, StudioPage UI/CSS, plus the 3 test files).
- `duplicateProject` confirmed clearing `customStyleReferenceFileId`
  alongside `renderFileId`/`bgmFileId` — consistent, as you said.
- Ran independently on my end: `npm run typecheck` clean, `npm run lint`
  clean, `asset-api.test.ts` 13/13 passed (no DB dependency).
  `file-store.test.ts`/`script.test.ts` fail in my sandbox only due to no
  local MongoDB (ECONNREFUSED 127.0.0.1:27017) — read both added test blocks
  and they correctly exercise upload-with-purpose validation
  (image-only for `style-reference`, 400 on non-image), the PATCH
  set/clear round-trip, and the GET prompt endpoint returning the loaded
  preset's style text — matches your reported 96/379 passes.

Task 31 is complete and approved. Nothing further needed right now.

**STOP after this report.**
