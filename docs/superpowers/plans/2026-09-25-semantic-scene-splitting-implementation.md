# Semantic Scene Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional queued Studio action that splits finalized narration scenes into visual beats while proving all narration remains verbatim.

**Architecture:** The script AI boundary adds a strict split response and cut-point prompt. A new script service validates each chapter response, replaces only multi-chunk scenes, and writes the complete state immediately inside the chapter loop; it reloads that state before deriving subsequent scene offsets. The existing route, worker, and Studio job patterns expose the optional operation.

**Tech Stack:** TypeScript, Zod 4, Express 5, MongoDB driver, React 19, TanStack Query, Vitest, mongodb-memory-server.

**Spec:** `docs/superpowers/specs/2026-09-25-semantic-scene-splitting-design.md`

## Global Constraints

- Run only as queued `split-scenes` work after the existing finalized-scene `SCENES_NOT_READY` guard succeeds.
- AI selects cut points only. Validate exact global indexes and whitespace-normalized verbatim reconstruction; retry validation failures exactly once.
- Skip without calling AI when a scene has `assetFileId`, `audioFileId`, or `sfxFileId`, or a nonempty `visualPrompt`.
- One chunk preserves the complete source `SceneDoc`; multiple chunks use fresh IDs, word-based durations, and finalized-scene empty downstream fields.
- Persist every validated chapter with `replaceProjectChapters` then `replaceProjectScenes` from inside the loop. Cancellation preserves prior writes and starts no next chapter.
- Do not change `finalizeScript`, `visual-prompts.ts`, QA, dependencies, or project ownership boundaries.
- Stage exact files only; never use `git add -A`, `git add .`, or `git commit -a`.

## Review Focus

- Whitespace-only differences pass, while a changed, omitted, or added word retries once then fails only its chapter. (Task 2)
- A chapter-one split shifts chapter-two global indexes before chapter two's request. (Task 2)
- Cancellation after a persisted chapter keeps it and makes no later request. (Task 2)
- One chunk preserves every source-scene field, not just its ID. (Task 2)
- The Studio control remains disabled through the enqueue-to-progress gap. (Task 4)

---

## File Structure

- `src/server/modules/script/ai/output-schema.ts`, `parse-output.ts`, `build-prompt.ts`: split response contract, parser, and prompt.
- `src/server/modules/script/scene-split.ts`, `scene-split-handler.ts`: durable orchestration and worker adapter.
- `src/server/modules/script/index.ts`, `routes.ts`, `src/worker/registry.ts`: public API, enqueue route, and registration.
- `src/client/features/asset/api.ts`, `StudioPage.tsx`: typed request and job-tracked control.
- `scene-split.test.ts`, `script.test.ts`, `worker.test.ts`, `asset-api.test.ts`: focused regression coverage.

### Task 1: Define the split AI contract

**Files:**
- Modify: `src/server/modules/script/ai/output-schema.ts`
- Modify: `src/server/modules/script/ai/parse-output.ts`
- Modify: `src/server/modules/script/ai/build-prompt.ts`
- Test: `src/server/modules/script/scene-split.test.ts`

**Interfaces:** Produces `SceneSplitBatchSchema`, `parseSceneSplitBatch(raw)`, `SceneSplitSceneInput`, and `buildSceneSplitPrompt(input)` for Task 2.

- [ ] **Step 1: Write failing schema/parser/prompt tests**

```ts
expect(parseSceneSplitBatch('{"scenes":[{"sceneIndex":1,"chunks":["First beat","second beat"]}]}'))
  .toEqual({ scenes: [{ sceneIndex: 1, chunks: ['First beat', 'second beat'] }] });
expect(() => parseSceneSplitBatch('{"scenes":[{"sceneIndex":0,"chunks":[]}]}'))
  .toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR' }));
expect(buildSceneSplitPrompt({ project, chapter, scenes: [{ sceneId: 'internal-id', sceneIndex: 4, narration: 'Exact source text.' }] }).user)
  .toContain('Scene 4\nNarration: Exact source text.');
```

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run src/server/modules/script/scene-split.test.ts`

Expected: FAIL because the parser and prompt builder are absent.

- [ ] **Step 3: Implement the strict contract and prompt**

```ts
export const SceneSplitBatchSchema = z.object({
  scenes: z.array(z.object({
    sceneIndex: z.number().int().positive(),
    chunks: z.array(z.string().min(1)).min(1),
  })),
});
export function parseSceneSplitBatch(raw: string): z.infer<typeof SceneSplitBatchSchema> {
  return validate(raw, SceneSplitBatchSchema);
}
```

Define `SceneSplitSceneInput` as `sceneId`, `sceneIndex`, and `narration`. Build a provider-neutral message containing project language/context, chapter number/title, each global index, and full narration. Include the approved exact-contiguous-substring/no-rewording/index-echo instruction; do not send internal IDs.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/server/modules/script/scene-split.test.ts`

