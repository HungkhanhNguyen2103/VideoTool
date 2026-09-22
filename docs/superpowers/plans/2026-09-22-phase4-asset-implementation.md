# Phase 4 Asset Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Studio asset workflow: scene asset metadata, Flow JSON export, tolerant ZIP import through `file-store`, project-owned scene mutations, asset routes, and the Studio client page.

**Architecture:** `project` remains the only writer of embedded scenes. The new `asset` module orchestrates Flow export and ZIP import through public `project` and `file-store` APIs; it owns no MongoDB collection. The client resolves preview URLs from the additive `FileSummary.storedPath` field and never reads disk directly.

**Tech Stack:** TypeScript strict, Express 5, Zod, official MongoDB driver, `adm-zip`, multer memory storage, React, TanStack Query, CSS Modules, Vitest, `mongodb-memory-server`.

**Spec:** `docs/superpowers/specs/2026-09-22-phase4-asset-design.md`

## Global Constraints

- No new npm dependencies; reuse the existing `adm-zip`, multer, MongoDB, and file-store infrastructure.
- `project` is the sole writer of `projects`; asset code must use only public project APIs and must not call `getCollection('projects')`.
- Re-import replaces `assetFileId` silently; orphaned old files are a documented gap and are not deleted in this phase.
- `applySceneAssets` is one atomic `projects.updateOne` with dynamic array filters and one version increment; duplicate scene IDs use last-value-wins.
- ZIP uploads are limited to 200 MB and accept only `application/zip` or `application/x-zip-compressed`.
- Only root-level `SCENE_{N:3-digit}_{anything}.{ext}` files are considered; invalid entries are skipped without aborting valid entries.
- Image extensions must match `assetType: image`; video extensions must match `assetType: video`.
- `storedPath` is exposed additively in `FileSummary`; no `assetUrl` is persisted on scenes and no `project -> file-store` import is added.
- `asset` is already present in `eslint.config.js` and already allows `project`/`job`; leave `eslint.config.js` unchanged.
- Every meaningful commit updates `AGENTS.md` `## Status` and `src/server/modules/asset/MODULE.md` in the same commit.
- Stage exact changed files only; never use `git add -A` or `git add .`; never push; preserve untracked `Claude outputs/`.

## Review Focus

1. Legacy scene documents missing asset fields are read with `assetType: 'image'` and `assetFileId: null`, and finalization writes explicit defaults.
2. Mixed ZIP entries (valid, malformed, unsupported, wrong type, out-of-range, and nested) continue successfully with an exact `skipped[]` list.
3. Duplicate scene numbers and repeated imports do not create ambiguous scene updates; the last duplicate mapping wins and re-import replaces the reference.
4. `applySceneAssets` updates the intended embedded scenes in one write and increments `version` once, without a per-scene write loop.
5. Upload size/MIME/ZIP errors use the established `{ error: { code, message, fields? } }` response shape.

---

### Task 1: Extend shared scene/file contracts

**Files:**
- Modify: `src/contracts/project.ts: SceneSchema`
- Modify: `src/contracts/file.ts: FileSummarySchema`
- Modify: `src/server/modules/project/docs.ts: SceneDocSchema`
- Modify: `src/server/modules/script/service.ts: finalizeScript scene construction`
- Test: `src/server/modules/asset/asset.test.ts` (create the test harness and schema/default tests)
- Modify: `AGENTS.md` (`## Status`)
- Modify: `src/server/modules/asset/MODULE.md` (replace stub invariants with contract ownership notes)

**Interfaces:**
- Consumes: existing `SceneSchema`, `SceneDocSchema`, `FileSummarySchema`, and script finalization scene creation.
- Produces: `Scene`/`SceneDoc` with required inferred `assetType: 'image' | 'video'` and `assetFileId: string | null`; `FileSummary` with `storedPath: string`.

