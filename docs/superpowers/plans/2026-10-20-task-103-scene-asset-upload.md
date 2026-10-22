# Task 103 Per-scene Asset Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe per-scene image, clip, and keyframe upload/removal controls to Studio while preserving ZIP import behavior.

**Architecture:** Asset service helpers classify and validate the entire request before storage, prepare clip metadata, perform one atomic project mutation, and then clean newly orphaned or displaced files conservatively. Shared contracts drive Express responses and an XHR client; React Query hooks refresh project/file caches and the detail dialog owns upload progress.

**Tech Stack:** TypeScript, Express, Multer, MongoDB, React, TanStack Query, Vitest.

**Spec:** `C:/Users/Admin/.codex/attachments/2d74aa34-a3d7-4ddb-b657-3b704cebe786/Pasted text.txt`

## Global Constraints

- Work directly on `main`, do not push, and commit only Task 103 source/tests/docs with `feat(asset): per-scene asset and keyframe upload in Studio`.
- Follow red-green-refactor; keep ZIP import behavior unchanged.
- Validate the full file combination before storing; probe video before the project write; apply clip and keyframe in one `applySceneAssets` call.
- Clean every newly stored file if preparation or mutation fails, and only warn when cleanup itself fails.
- Re-read the project before deleting displaced files and retain any file still referenced by any file-ID-bearing project field.
- Keep `docs/superpowers/tasks/task-103-report.md` untracked.

## Review Focus

- Mutation conflict after video and tail storage removes both new files.
- Clip-only, keyframe-only, and combined replacement preserve untouched slots and identify every displaced ID.
- Shared references across scene audio/SFX/depth and root render/logo/thumbnail fields prevent deletion.
- Inactive, empty, duplicate-kind, mismatched MIME/extension, image-size, request-size, and probe failures make no project write.
- UI state and cache refresh remain correct after progress, failure, deletion, and successful replacement.

---

### Task 1: Server contracts, validation, persistence, and cleanup

**Files:**
- Modify: `src/contracts/asset.ts`, `src/server/shared/upload.ts`, `src/server/modules/asset/service.ts`, `src/server/modules/asset/routes.ts`, `src/server/modules/asset/index.ts`
- Test: `src/contracts/asset.test.ts`, `src/server/modules/asset/asset.test.ts`

**Interfaces:**
- Produces `uploadSceneAssets(projectId, sceneId, files)` and `removeSceneAsset(projectId, sceneId, slot)` plus shared response schemas.

- [ ] Add failing contract and server tests for all accepted combinations, stable Vietnamese errors, inactive scenes, atomic writes, mutation-failure cleanup, displacement, conservative references, no-op deletion, and cleanup warnings.
- [ ] Run the focused tests and confirm the new expectations fail.
- [ ] Implement multipart middleware, service helpers, routes, response parsing, and conservative cleanup.
- [ ] Run the focused tests and confirm they pass without changing ZIP behavior.

### Task 2: Client transport, cache hooks, UI state, and Studio controls

**Files:**
- Modify: `src/client/features/asset/api.ts`, `src/client/features/asset/hooks.ts`, `src/client/features/asset/StudioPage.tsx`, `src/client/features/asset/StudioPage.module.css`
- Create: `src/client/features/asset/scene-asset-upload-ui.ts`, `src/client/features/asset/scene-asset-upload-ui.test.ts`
- Test: `src/client/features/asset/asset-api.test.ts`, `src/client/features/asset/hooks.test.ts`, `src/client/features/asset/StudioPage.test.ts`

**Interfaces:**
- Consumes Task 1 upload/removal routes and response types.
- Produces XHR upload progress, removal API, mutation options, and pure control-state helpers.

- [ ] Add failing API, hook, pure-helper, and Studio source/render tests.
- [ ] Run focused client tests and confirm the new expectations fail.
- [ ] Implement APIs, hooks, progress/error state, file inputs, buttons, hints, preview clearing, and styling.
- [ ] Run focused client tests and confirm they pass.

### Task 3: Documentation, acceptance, review, and delivery

**Files:**
- Modify: `src/server/modules/asset/MODULE.md`, `AGENTS.md`
- Create untracked: `docs/superpowers/tasks/task-103-report.md`

- [ ] Run focused suites, typecheck, scoped lint, full tests with the installed MongoDB binary, and build.
- [ ] Verify a disposable duplicate at 1920x1080 for image and video upload/replacement/removal, inactive controls, wrong-file feedback, fit-to-clip, and reload persistence.
- [ ] Request a fresh whole-change review and fix any Critical or Important findings with red-green coverage.
- [ ] Document behavior, verification, external-reference limitations, and any deviations; update the Status line.
- [ ] Commit only Task 103 tracked files with the required message and verify the final diff/status.