Expected: PASS.

```bash
git add src/server/modules/script/ai/output-schema.ts src/server/modules/script/ai/parse-output.ts src/server/modules/script/ai/build-prompt.ts src/server/modules/script/scene-split.test.ts
git commit -m "feat(script): add scene split AI contract"
```

### Task 2: Implement durable chapter-by-chapter splitting

**Files:**
- Create: `src/server/modules/script/scene-split.ts`
- Modify: `src/server/modules/script/service.ts`
- Test: `src/server/modules/script/scene-split.test.ts`

**Interfaces:** Consumes Task 1 plus `getAiClient`, project public APIs, `estimateNarrationDurationSec`, and `newId`. Produces `SceneSplitJobContext`, `SceneSplitJobResult`, and `splitProjectScenes(projectId, context)` for Task 3.

- [ ] **Step 1: Write failing Mongo-backed orchestration tests**

```ts
expect(await splitProjectScenes(project.id, context())).toEqual({ splitScenes: 2, skippedChapters: 0, failedChapters: [] });
expect((await getProject(project.id)).scenes.map((scene) => scene.narration))
  .toEqual(['First visual beat', 'Second visual beat', 'Untouched']);
expect((await getProject(project.id)).chapters.map((chapter) => chapter.scenesCount)).toEqual([2, 1]);
```

