# Review: Phase 2 Prompt 2 spec + SSE log streaming addition

## 1. File-store spec — approved, one note

The spec is correct and consistent with the design brief. One call-out worth making explicit: the decision to introduce `replaceProjectScenes` as a new public project-service method (rather than letting the file-store route write the `projects` collection directly) is the right call — it preserves module ownership cleanly. Make sure `replaceProjectScenes` is exported from `src/server/modules/project/index.ts` and that the project service (not the repo) performs the `findOneAndUpdate` with `$inc: { version: 1 }`.

Everything else in the spec proceeds as written.

---

## 2. SSE log streaming — add to this prompt now

Extend the job module (Phase 2 Prompt 1 work) as part of this implementation run. This must land before Phase 3 handlers run real work.

### 2a. `JobDoc` — add `logs` field

In `src/server/modules/job/docs.ts`, add:
```ts
logs: z.array(z.string()),   // append-only; default [] on insert
```

In `src/server/modules/job/repo.ts`, add:
```ts
appendJobLog(id: string, message: string): Promise<void>
// { $push: { logs: message }, $set: { updatedAt: new Date() } }
```

### 2b. Service — expose `appendLog` in handler context

In `src/server/modules/job/service.ts`, update `JobHandlerContext` (or whatever the context type is named):
```ts
appendLog: (message: string) => Promise<void>
```

Wire it to `repo.appendJobLog(job._id, message)` when building the context inside `claimAndRun`.

### 2c. SSE endpoint — stream log events separately

In `routes.ts`, the SSE handler gains a `lastLogIndex` counter (starts at 0).

On each poll tick:
1. Fetch current job (as now).
2. Emit state delta if `stateOf(job)` changed (as now).
3. For each `job.logs[lastLogIndex...]`, emit:
   ```
   event: log
   data: "the log message"

   ```
   Then advance `lastLogIndex`.
4. Close on terminal state (as now).

On first connect, send current state immediately (as now) and also flush any existing log entries with the same loop.

No separate poll timer for logs — they ride the existing 1-second poll. This means up to ~1s of log latency, which is acceptable.

### 2d. Client hook — accumulate logs

In `src/client/shared/hooks/use-job-progress.ts`, update:

```ts
export type JobProgressState = {
  status: string;
  progress: number;
  error: string | null;
  logs: string[];   // accumulated client-side; never reset mid-stream
};
```

In the hook, handle the named `log` event type:
```ts
source.addEventListener('log', (e: MessageEvent<string>) => {
  const line = JSON.parse(e.data) as string;
  setState((prev) => prev ? { ...prev, logs: [...prev.logs, line] } : null);
});
```

Initial state should include `logs: []`. The `applyJobEvent` pure function should merge logs (append, not replace) — but since log events are separate, the `applyJobEvent` function only handles the main data event (state payload), which no longer includes a `logs` field. Keep them separate.

### 2e. Tests for log streaming

Add to `job.test.ts` (or a new describe block):
- `appendJobLog` inserts a message into the logs array.
- SSE route: after appending a log, the next poll emits an `event: log` frame with the correct message.
- SSE route: logs already present on first connect are emitted before the poll timer starts.

---

## 3. Commit order suggestion

1. `feat(job): add logs field and appendLog to job module` — docs.ts + repo + service context
2. `feat(job): stream log events over SSE` — routes.ts + hook update
3. `feat(file-store): contracts/docs/indexes/repo/service`
4. `feat(file-store): multer upload, reference and ZIP routes`
5. `feat(file-store): tests`
6. `docs(phase2): record phase 2 prompt 2 acceptance`

---

## 4. Proceed

Confirmed: proceed to implementation plan, then code. No further spec changes needed.
