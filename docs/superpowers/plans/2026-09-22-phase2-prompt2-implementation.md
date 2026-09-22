# Phase 2 Prompt 2 Files and Job Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add append-only job logs over SSE plus disk-backed reference files, upload/delete/list routes, and ZIP scene import while preserving module ownership and the Phase 2 boundaries.

**Architecture:** The job module gains a persisted `logs` array and handler `appendLog`; the existing SSE stream emits state data and named `log` events from the same poll. File-store is shared infrastructure outside `MODULES`, owns the `files` collection and disk writes, and exposes reference-file routes. ZIP scene replacement is delegated to a new public project service method so only the project module writes `projects`.

**Tech Stack:** TypeScript strict, Express 5, MongoDB driver, Zod, Multer memory storage, AdmZip, Vitest, mongodb-memory-server, React EventSource.

**Spec:** `docs/superpowers/specs/2026-09-22-phase2-prompt2-files-design.md` plus the approved SSE log-streaming review addendum in the Prompt 2 review.

## Global Constraints

- New dependencies are exactly `multer`, `adm-zip`, `@types/multer`, and `@types/adm-zip`; add nothing else.
- `src/server/modules/file-store/` is shared infrastructure and must not be added to `eslint.config.js`; do not modify that file.
- `logs` is append-only and defaults to `[]`; SSE state and named log events share the existing one-second poll.
- `replaceProjectScenes` is exported from the project module; its service performs the direct `findOneAndUpdate` and `$inc: { version: 1 }`.
- No UI wiring, `/files` static-serving changes, script/asset/video work, public job create/list endpoints, or push.
- Preserve untracked `Claude outputs/`; stage only files with real content changes.
- Every meaningful commit updates `AGENTS.md` Status and the relevant `MODULE.md` in the same commit.

## Review Focus

- Existing logs must flush on the first SSE connection before the poll timer starts; route test asserts ordered initial log frames.
- A later appended log must emit exactly once on the next poll and never be replayed; route test tracks `lastLogIndex`.
- A running handler's `appendLog` must update only its job and preserve lock/status; service/repository tests assert this.
- File writes must use generated IDs and a safe relative stored path even when `originalName` contains path separators; service test inspects the path.
- ZIP imports must require root-level `scenes.json`, return 422 for missing/invalid content, and replace rather than append scenes; route tests assert version increment and exact array.

---

### Task 1: Install approved dependencies and add persisted job logs

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/server/modules/job/docs.ts`
- Modify: `src/server/modules/job/repo.ts`
- Modify: `src/server/modules/job/service.ts`
- Modify: `src/server/modules/job/job.test.ts`
- Modify: `src/server/modules/job/MODULE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces `JobDoc.logs: string[]`, `appendJobLog(id, message): Promise<void>`, and `JobContext.appendLog(message): Promise<void>`.

- [ ] **Step 1: Install only the approved packages** with `npm install multer adm-zip` and `npm install -D @types/multer @types/adm-zip`; verify the diff contains no other dependency changes.
- [ ] **Step 2: Write failing tests** for default empty logs on enqueue, append-only repository update, and handler `ctx.appendLog` persistence while the job remains running/locked.
- [ ] **Step 3: Run `npm test -- src/server/modules/job/job.test.ts`** and verify the new tests fail because logs/context are absent.
- [ ] **Step 4: Implement** the schema field, `$push` repository operation, service context wiring, and factory updates; update module docs and Status/decisions in the same commit.
- [ ] **Step 5: Run `npm run typecheck`, `npm run lint`, and the focused job tests**; expected: all pass.
- [ ] **Step 6: Commit** `feat(job): add logs field and appendLog to job module`.

### Task 2: Stream logs over SSE and accumulate them in the client hook

