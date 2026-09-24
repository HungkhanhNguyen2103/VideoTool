# Phase 3 Prompt 1 — implementation plan approved

Plan `a88bcc9` is approved. Proceed with implementation Task 1 through Task 8.

One implementation note before starting Task 3 Step 6 (`finalizeScript`):

**Finalization must be atomic — two writes is not acceptable.**

The plan currently says "call `replaceProjectScenes`, then update project status to `assets` through the project service." Do not make two separate writes. Instead:

Extend the existing `replaceProjectScenes` method to accept an optional `newStatus?: ProjectStatus` parameter:

```ts
replaceProjectScenes(
  projectId: string,
  scenes: SceneDoc[],
  newStatus?: ProjectStatus,
): Promise<void>
```

Inside the method, when `newStatus` is provided, include `status: newStatus` in the same `$set`:

```ts
{ $set: { scenes, updatedAt: new Date(), ...(newStatus ? { status: newStatus } : {}) }, $inc: { version: 1 } }
```

`finalizeScript` then calls `replaceProjectScenes(projectId, scenes, 'assets')` — one atomic write, no inconsistent window between scene update and status change.

No other changes to the plan. Proceed.
