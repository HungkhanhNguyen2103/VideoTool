# Phase 2 Prompt 1: Job Queue, Worker Loop, and SSE Progress

## Goal

Add the generic MongoDB-backed job foundation used by later asset and video modules. The job module owns queue state and exposes internal enqueue/claim/progress/cancel/recovery APIs plus two public HTTP operations: cancellation and progress events.

## Scope and constraints

- The `job` module owns the `jobs` collection and imports no other business module.
- No real asset, voice, or video handlers are implemented in this phase.
- `worker/registry.ts` remains an explicit empty handler map until Phase 4/5.
- There is no public `GET /api/job` list endpoint and no public `POST /api/job` create endpoint.
- No file-store, reference upload, or ZIP import work is included.
- Existing ESLint boundary rules remain unchanged.
- Code, comments, commit messages, and documentation are English; UI strings remain Vietnamese.

## Data model

`JobDoc` is the single source of truth for the `jobs` collection:

```ts
{
  _id: string;
  schemaVersion: 1;
  type: string;
  projectId: string;
  payload: unknown;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lockedBy: string | null;
  lockedAt: Date | null;
  progress: number;
  result: unknown;
  error: string | null;
  cancelRequested: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

`cancelRequested` is required because a running handler needs a cooperative cancellation signal without allowing another process to release or mutate its lock. The collection has an index `{ status: 1, runAt: 1 }` for claim and recovery queries.

The public `JobSummary` contract exposes ISO date strings and omits internal lock/payload details:

```ts
{
  id: string;
  type: string;
  projectId: string;
  status: JobStatus;
  progress: number;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
}
```

## Module boundaries

### Repository

`repo.ts` contains Mongo queries only:

- `insertJob(doc)` inserts a validated document.
- `claimNextJob(lockedBy)` atomically matches an eligible queued job, sets `running`/lock fields, increments `attempts`, and returns the post-update document.
- `updateProgress(id, progress, result?)` updates progress and optional result while preserving the worker-owned lock.
- `markDone(id, result)` sets terminal success fields and clears lock fields.
- `markFailed(id, error, { willRetry, nextRunAt })` either requeues with a future `runAt` or marks terminal failure, and clears lock fields.
- `requestCancel(id)` atomically sets `cancelRequested`; queued jobs become `cancelled`, while running jobs retain `running` and their lock.
- `findJobById(id)` reads one job.
- `recoverStaleJobs(staleBeforeMs)` requeues old running jobs and clears their lock fields.

### Service

`service.ts` validates inputs and orchestrates repository operations:

- `enqueueJob({ type, projectId, payload, maxAttempts = 3 })` creates a queued job with `attempts: 0`, `progress: 0`, `runAt: now`, null result/error/locks, and `cancelRequested: false`.
- `getJob(id)` maps a document to `JobSummary` and throws `NotFound` when absent.
- `cancelJob(id)` throws `NotFound` for missing jobs and `Conflict` for terminal jobs. Queued jobs become cancelled; running jobs receive only `cancelRequested`.
- `computeBackoffMs(attempts)` returns `min(2 ** attempts * 1000, 30000)`.
- `recoverStaleJobs()` uses a five-minute stale threshold. This is deliberately much larger than the two-second poll interval so a slow future handler is not immediately reclaimed.
- `claimAndRun(handlers, lockedBy)` claims at most one job, checks cancellation before invoking a handler, supplies `reportProgress` and `isCancelled`, marks success/failure, and applies retry backoff. An unknown job type is marked failed without retry because the registry is explicit and empty in this phase.

Handlers use:

```ts
type JobContext = {
  reportProgress: (pct: number) => Promise<void>;
  isCancelled: () => Promise<boolean>;
};
type JobHandler = (job: JobDoc, ctx: JobContext) => Promise<unknown>;
```

Progress is clamped to 0–100 before persistence. The worker-owned lock is not released by cancellation; only the worker transitions a running job to a terminal state.

## HTTP routes

`routes.ts` exposes only:

1. `POST /api/job/:id/cancel` calls `cancelJob` and returns the current `JobSummary`.
2. `GET /api/job/:id/events` opens an SSE stream, returns `404` before headers for an unknown job, polls every one second, sends a JSON event only when status/progress/error changes, emits a `: heartbeat` comment every 15 seconds, and closes immediately after sending a terminal state.

The SSE timer and heartbeat timer are cleared on request close, and no stream remains alive after a terminal event.

## Worker loop

`worker/main.ts` connects to MongoDB, logs `worker started`, and runs a guarded poll loop at `WORKER_POLL_MS`:

1. Recover stale jobs on every tick.
2. Drain available jobs by repeatedly calling `claimAndRun`.
3. Check `closing` before every claim so SIGINT/SIGTERM stops a new claim promptly.

The loop uses a single in-flight tick guard to prevent overlapping polls. Shutdown clears the timer, sets `closing`, waits for the current tick/handler to finish, closes MongoDB, and exits with the existing forced-shutdown timeout pattern.

`worker/registry.ts` exports:

```ts
import type { JobHandler } from '../server/modules/job';

export const jobHandlers: Record<string, JobHandler> = {};
```

## Client hook

`useJobProgress(jobId)` creates an `EventSource` only when `jobId` is non-null, parses each event as `{ status, progress, error }`, updates React state, and closes the source on unmount or job change. No Phase 2 page consumes the hook; Phase 4/5 will wire it to asset/video UI.

## Verification strategy

- Use `mongodb-memory-server` with shared test setup/teardown. If the binary cannot be downloaded on Windows, use a dedicated real MongoDB test database, clean collections between tests, and document that decision.
- Unit/service/repository tests cover enqueue, oldest-first claim, empty claim, progress, retry and terminal failure, queued/running/terminal cancellation, stale recovery, and a concurrent claim race.
- Route tests mount `createApp` after connecting test MongoDB and cover cancel success/404 plus a terminal SSE stream that emits one state and closes.
- Run the worker against the real local MongoDB after build with an empty queue; verify startup, repeated idle polling, and clean SIGINT/SIGTERM shutdown.
- Run typecheck, lint, full tests, build, boundary scan, and client-bundle secret scan before completion.

## Decisions recorded for this phase

- `cancelRequested` is persisted to support cooperative cancellation without breaking worker ownership of a running lock.
- The worker drains the queue in one tick but checks `closing` between claims; this gives low latency without delaying shutdown behind a new batch.
- Stale recovery runs every tick with a five-minute threshold; the indexed update is cheap, and the threshold protects long-running future handlers.
- There are no demo handlers or public job creation/list endpoints; later modules enqueue through the internal API.