**Files:**
- Modify: `src/server/modules/job/routes.ts`
- Modify: `src/server/modules/job/job.test.ts`
- Modify: `src/client/shared/hooks/use-job-progress.ts`
- Modify: `src/client/shared/hooks/use-job-progress.test.ts`
- Modify: `src/server/modules/job/MODULE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes `JobDoc.logs` and `appendJobLog` from Task 1.
- Produces SSE `event: log` frames with JSON string payloads; `JobProgressState.logs` accumulates client-side while `applyJobEvent` handles only main state data.

- [ ] **Step 1: Write failing tests** for existing logs on first SSE connect, one new log on the next poll, no replay, and client state shape with separate log accumulation.
- [ ] **Step 2: Run focused route/hook tests** and verify failures before implementation.
- [ ] **Step 3: Implement** `lastLogIndex = 0`, flush `logs[lastLogIndex...]` in the same immediate poll and each later poll, advance the index, emit `event: log\ndata: <JSON>`, and keep terminal closing behavior. Update the hook with `logs: []`, a named `log` listener, and cleanup on job change/unmount.
- [ ] **Step 4: Run `npm run typecheck`, `npm run lint`, focused tests, and full `npm test`**; expected: all pass.
- [ ] **Step 5: Commit** `feat(job): stream log events over SSE`, updating Status/docs together.

### Task 3: File contracts, document schema, indexes, repository, and test lifecycle

**Files:**
- Create: `src/contracts/file.ts`
- Create: `src/server/modules/file-store/docs.ts`
- Create: `src/server/modules/file-store/indexes.ts`
- Create: `src/server/modules/file-store/repo.ts`
- Create: `src/server/modules/file-store/index.ts`
- Create: `src/server/modules/file-store/MODULE.md`
- Modify: `src/server/db/ensure-indexes.ts`
- Create: `src/server/modules/file-store/file-store.test.ts`
- Modify: `src/test-utils/mongo.ts`
- Modify: `src/test-utils/factories.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces `FileSummary`, `FileDoc`, `ensureFileStoreIndexes`, and repository methods `insertFile`, `findFileById`, `deleteFileById`, `listFilesByProjectId`.

- [ ] **Step 1: Write failing repository/schema tests** for contract fields, insert/find/delete, project-scoped list, and both indexes.
- [ ] **Step 2: Run the focused file-store test** and verify failure from missing module files.
- [ ] **Step 3: Implement** contracts/docs/indexes/repository, export the public API, register indexes, and extend Mongo test cleanup to clear `files` while preserving existing job tests.
- [ ] **Step 4: Run `npm run typecheck`, `npm run lint`, and the focused file-store test**; expected: schema/repository tests pass.
- [ ] **Step 5: Commit** `feat(file-store): add contracts and repository`, including MODULE.md and AGENTS Status.

### Task 4: File-store service and safe disk operations

**Files:**
- Create: `src/server/modules/file-store/service.ts`
- Modify: `src/server/modules/file-store/index.ts`
- Modify: `src/server/modules/file-store/file-store.test.ts`
- Modify: `src/server/modules/file-store/MODULE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces constructor-injected `createFileStoreService(filesDir)`, `storeFile`, `deleteFile`, and `listProjectFiles`.

- [ ] **Step 1: Write failing service tests** for disk write + summary/doc, extension fallback from MIME, path-separator sanitization, ENOENT-tolerant delete, unknown-id `NotFound`, and project-scoped list.
- [ ] **Step 2: Run the focused service tests** and verify failure before service implementation.
- [ ] **Step 3: Implement** generated `{newId}.{ext}` paths relative to `filesDir`, `fs/promises.writeFile`, DB insert after successful write, ENOENT-tolerant delete, and summary mapping.
- [ ] **Step 4: Run focused tests plus `npm run typecheck` and `npm run lint`**; expected: all pass.
- [ ] **Step 5: Commit** `feat(file-store): implement disk-backed reference service`, documenting orphan-file GC as a Phase 6+ gap.

### Task 5: Project scene replacement, upload middleware, and file routes

**Files:**
- Modify: `src/server/modules/project/repo.ts`
- Modify: `src/server/modules/project/service.ts`
- Modify: `src/server/modules/project/index.ts`
- Create: `src/server/shared/upload.ts`
- Create: `src/server/modules/file-store/routes.ts`
- Modify: `src/server/modules/file-store/index.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/shared/errors.ts`
- Modify: `src/server/error-handler.ts`
- Modify: `src/server/modules/file-store/file-store.test.ts`
- Modify: `src/server/modules/file-store/MODULE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces project public `replaceProjectScenes(id, scenes): Promise<ProjectDetail>` and `fileStoreRouter` with reference upload/list/delete and ZIP import routes.

