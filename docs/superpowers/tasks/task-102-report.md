# Task 102 report — Flow scene reference tags

Date: 2026-10-16

## Commit and files

- Base commit: `cc34db1`. Final commit: `16f8543 feat(asset): export per-scene referenceTags in Flow scenes JSON`. No push.
- Contract and derivation: `src/contracts/asset.ts`, `asset.test.ts`, `visual-style-pack.ts`, `visual-style-pack.test.ts`.
- Export and coverage: `src/server/modules/asset/service.ts`, `asset.test.ts`, `MODULE.md`.
- Client parsing: `src/client/features/asset/asset-api.test.ts`.
- Project map: `AGENTS.md` Status.

## Final derivation table

The function returns `undefined` when both persisted plan fields are null or when the style is `strategic-map`. Otherwise it starts with `core`, appends candidates in this order, removes duplicates, and filters every tag through `isVisualStylePackSlot(styleId, tag)`.

| Persisted value | Candidate tag |
| --- | --- |
| Every planned non-map scene | `core` |
| `lightType: interior` | `interior` |
| `lightType: night` or `firelight` | `night` |
| `shotType: wide` or `high-angle` | `wide` |
| `shotType: detail` | `props` |
| `medium`, `close`, `low-angle`, `daylight`, `overcast`, `golden-hour` | no additional tag |

## Six-entry export sample

This output was produced by the real project persistence and `exportScenesJson` services using a disposable six-scene project in the local `video_tool_test` database. The disposable project was deleted after export.

```json
[
  {"sceneId":1,"sceneNumber":1,"title":"mo_dau_toan_canh_thung_lung","prompt":"Generated prompt 1","assetType":"image","motionPrompt":"","referenceTags":["core","wide"]},
  {"sceneId":2,"sceneNumber":2,"title":"cuoc_hop_dien_ra_trong_phong","prompt":"Generated prompt 2","assetType":"image","motionPrompt":"","referenceTags":["core","interior"]},
  {"sceneId":3,"sceneNumber":3,"title":"doi_quan_di_trong_dem","prompt":"Generated prompt 3","assetType":"image","motionPrompt":"","referenceTags":["core","night","wide"]},
  {"sceneId":4,"sceneNumber":4,"title":"can_canh_la_thu_ben_ngon_lua","prompt":"Generated prompt 4","assetType":"image","motionPrompt":"","referenceTags":["core","night","props"]},
  {"sceneId":5,"sceneNumber":5,"title":"guong_mat_nguoi_chi_huy_duoi_troi_am_u","prompt":"Generated prompt 5","assetType":"image","motionPrompt":"","referenceTags":["core"]},
  {"sceneId":6,"sceneNumber":6,"title":"mot_moi_de_doa_ap_dao_luc_hoang_hon","prompt":"Generated prompt 6","assetType":"image","motionPrompt":"","referenceTags":["core"]}
]
```

The sample uses Vietnamese narration, but its shot/light values were explicitly persisted for export verification. Light values inferred from Vietnamese narration in other projects may remain unreliable until the separate Task 101 cue fix lands. Task 102 does not modify or recompute shot/light plans.

## Verification

- Red phase: the client export parser dropped `referenceTags` under the previous schema; the new parser test failed with that exact difference.
- Contract and client tests: 3 files, 52 tests passed.
- MongoDB-backed asset tests: 1 file, 53 tests passed.
- Requested scopes (`src/contracts`, `src/server/modules/asset`, `src/client/features/asset`): 28 files and 217 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; Vite retains its informational chunk-size warning above 500 kB.
- Full suite with normal per-file isolation: 100 files passed, 1 skipped; 1170 tests passed.
- One diagnostic full-suite run with `--isolate=false` failed because shared module state leaked database connections and mocks across files. It was superseded by the clean isolated full-suite run above; the project requires its normal file isolation.

## Deviations and gaps

- No changes were made to `shot-plan.ts`, the runner, Studio UI, ZIP import, scene splitting, or prompt generation.
- No export-time plan computation or legacy backfill was added.
