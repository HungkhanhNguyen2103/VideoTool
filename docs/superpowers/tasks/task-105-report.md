# Task 105 implementation report

Commit: `d45338c` (`fix(script): match Vietnamese shot and light cues without accent collisions`)

## Changes

- `src/server/modules/script/shot-plan.ts`: cue matching now normalizes narration to NFC and lowercase without stripping accents. English and accented Vietnamese cues use Unicode letter/mark boundaries. Accentless Vietnamese uses a separate whole-phrase fallback list; the collision-prone standalone forms `duoc`, `dem`, `toi`, `trang`, `phong`, `ham`, `hop`, `lua`, `chay`, `mua`, and `may` are excluded. Shot/light priority, rotation, first-scene wide, chapter-start behavior, and `LIGHT_ALTERNATIVE` remain unchanged.
- `src/server/modules/script/shot-plan.test.ts`: added 78 regression cases covering every listed false-positive word, the required accented cue groups, accentless fallback and collision behavior, three multi-word near-misses, NFC cue literals, uppercase `Đ` diacritic detection, English matching, and the realistic 10-scene passage. Existing assertions were unchanged; a namespace import was added only so the NFC test can inspect the cue table.
- `src/server/modules/script/MODULE.md` and `AGENTS.md`: documented matching and fallback rules, the collision rationale, and that stored plans on existing projects are not recomputed.

## Verification

- RED/GREEN: the initial regression run failed 26 cases while 87 existing/new cases passed; after the implementation, all 114 `shot-plan.test.ts` cases passed.
- Diacritic mutation check: temporarily removing `đ/Đ` from the detector made `Đ dem xuong.` incorrectly classify as `night`; restoring the detector passed both accented-path cases.
- Focused command `npx vitest run src/server/modules/script src/server/modules/asset src/client/features/asset`: 30 files passed, 597 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 101 files passed, 1 skipped file; 1269 tests passed.
- `npm run build`: passed. Vite emitted the existing informational chunk-size warning.
- The first database-backed focused run used the default MongoDB download and failed its MD5 check, causing setup timeouts. Re-running with the installed MongoDB 8.0 binary via `MONGOMS_SYSTEM_BINARY` passed the focused suite and full suite.

## Stored data and unverified items

Stored plans of existing projects are **not recomputed**. The planner continues to write only when a scene's visual prompt is empty, and prefilled scenes retain their saved plans. No project data was changed, no AI calls were made, and no browser or live-project verification was run; this task's matching behavior was verified with the automated planner tests above.

No unrelated files were staged or committed. The pre-existing unrelated untracked files remain in the working tree.