- [ ] **Step 1: Write failing route tests** for valid PNG 201, disallowed MIME 400 with `INVALID_FILE_TYPE`, cross-project delete 404, project 404 checks, and Multer size-limit mapping.
- [ ] **Step 2: Run focused route tests** and verify failure before middleware/router implementation.
- [ ] **Step 3: Implement** Multer memory storage and per-route limits, MIME validation, project existence/ownership checks, service calls, and public route mounting at `/api/project` without changing `eslint.config.js`.
- [ ] **Step 4: Implement** `replaceProjectScenes` inside the project service using `findOneAndUpdate` with `$set` scenes/updatedAt and `$inc` version, then return `getProject(id)`; export it from the project index.
- [ ] **Step 5: Add 422 error support** for missing/invalid ZIP content with field errors while preserving existing 400 Zod behavior elsewhere.
- [ ] **Step 6: Run focused route tests, `npm run typecheck`, and `npm run lint`**; expected: upload/list/delete and error mappings pass.
- [ ] **Step 7: Commit** `feat(file-store): add reference upload and project file routes`, updating Status/docs in the same commit.

### Task 6: ZIP scene import implementation and end-to-end tests

**Files:**
- Modify: `src/server/modules/file-store/routes.ts`
- Modify: `src/server/modules/file-store/file-store.test.ts`
- Modify: `src/server/modules/file-store/MODULE.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write failing ZIP route tests** for valid root `scenes.json` replacement/version increment, missing root file 422 `MISSING_SCENES_JSON`, invalid scene schema 422 field errors, and ZIP MIME rejection.
- [ ] **Step 2: Run the focused file-store test** and verify failure before ZIP route implementation.
- [ ] **Step 3: Implement** AdmZip parsing from the in-memory buffer, root-entry lookup (reject nested-only `scenes.json`), JSON parsing, `SceneDocSchema` array validation, call `replaceProjectScenes`, and return updated `ProjectDetail`.
- [ ] **Step 4: Run focused tests and full `npm test`**; expected: all file-store, job, project, and existing tests pass.
- [ ] **Step 5: Commit** `feat(file-store): add ZIP scene import`, documenting replace-not-merge semantics.

### Task 7: Full acceptance verification and documentation

**Files:**
- Modify: `AGENTS.md`
- Modify: `src/server/modules/file-store/MODULE.md`

- [ ] **Step 1: Run** `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
- [ ] **Step 2: Confirm** dependency diff contains only the four approved packages, `eslint.config.js` is unchanged, no UI files were added, no public job create/list routes were added, and `Claude outputs/` remains untracked.
- [ ] **Step 3: Run a Windows smoke check** against local MongoDB using multipart upload, list/delete, valid ZIP import, missing/invalid ZIP responses, and worker/SSE regression checks.
- [ ] **Step 4: Update AGENTS Status to Phase 2 Prompt 2 complete, record exact test/build counts, note orphan-file GC gap, and mark ready for Phase 3 script module; update file-store MODULE.md acceptance evidence.
- [ ] **Step 5: Commit** `docs(phase2): record file store and import acceptance` with documentation only.

## Expected Final Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

No push will be performed. The final report will list the checklist, commits, verification commands/counts, decisions outside the spec, blockers/open questions, and readiness for Phase 3.