- [ ] **Step 1: Create the asset test harness and write failing contract tests.**

  Add `asset.test.ts` with `beforeAll(startTestMongo)`, `afterAll(closeTestMongo)`, project/job cleanup, a temporary `filesDir`, and tests that parse a legacy project scene without the two new fields through `getProject`, expecting `image`/`null`. Add a `FileSummarySchema.parse` assertion requiring `storedPath`.

- [ ] **Step 2: Run the focused tests to verify they fail.**

  Run: `npm test -- src/server/modules/asset/asset.test.ts -t "defaults|storedPath" --reporter=verbose`

  Expected: FAIL because the schemas do not yet contain the fields and `asset.test.ts` is only a stub.

- [ ] **Step 3: Add the contract defaults and adapt finalization.**

  Add to both scene schemas:

  ```ts
  assetType: z.enum(['image', 'video']).default('image'),
  assetFileId: z.string().nullable().default(null),
  ```

  Add `storedPath: z.string()` to `FileSummarySchema`. Update `finalizeScript` to construct scenes with `assetType: 'image'` and `assetFileId: null`, so persisted final scenes do not rely on an implicit parse.

- [ ] **Step 4: Run the focused tests to verify they pass.**

  Run: `npm test -- src/server/modules/asset/asset.test.ts -t "defaults|storedPath" --reporter=verbose`

  Expected: PASS, including defaults on a document read through the project service.

- [ ] **Step 5: Update documentation and commit.**

  Mark `asset` as `partial` (contracts in place) in `AGENTS.md`; document the scene/file contract and no-collection ownership in `MODULE.md`. Run `npm run typecheck` and commit:

  ```bash
  git add src/contracts/project.ts src/contracts/file.ts src/server/modules/project/docs.ts src/server/modules/script/service.ts src/server/modules/asset/asset.test.ts AGENTS.md src/server/modules/asset/MODULE.md
  git commit -m "feat(contracts): extend SceneDoc with asset references"
  ```

### Task 2: Add project-owned scene asset mutation APIs

**Files:**
- Modify: `src/server/modules/project/service.ts`
- Modify: `src/server/modules/project/index.ts`
- Test: `src/server/modules/asset/asset.test.ts` (project mutation tests)
- Modify: `AGENTS.md` (`## Status`)
- Modify: `src/server/modules/asset/MODULE.md` (project ownership/invariants)

**Interfaces:**
- Consumes: `SceneDoc`, `ProjectDetail`, MongoDB `updateOne`, and the contract defaults from Task 1.
- Produces: `patchProjectScene`, `setProjectScenesAssetType`, and `applySceneAssets`, all returning refreshed `ProjectDetail` and incrementing project `version` on writes.

- [ ] **Step 1: Write failing tests for all three public methods.**

  Seed one project with three scenes. Test that `patchProjectScene` changes only `visualPrompt`/`assetType` for one scene; `setProjectScenesAssetType` changes every scene; and `applySceneAssets` changes two scene IDs. Capture `version` before/after and assert bulk application increments it exactly once. Add duplicate updates and expect the last `assetFileId` to win.

- [ ] **Step 2: Run the focused tests to verify they fail.**

  Run: `npm test -- src/server/modules/asset/asset.test.ts -t "patchProjectScene|setProjectScenesAssetType|applySceneAssets" --reporter=verbose`

  Expected: FAIL because the project service methods are not exported.

- [ ] **Step 3: Implement targeted atomic updates.**

  `patchProjectScene` uses `$set: { 'scenes.$[scene].<field>': value, updatedAt }`, `arrayFilters: [{ 'scene.id': sceneId }]`, and `$inc: { version: 1 }`. `setProjectScenesAssetType` uses `$set: { 'scenes.$[].assetType': assetType, updatedAt }`. `applySceneAssets` deduplicates by scene ID, validates all IDs from `getProject`, builds paths `scenes.$[s0].assetFileId`, `scenes.$[s1].assetFileId`, and passes one array filter per path in one `updateOne`. Empty updates return `getProject` without writing; missing project/scene uses existing 404 behavior. Export all three methods from `project/index.ts`.

