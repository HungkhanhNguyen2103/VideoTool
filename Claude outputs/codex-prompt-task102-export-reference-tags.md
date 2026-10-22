# Task 102 — Export per-scene `referenceTags` in the Flow scenes JSON

Prerequisite: Task 101 is on `main` and its Vietnamese cue matching in `src/server/modules/script/shot-plan.ts` has been fixed (otherwise `lightType` is wrong for most Vietnamese scenes and these tags would be wrong too). If that fix is not on `main` yet, stop and tell me.

Work directly on `main` (no feature branch, no worktree). Never push. Do not stage temp files (`.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`). Keep LF line endings in commits. Follow AGENTS.md (rule 11: Status line in the same commit; import through each module's `index.ts`). Code, comments and commit messages are English.

## Why

The Studio "Export JSON" button (`GET /api/project/:id/scenes/export-json`, `exportScenesJson` in `src/server/modules/asset/service.ts`) produces the array that the external Google Flow runner imports. Each entry is `{ sceneId, sceneNumber, title, prompt, assetType, motionPrompt }`. The runner is being upgraded so that style reference images carry tags (`core`, `wide`, `interior`, `night`, `props`, …) and each scene can request tags, so that not every style reference is sent to every scene. Task 101 already stores `shotType` and `lightType` on each scene. This task derives `referenceTags` from them and adds the field to the export.

## Contract

In `src/contracts/asset.ts`, add to `FlowSceneExportSchema` an optional `referenceTags: z.array(z.string()).optional()`. All existing fields, their order and their meaning stay unchanged. The client keeps using the shared schema (`api.ts` `exportScenesJson`); verify that an export without the field and with the field both parse.

## Derivation (pure function, unit-tested)

Add `deriveReferenceTags(styleId: VisualStyleId, scene: { shotType: ShotType | null; lightType: LightType | null }): string[] | undefined`, next to the pack definitions in `src/contracts/visual-style-pack.ts` (or a small new contracts file exported the same way; if you put it elsewhere, say why):

1. If both `shotType` and `lightType` are `null` (legacy scene, no plan yet): return `undefined` so the field is omitted and the runner keeps today's behavior.
2. If `styleId === 'strategic-map'`: return `undefined` (that style's slots are map/combat/infographic and scene families are not planned yet).
3. Otherwise start with `['core']` and append, in this fixed order and without duplicates:
   - `'interior'` when `lightType === 'interior'`;
   - `'night'` when `lightType` is `'night'` or `'firelight'`;
   - `'wide'` when `shotType` is `'wide'` or `'high-angle'`;
   - `'props'` when `shotType === 'detail'`.
4. Keep only tags for which `isVisualStylePackSlot(styleId, tag)` is true (so the output never names a slot that style does not have).

`medium`, `close`, `low-angle`, `daylight`, `overcast` and `golden-hour` add nothing, so such a scene gets just `['core']` (only the core reference), which is intended.

## Export

In `exportScenesJson`, call the function with `project.visualStylePresetId` and the scene's persisted `shotType`/`lightType`, and add `referenceTags` after `motionPrompt` only when the result is defined. Inactive scenes remain omitted and original scene numbers are unchanged. Do NOT compute a plan at export time for scenes that have none; the persisted fields are the single source of truth.

## Tests

- Contract/unit tests for `deriveReferenceTags`: legacy (null/null) → undefined; strategic-map → undefined; every shot/light combination yields the expected list; no duplicates; order is fixed; tags are filtered to the style's slots.
- `src/server/modules/asset/asset.test.ts` (existing export tests around lines 459–500 and the route test near 655): planned scenes export `referenceTags`, legacy scenes do not, inactive scenes stay omitted, and the existing assertions on the other fields still pass unchanged.
- Client `asset-api.test.ts`: parsing an export array with and without `referenceTags`.

## Docs and Status

Update `src/server/modules/asset/MODULE.md` (Flow section: new optional field, derivation rules, strategic-map exception, no export-time planning) and add the AGENTS.md Status line in the same commit.

## Out of scope

Anything in the runner/Tool Builder, any Studio UI change, computing or backfilling plans for existing projects, a ZIP-import change, and the scene-split or prompt generation logic.

## Verification (run and report real output)

`npm run typecheck`, `npm run lint`, the touched and new vitest files plus `src/contracts`, `src/server/modules/asset`, `src/client/features/asset`, and `npm run build`. Include one real sample of the exported JSON for a project that has planned scenes (paste 6 entries) in the report. `app.test.ts` has a known pre-existing SPA fallback failure; do not fix it here.

## Report

Write `docs/superpowers/tasks/task-102-report.md` (untracked): commits, files changed, the final derivation table, verification, what you could not verify, any deviation. Commit message: `feat(asset): export per-scene referenceTags in Flow scenes JSON`. Do not push.
