# Phase 2 Job Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the MongoDB-backed job queue, worker loop, SSE progress endpoint, and reusable client progress hook described by the approved Phase 2 design.

**Architecture:** The `job` module owns the `jobs` collection and exposes repository/service APIs plus only cancel and SSE HTTP routes. The worker claims jobs atomically through the service, drains available work while checking shutdown state between claims, and uses an explicit empty handler registry. The client hook consumes SSE without wiring it into a page.

**Tech Stack:** TypeScript strict, Express 5, official MongoDB driver, Zod contracts, Vitest, mongodb-memory-server, React EventSource.

**Spec:** `docs/superpowers/specs/2026-09-22-phase2-job-design.md`

## Global Constraints

- No public `GET /api/job` list endpoint and no public `POST /api/job` create endpoint.
- No real asset, voice, or video handlers; `worker/registry.ts` remains an explicit empty map.
- No file-store, upload, ZIP, or `eslint.config.js` boundary changes.
- Code/docs/commit messages are English; existing UI copy remains Vietnamese.
- Preserve untracked `Claude outputs/`; stage only files with actual content changes.
- Every meaningful commit updates `AGENTS.md` Status and `modules/job/MODULE.md` as required by rule 11.
- Use `mongodb-memory-server`; if binary download fails, use the documented local MongoDB fallback and record the ruling.

## Review Focus

- A first SSE poll must emit the current state immediately, including an already-terminal job; route test asserts one initial event and stream closure.
- A second worker claim in one drain tick must stop when shutdown begins; worker loop test uses a closing flag between claims.
- A running cancellation must preserve the worker lock and expose cooperative cancellation; service test checks `cancelRequested` without changing `running`.
- Retry scheduling must increment attempts and use bounded exponential delay; service test checks `runAt` and terminal-attempt behavior.
- Two concurrent claimers must produce at most one running job; repository test races two claims and asserts one winner.

---

### Task 1: Contracts, documents, indexes, and module documentation

**Files:**
- Create: `src/contracts/job.ts`
- Modify: `src/server/modules/job/docs.ts`
- Modify: `src/server/modules/job/indexes.ts`
- Modify: `src/server/modules/job/MODULE.md`
- Modify: `src/server/db/ensure-indexes.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces `JOB_STATUSES`, `JobStatus`, `JobSummary`, `JobDoc`, and the jobs index definition for later repository/service tasks.

- [ ] **Step 1: Write the failing contract/index test** in `src/server/modules/job/job.test.ts` asserting the status enum, required `cancelRequested`, and index registration shape.
- [ ] **Step 2: Run `npm test -- src/server/modules/job/job.test.ts`** and verify it fails because the contract and index exports are absent.
- [ ] **Step 3: Implement** the Zod contract, Mongo document schema/type, `{ status: 1, runAt: 1 }` index, explicit `ensureJobIndexes`, and complete `MODULE.md` ownership/import/invariant documentation. Update `AGENTS.md` data model and Phase 2 status without changing unrelated decisions.
- [ ] **Step 4: Run `npm run typecheck` and the focused test**; expected: both pass.
- [ ] **Step 5: Commit** `feat(job): add queue contracts and collection schema` with only the listed files.

### Task 2: Mongo test utilities and repository operations

**Files:**
- Modify: `src/test-utils/mongo.ts`
- Modify: `src/test-utils/factories.ts`
- Create: `src/server/modules/job/repo.ts`
- Modify: `src/server/modules/job/job.test.ts`
- Modify: `src/server/modules/job/MODULE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes `JobDoc` and index definitions from Task 1.
- Produces repository functions `insertJob`, `claimNextJob`, `updateProgress`, `markDone`, `markFailed`, `requestCancel`, `findJobById`, and `recoverStaleJobs`.

- [ ] **Step 1: Write failing repository tests** for insert/find, oldest-first claim, empty claim, progress, retry/terminal failure, queued/running cancellation, stale recovery, and the concurrent claim race.
- [ ] **Step 2: Run the focused repository tests** and verify failure from missing repository/test setup.
- [ ] **Step 3: Implement shared Mongo test lifecycle** using `MongoMemoryServer`, with deterministic collection cleanup and an environment-detectable fallback path for local MongoDB when binary download is unavailable. Implement atomic `findOneAndUpdate` claim with `returnDocument: 'after'`, lock-preserving progress, terminal/retry transitions, cancellation CAS behavior, and stale recovery.
- [ ] **Step 4: Run `npm test -- src/server/modules/job/job.test.ts`**; expected: all repository cases pass, including exactly one winner in the concurrent race.
- [ ] **Step 5: Commit** `feat(job): implement Mongo queue repository` and document any memory-server fallback in `AGENTS.md` Status in the same commit.

### Task 3: Job service and public module API