- [ ] **Step 4: Run the focused tests and boundary checks.**

  Run: `npm test -- src/server/modules/asset/asset.test.ts -t "patchProjectScene|setProjectScenesAssetType|applySceneAssets" --reporter=verbose` and `npm run lint`.

  Expected: PASS with one version increment for the bulk update and no new boundary violation.

- [ ] **Step 5: Update documentation and commit.**

  Mark project asset mutation APIs as implemented while keeping `asset` partial; update `MODULE.md` to state that all scene writes remain in project. Commit:

  ```bash
  git add src/server/modules/project/service.ts src/server/modules/project/index.ts src/server/modules/asset/asset.test.ts AGENTS.md src/server/modules/asset/MODULE.md
  git commit -m "feat(project): add scene asset mutation methods"
  ```

### Task 3: Implement Flow export, ZIP import, routes, and app wiring

**Files:**
- Create/modify: `src/server/modules/asset/docs.ts`
- Create/modify: `src/server/modules/asset/service.ts`
- Create/modify: `src/server/modules/asset/routes.ts`
- Modify: `src/server/modules/asset/index.ts`
- Modify: `src/server/shared/upload.ts`
- Modify: `src/server/app.ts`
- Test: `src/server/modules/asset/asset.test.ts` (basic export/import/route RED tests, then edge cases)
- Modify: `AGENTS.md` (`## Status`)
- Modify: `src/server/modules/asset/MODULE.md`

**Interfaces:**
- Consumes: project APIs from Task 2, `createFileStoreService(filesDir).storeFile`, `adm-zip`, `FlowSceneExport`, and the existing error handler.
- Produces: `configureAssetModule`, `exportScenesJson`, `importAssetsFromZip`, `assetRouter`, and `uploadAssetZip` behavior mounted under `/api/project`.

- [ ] **Step 1: Write failing service and route tests.**

  Add a valid project with two scenes and a root-level `SCENE_001_Opening.png` ZIP. Assert export numbering and import `{ updated: 1, skipped: [] }`; assert `GET /scenes/export-json` returns JSON with the attachment header and `POST /scenes/import-assets` stores the file and sets the scene reference. Add invalid MIME and missing-file route cases.

- [ ] **Step 2: Run the focused tests to verify they fail.**

  Run: `npm test -- src/server/modules/asset/asset.test.ts -t "export|import-assets|invalid MIME" --reporter=verbose`

  Expected: FAIL because the asset router/service functions and app mount do not exist.

- [ ] **Step 3: Implement pure export and configured file-store orchestration.**

  Define extension/MIME tables and the root filename parser in `asset/docs.ts`. Implement `exportScenesJson(project)` with one-based numeric IDs and accent-stripped, underscore-separated titles from the first 60 narration characters. Implement `configureAssetModule(filesDir)` by storing `createFileStoreService(filesDir).storeFile`; `importAssetsFromZip` parses entries, applies the review-approved skip/type rules, stores accepted files with purpose `reference`, and calls `applySceneAssets` once.

- [ ] **Step 4: Implement upload middleware and thin routes.**

  Add `uploadAssetZip = multer({ storage: memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } }).single('file')`. Add the four routes with zod body validation and error codes `FILE_REQUIRED`, `INVALID_FILE_TYPE`, `INVALID_ZIP`, and the existing `FILE_TOO_LARGE`. Set `Content-Disposition` exactly to `attachment; filename="scenes-export.json"` for export. Mount `assetRouter` after `fileStoreRouter` in `app.ts` and call `configureAssetModule(options.filesDir)` during app composition.