Cover successful multi-chunk reconstruction/durations/counts; altered text retry-then-fail with no mutation; non-null asset skip with no provider call; exact one-chunk object preservation; whitespace normalization; chapter-one persistence shifting chapter-two's supplied index; and cancellation after chapter one preserving it while no chapter-two request occurs.

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/server/modules/script/scene-split.test.ts`

Expected: FAIL because `splitProjectScenes` is absent.

- [ ] **Step 3: Implement validation and replacement construction**

```ts
function normalizeNarration(value: string): string { return value.trim().replace(/\s+/gu, ' '); }
function validateReconstruction(batch: SceneSplitBatch, scenes: readonly SceneSplitSceneInput[]): void {
  const returned = new Map(batch.scenes.map((item) => [item.sceneIndex, item]));
  for (const scene of scenes) {
    if (normalizeNarration(returned.get(scene.sceneIndex)!.chunks.join(' ')) !== normalizeNarration(scene.narration)) {
      throw new AppError(`Scene ${scene.sceneIndex} does not reconstruct its source narration.`, 422, 'SCRIPT_PARSE_ERROR');
    }
  }
}
```

Reuse the visual-prompt exact-index check and its two-attempt validation retry. One chunk returns the original object. Multi-chunk output is `{ id: newId(), narration: chunk.trim(), visualPrompt: '', durationSec: estimateNarrationDurationSec(chunk), assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', sfxFileId: null }`. Document that `splitScenes += chunks.length - 1` per split source scene.

- [ ] **Step 4: Persist in the loop and refresh state**

Export the existing `snapshotOf` helper from `service.ts`. Capture it before the first changed chapter. Following every validated response, update that chapter's replacement scenes/count/duration, then persist the full ordered state and read it back:

```ts
await replaceProjectChapters(projectId, current.chapters, snapshot);
await replaceProjectScenes(projectId, flattenedScenes);
current = await getProject(projectId);
snapshot = null;
```

A validated no-op still persists with a null snapshot, per the approved per-chapter rule. Check cancellation before each chapter and request, after responses, and just before persistence. Catch/log provider or write errors per chapter, continue when safe, and report rounded chapter progress with the result.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/server/modules/script/scene-split.test.ts && npm run typecheck && npm run lint`

Expected: PASS.

```bash
git add src/server/modules/script/scene-split.ts src/server/modules/script/service.ts src/server/modules/script/scene-split.test.ts
git commit -m "feat(script): split finalized scenes by visual beat"
```

### Task 3: Add route and worker dispatch

**Files:**
- Create: `src/server/modules/script/scene-split-handler.ts`
- Modify: `src/server/modules/script/index.ts`
- Modify: `src/server/modules/script/routes.ts`
- Modify: `src/worker/registry.ts`
- Modify: `src/server/modules/script/script.test.ts`
- Modify: `src/worker/worker.test.ts`

**Interfaces:** Consumes `splitProjectScenes(projectId, context)`. Produces `POST /api/project/:id/scenes/split` and `jobHandlers['split-scenes']`.

- [ ] **Step 1: Write failing route/registry tests**

```ts
expect((await fetch(`${base}/api/project/${project.id}/scenes/split`, { method: 'POST' })).status).toBe(422);
expect(await getCollection<JobRecord>('jobs').countDocuments({ type: 'split-scenes' })).toBe(0);
expect((await fetch(`${base}/api/project/${finalized.id}/scenes/split`, { method: 'POST' })).status).toBe(201);
expect(await getCollection<JobRecord>('jobs').findOne({ type: 'split-scenes' }))
  .toMatchObject({ payload: { projectId: finalized.id } });
```

Mock the service in `worker.test.ts`, asserting payload/context forwarding and no service call for pre-cancelled work.

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/server/modules/script/script.test.ts src/worker/worker.test.ts`

Expected: FAIL because route and handler are absent.

- [ ] **Step 3: Implement the handler, route, and registry**

```ts
router.post('/:id/scenes/split', async (req, res) => {
  const project = await getProject(req.params.id);
  assertVisualPromptSourceReady(project);
  const job = await options.enqueueJob({ type: 'split-scenes', projectId: project.id, payload: { projectId: project.id } });
  res.status(201).json({ jobId: job.id });
});
```

Create a strict `{ projectId: z.string().min(1) }` handler with the visual-prompt pre-cancellation gate. Export its API from `script/index.ts` and register `'split-scenes': handleSplitScenes`.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/server/modules/script/script.test.ts src/worker/worker.test.ts`

Expected: PASS.

```bash
git add src/server/modules/script/scene-split-handler.ts src/server/modules/script/index.ts src/server/modules/script/routes.ts src/worker/registry.ts src/server/modules/script/script.test.ts src/worker/worker.test.ts
git commit -m "feat(script): queue semantic scene splitting"
```

### Task 4: Add Studio control and final verification

**Files:**
- Modify: `src/client/features/asset/api.ts`
- Modify: `src/client/features/asset/StudioPage.tsx`
- Modify: `src/client/features/asset/asset-api.test.ts`
- Modify: `src/server/modules/script/MODULE.md`

**Interfaces:** Consumes the Task 3 endpoint. Produces `splitScenes(projectId): Promise<{ jobId: string }>` and the `Tách nhỏ scene` action.

- [ ] **Step 1: Write the failing client test**

```ts
await expect(splitScenes('project/1')).resolves.toEqual({ jobId: 'job-1' });
expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/scenes/split', expect.objectContaining({ method: 'POST' }));
expect(isProjectJobActive('job-1', null)).toBe(true);
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/client/features/asset/asset-api.test.ts`

Expected: FAIL because `splitScenes` is absent.

- [ ] **Step 3: Implement typed API and job-tracked Studio handler**

```tsx
async function splitScenes() {
  try { setBusy('split-scenes'); const result = await api.splitScenes(projectId); setJobId(result.jobId); toast('Đã xếp hàng tách nhỏ scene.'); }
  catch (error) { toast(error instanceof Error ? error.message : 'Không thể tách nhỏ scene.'); }
  finally { setBusy(null); }
}
```

Place an `indigoline` `Tách nhỏ scene` button beside `Tạo visual prompt`, disabled by `busy !== null || scenes.length === 0 || api.isProjectJobActive(jobId, progress)`. Update `MODULE.md` with the optional verbatim-preserving job and per-chapter durability.

- [ ] **Step 4: Run full verification**

Run: `npx vitest run src/client/features/asset/asset-api.test.ts src/server/modules/script/scene-split.test.ts src/server/modules/script/script.test.ts src/worker/worker.test.ts && npm run typecheck && npm run lint && npm test && npm run build`

Expected: all commands exit 0, retaining only the pre-existing skipped project todo if reported.

- [ ] **Step 5: Inspect and commit exact files**

Run: `git diff --stat`

Confirm only Task 14 files plus the separately reviewed specification/plan are staged. Remove a zero-byte `.git/index.lock` only after confirming no Git process is running.

```bash
git add src/client/features/asset/api.ts src/client/features/asset/StudioPage.tsx src/client/features/asset/asset-api.test.ts src/server/modules/script/MODULE.md
git commit -m "feat(studio): add scene splitting action"
```

## Plan Self-Review

- Spec coverage: Tasks 1–2 cover contract, prompt, validation, retries, skips, identity, replacement shape, duration/count recomputation, progress, result accounting, and durable persistence. Task 3 covers readiness and worker dispatch. Task 4 covers client/UI and verification.
- Placeholder scan: every file, interface, test, command, and persistence rule is defined.
- Type consistency: `SceneSplitBatchSchema` → `parseSceneSplitBatch` → `splitProjectScenes` → `handleSplitScenes` → `jobHandlers['split-scenes']` → client `splitScenes`.
- Review focus: every listed risk is pinned by Task 2 or Task 4 tests.