**Files:**
- Create: `src/server/modules/job/service.ts`
- Modify: `src/server/modules/job/index.ts`
- Modify: `src/server/modules/job/job.test.ts`
- Modify: `src/server/modules/job/MODULE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes repository operations from Task 2.
- Produces `enqueueJob`, `getJob`, `cancelJob`, `computeBackoffMs`, `recoverStaleJobs`, `claimAndRun`, `JobContext`, and `JobHandler` through `index.ts`.

- [ ] **Step 1: Add failing service tests** for default enqueue fields, summary mapping, NotFound/Conflict behavior, clamped progress, success, unknown-handler terminal failure, retry backoff, max-attempt terminal failure, and cooperative cancellation.
- [ ] **Step 2: Run the focused tests** and verify missing service exports fail.
- [ ] **Step 3: Implement** service orchestration with `computeBackoffMs(attempts) = min(2 ** attempts * 1000, 30000)`, five-minute stale threshold, handler context, cancellation checks before handler invocation, and one-job `claimAndRun`.
- [ ] **Step 4: Run focused tests plus `npm run lint`**; expected: service behavior and module boundaries pass.
- [ ] **Step 5: Commit** `feat(job): add queue service and public API`, updating module docs and AGENTS Status/decisions in the same commit.

### Task 4: Routes, app mounting, and SSE behavior

**Files:**
- Create: `src/server/modules/job/routes.ts`
- Modify: `src/server/modules/job/index.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/modules/job/job.test.ts`
- Modify: `src/server/modules/job/MODULE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes `getJob`, `cancelJob`, and summary mapping from Task 3.
- Produces `createJobRouter()` exposing only `POST /:id/cancel` and `GET /:id/events`.

- [ ] **Step 1: Write failing route tests** for cancel success/404 and SSE unknown-job 404 plus a terminal stream that emits the current state immediately and closes.
- [ ] **Step 2: Run route tests** and verify missing router/mount failures.
- [ ] **Step 3: Implement** SSE with `lastState = undefined` so the first poll always emits, one-second polling, 15-second heartbeat comments, change-only subsequent events, request-close cleanup, and terminal close. Mount only `/api/job` in `app.ts`.
- [ ] **Step 4: Run route tests, `npm run typecheck`, and `npm run lint`**; expected: route and boundary checks pass.
- [ ] **Step 5: Commit** `feat(job): expose cancel and SSE progress routes`, updating Status/docs together.

### Task 5: Worker registry and guarded poll loop

**Files:**
- Modify: `src/worker/registry.ts`
- Modify: `src/worker/main.ts`
- Create: `src/worker/worker.test.ts`
- Modify: `AGENTS.md`
- Modify: `src/server/modules/job/MODULE.md`

**Interfaces:**
- Consumes `claimAndRun`, `recoverStaleJobs`, and `JobHandler` from the job public API.
- Produces an explicit `jobHandlers: Record<string, JobHandler> = {}` and a testable poll-loop helper used by `main.ts`.

- [ ] **Step 1: Write failing worker tests** for recovery each tick, drain behavior, no overlapping tick, and closing checked between claims.
- [ ] **Step 2: Run `npm test -- src/worker/worker.test.ts`** and verify failure before the loop helper exists.
- [ ] **Step 3: Implement** the empty registry and guarded loop: recover every tick, repeatedly claim until empty or `closing`, check `closing` before each claim, await current tick on shutdown, clear timer, close DB, and retain forced-shutdown timeout behavior.
- [ ] **Step 4: Run worker tests and `npm run typecheck`**; expected: all pass.
- [ ] **Step 5: Commit** `feat(worker): run guarded job polling loop`, updating Status/docs in the same commit.

### Task 6: Client SSE hook

**Files:**
- Modify: `src/client/shared/hooks/use-job-progress.ts`
- Create: `src/client/shared/hooks/use-job-progress.test.tsx`
- Modify: `AGENTS.md`
- Modify: `src/server/modules/job/MODULE.md`

**Interfaces:**
- Consumes `/api/job/:id/events` and returns `{ status, progress, error } | null` plus connection state as defined in the hook.

- [ ] **Step 1: Write failing hook tests** for null job ID, EventSource creation/parsing, job change cleanup, and unmount cleanup.
- [ ] **Step 2: Run the focused hook test** and verify failure because the hook is empty.
- [ ] **Step 3: Implement** `useJobProgress(jobId)` with EventSource lifecycle, JSON parsing, state updates, and cleanup.
- [ ] **Step 4: Run hook tests, `npm run typecheck`, and `npm run lint`**; expected: client and boundary checks pass.
- [ ] **Step 5: Commit** `feat(client): add reusable job progress SSE hook`, updating Status/docs together.

### Task 7: Full verification, real worker smoke test, and acceptance docs

**Files:**
- Modify: `AGENTS.md`
- Modify: `src/server/modules/job/MODULE.md`

- [ ] **Step 1: Run** `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`; capture results and fix only implementation defects using RED→GREEN tests.
- [ ] **Step 2: Run a boundary scan** confirming no forbidden public create/list job routes and no `eslint.config.js` changes.
- [ ] **Step 3: Start the built worker against the configured local MongoDB, observe startup and idle ticks, send SIGINT/SIGTERM, and verify clean shutdown without modifying `.env`.
- [ ] **Step 4: Update AGENTS Status to Phase 2 Prompt 1 complete, list verification evidence, fallback decisions, and readiness for Prompt 2; update MODULE.md state and pitfalls.
- [ ] **Step 5: Commit** `docs(phase2): record queue acceptance verification` with only documentation changes.

## Expected Final Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

The final report will include the checklist, changed files, verification commands, rulings made outside the spec, open questions, and whether the repository is ready for Prompt 2. No push will be performed.