- [ ] **Step 5: Run the basic tests and build the server.**

  Run: `npm test -- src/server/modules/asset/asset.test.ts -t "export|import-assets|invalid MIME" --reporter=verbose` and `npm run typecheck`.

  Expected: PASS, with files written only beneath the temporary files directory.

- [ ] **Step 6: Update documentation and commit.**

  Document the Flow round trip, filename/MIME tables, configured file-store dependency, 200 MB route, and no-collection ownership in `MODULE.md`; mark `asset` partial in `AGENTS.md`. Commit:

  ```bash
  git add src/server/modules/asset/docs.ts src/server/modules/asset/service.ts src/server/modules/asset/routes.ts src/server/modules/asset/index.ts src/server/shared/upload.ts src/server/app.ts src/server/modules/asset/asset.test.ts AGENTS.md src/server/modules/asset/MODULE.md
  git commit -m "feat(asset): add Flow export and ZIP import service/routes"
  ```

### Task 4: Complete asset integration and edge-case tests

**Files:**
- Modify: `src/server/modules/asset/asset.test.ts`
- Modify: `src/server/modules/file-store/file-store.test.ts` (storedPath response assertion)
- Modify: `AGENTS.md` (`## Status`)
- Modify: `src/server/modules/asset/MODULE.md` (verification evidence)

**Interfaces:**
- Consumes: the complete Task 1–3 asset/project/file-store APIs.
- Produces: regression coverage for every service/route behavior in the Phase 4 verification strategy.

- [ ] **Step 1: Add failing edge tests.**

  Extend `asset.test.ts` with unsupported extension, filename mismatch, out-of-range `SCENE_999`, nested entry, type mismatch, mixed valid+skipped import, re-import overwrite, duplicate scene-number last-value-wins, empty ZIP, 200 MB limit, route scene patch validation, bulk asset-type route, and file summary `storedPath` assertions. Verify old scenes receive defaults and invalid ZIP maps to 422 `INVALID_ZIP`.

- [ ] **Step 2: Run the edge tests to verify each new expectation is initially red where behavior is missing.**

  Run: `npm test -- src/server/modules/asset/asset.test.ts src/server/modules/file-store/file-store.test.ts --reporter=verbose`

  Expected: any uncovered implementation mismatch is reported before changing production behavior; existing unrelated suites remain green.

- [ ] **Step 3: Adjust only implementation defects exposed by the tests.**

  Preserve the approved contracts: do not add a second write loop, do not fail the whole ZIP for skipped entries, do not add dependencies, and do not change `eslint.config.js`.

- [ ] **Step 4: Run the complete server test suite.**

  Run: `npm test`

  Expected: all existing Phase 1–3 tests plus asset/file-store tests pass; `mongodb-memory-server` runs successfully or its exact fallback is recorded.

- [ ] **Step 5: Update documentation and commit.**

  Record the test count and Mongo binary outcome in `AGENTS.md` and `MODULE.md`. Commit:

  ```bash
  git add src/server/modules/asset/asset.test.ts src/server/modules/file-store/file-store.test.ts AGENTS.md src/server/modules/asset/MODULE.md
  git commit -m "feat(asset): add Flow import integration tests"
  ```

### Task 5: Build the Studio client workflow

**Files:**
- Create: `src/client/features/asset/api.ts`
- Create: `src/client/features/asset/StudioPage.tsx`
- Create: `src/client/features/asset/StudioPage.module.css`
- Test: `src/client/features/asset/asset-api.test.ts`
- Modify: `src/client/app/router.tsx`
- Modify: `AGENTS.md` (`## Status`)
- Modify: `src/server/modules/asset/MODULE.md` (client acceptance notes)

**Interfaces:**
- Consumes: `ProjectDetail`, `FileSummary` with `storedPath`, asset routes from Task 3, existing `api-client`, `Button`, `Badge`, toast store, and React Query conventions.
- Produces: `/production/:projectId/studio`, typed `getProject`, `listProjectFiles`, `exportScenesJson`, `patchScene`, `setAllAssetType`, and `importAssetsZip` APIs.

