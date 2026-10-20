# Module: job

**Purpose:** Generic job queue in MongoDB: enqueue, claim, progress, cancel, recover stuck jobs. No business logic.
**Owns collection(s):** jobs
**May import (via their index.ts only):** none
**Public API:** only what `index.ts` exports. Nothing else in this module may be imported from outside.

## Invariants
- Every job document has `schemaVersion: 1`, a string ULID `_id`, and a valid status.
- Only this module writes the `jobs` collection; worker handlers receive jobs through the public API.
- A running job keeps its worker lock while cancellation is cooperative through `cancelRequested`; `claimAndRun` renews `lockedAt` every 60 seconds against the five-minute recovery threshold.
- Handler logs are bounded to the most recent 1,000 entries, with each UTF-8 message limited to 8 KiB, so log growth alone stays below MongoDB's 16 MiB document limit.
- Attempts increment only when a worker atomically claims a queued job.
- Progress is clamped to 0–100 and terminal jobs do not re-enter the queue.

## Flow
- Internal callers enqueue jobs; the worker atomically claims and runs them through the explicit registry.
- Handlers report progress and observe cancellation through `JobContext`.
- Failed jobs retry with bounded exponential backoff until `maxAttempts`, then become terminal.
- The HTTP API exposes only cancellation and SSE progress events; creation/listing remain internal.

## Repository surface
- `claimNextJob` uses an atomic oldest-first query on `{ status: 'queued', runAt: { $lte: now } }`.
- Progress and terminal transitions preserve worker ownership until the worker marks the job done or failed.
- `heartbeatJob` refreshes `lockedAt` only while the same worker owns a running job; stale recovery requeues jobs whose five-minute lease was not renewed.

## Service surface
- Internal callers use `enqueueJob`; public callers receive only `JobSummary` through `getJob`/`cancelJob`.
- `claimAndRun` owns handler context, retry backoff, unknown-type failure, and terminal transitions.
- `claimAndRun` starts and clears the lease heartbeat around the handler; it still does not impose a whole-job timeout.
- Handler logs are persisted before the handler completes, truncated per entry, rolled to the newest 1,000 messages, and streamed separately from state events.

## HTTP surface
- `POST /api/job/:id/cancel` returns the current summary after requesting cancellation.
- `GET /api/job/:id/events` sends the current `{ status, progress, error, result }` immediately, with `result: null` before terminal and the persisted result only after terminal, then deltas and a named `heartbeat` event every 15 seconds until terminal. Heartbeat data is a timestamp; clients use it to keep long-running job progress from appearing stale when no log or progress delta is due.
- The same SSE stream sends existing and newly appended log lines as named `log` events, tracked by an index so each line is emitted once.
- Task 93 browser acceptance exposed that the client did not refresh its liveness timestamp on an SSE heartbeat. The route now emits the documented named event, and `useJobProgress` records heartbeat arrival so the shared blocking dialog remains cancellable and does not report a live CLI process as disconnected.

## Worker integration
- `worker/main.ts` calls `recoverStaleJobs` every poll tick and drains claims while checking its closing flag between jobs.
- `worker/registry.ts` is an explicit empty `Record<string, JobHandler>` until asset/video phases register handlers.

## Client integration
- `useJobProgress(jobId)` opens one `EventSource` per non-null job id and closes it on id change/unmount.
- `applyJobEvent` is dependency-free and keeps state parsing testable without a DOM test dependency.

## Acceptance
- Repository/service/routes/worker tests run against `mongodb-memory-server` on Windows.
- Final verification: typecheck, lint, 33 tests passed (4 stub files skipped), production build, boundary scan, and built-worker SIGINT smoke test.

## Known pitfalls
- Do not release a running lock from the cancel route; the worker owns terminal transitions.
- SSE emits the current state on the first poll, then only changed state and periodic heartbeats.
- Stale recovery uses a five-minute threshold; `claimAndRun` renews active leases every 60 seconds so long-running handlers are not reclaimed every poll.
- Keep `worker/registry.ts` explicit; script, asset, and video handlers are registered there as their job flows are implemented.
- Task 6/6 final integration audit confirms queued script generation and manual Final QA cancellation, registry delegation, and terminal-only result exposure through SSE; existing client job-event parsing remains compatible with the additive `result` field.
