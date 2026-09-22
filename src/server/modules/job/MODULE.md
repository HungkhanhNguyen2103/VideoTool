# Module: job

**Purpose:** Generic job queue in MongoDB: enqueue, claim, progress, cancel, recover stuck jobs. No business logic.
**Owns collection(s):** jobs
**May import (via their index.ts only):** none
**Public API:** only what `index.ts` exports. Nothing else in this module may be imported from outside.

## Invariants
- Every job document has `schemaVersion: 1`, a string ULID `_id`, and a valid status.
- Only this module writes the `jobs` collection; worker handlers receive jobs through the public API.
- A running job keeps its worker lock while cancellation is cooperative through `cancelRequested`.
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
- Stale recovery requeues old running jobs and clears their lock fields.

## Known pitfalls
- Do not release a running lock from the cancel route; the worker owns terminal transitions.
- SSE emits the current state on the first poll, then only changed state and periodic heartbeats.
- Stale recovery uses a five-minute threshold so future long-running handlers are not reclaimed every poll.
- Keep `worker/registry.ts` explicit and empty until later asset/video phases add handlers.