- [ ] **Step 1: Add pure API/serialization tests where no DOM is required.**

  Add a dependency-free test for the exported `fileUrlForSummary(file)` helper: a stored basename becomes `/files/{storedPath}` and no arbitrary path is accepted. Keep request wiring covered by TypeScript and route tests; do not add jsdom/testing-library or any npm dependency. Page rendering remains manual in this phase.

- [ ] **Step 2: Run the focused client tests to verify the new API is red.**

  Run: `npm test -- src/client/features/asset/asset-api.test.ts --reporter=verbose`

  Expected: FAIL until the typed API module and helper exist.

- [ ] **Step 3: Implement the typed API module.**

  Use the shared API client for JSON endpoints. `exportScenesJson` parses `FlowSceneExport[]`; `importAssetsZip` uses `XMLHttpRequest`, `FormData`, `upload.onprogress`, and the established error shape. Add `listProjectFiles` for preview mapping and a pure `fileUrlForSummary(file)` helper that joins the safe generated `storedPath` to `/files/`; create/download helpers without server-side file access.

- [ ] **Step 4: Implement StudioPage and route it.**

  Load project and file metadata, render the header actions/toggle/progress counter, one editable card per scene, image/video/no-asset previews, skipped-file disclosure, and toast states. Use `/files/${storedPath}` only for a file whose `projectId` and `id` match the scene. Disable actions while their request is pending and refresh both project/files after mutations. Replace the Studio `ComingSoonPage` route with `StudioPage`.

- [ ] **Step 5: Run client verification.**

  Run: `npm run typecheck`, `npm run lint`, and `npm run build`.

  Expected: no boundary changes, no server imports in client code, and a successful Vite/tsup build. Record the existing chunk-size warning if it remains.

- [ ] **Step 6: Update documentation and commit.**

  Mark `asset` partial or done according to the verified server/client state, add the Studio route and manual-browser limitation to `AGENTS.md`/`MODULE.md`, then commit:

  ```bash
  git add src/client/features/asset/api.ts src/client/features/asset/asset-api.test.ts src/client/features/asset/StudioPage.tsx src/client/features/asset/StudioPage.module.css src/client/app/router.tsx AGENTS.md src/server/modules/asset/MODULE.md
  git commit -m "feat(client): add Studio asset workflow"
  ```

### Task 6: Phase 4 acceptance and documentation

**Files:**
- Modify: `AGENTS.md`
- Modify: `src/server/modules/asset/MODULE.md`

**Interfaces:**
- Consumes: all Phase 4 implementation commits and verification output.
- Produces: final acceptance ledger and an accurate Phase 4 status, with no code changes unless verification found a documented defect.

- [ ] **Step 1: Run the full acceptance commands on the final tree.**

  Run:

  ```text
  npm run typecheck
  npm run lint
  npm test
  npm run build
  ```

  Also run the built worker smoke (`node --env-file=.env dist/worker.js`, then Ctrl+C) and a boundary scan confirming `eslint.config.js` is unchanged and asset runtime code has no direct project collection access.

- [ ] **Step 2: Perform the manual Studio check.**

  With MongoDB and the dev server running, open `/production/:projectId/studio`, verify copy/download JSON, prompt edit, image/video toggle, ZIP import with skipped entries, preview URLs, and the `X / Y` asset counter. Record any browser-only limitation rather than adding DOM dependencies.

- [ ] **Step 3: Update acceptance documentation and commit.**

  Set `asset` to `done` only after the commands and manual checks are verified. Update `AGENTS.md` Status, endpoints, client screens, known gaps, decisions log, and next step; update `MODULE.md` acceptance evidence. Commit:

  ```bash
  git add AGENTS.md src/server/modules/asset/MODULE.md
  git commit -m "docs(phase4): record asset module acceptance"
  ```
