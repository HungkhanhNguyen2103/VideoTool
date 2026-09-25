# Visual Prompt SFX Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend visual-prompt generation so each scene can receive an optional AI-suggested SFX prompt, with safe retroactive backfill and concurrency-protected persistence.

**Architecture:** Keep the existing visual-prompt job and retry/cancellation flow. Extend its JSON response and prompt input with `sfxPrompt`, then extend the project-owned atomic mutation to set visual and SFX fields independently in one `findOneAndUpdate`, each guarded by its own empty-current-value array filter. Reprocess chapters unless every scene has both fields populated, while keeping the public visual-prompt job result shape stable and reporting SFX fills in logs.

**Tech Stack:** TypeScript, Zod 4, MongoDB driver `findOneAndUpdate` with array filters, Vitest with `mongodb-memory-server`.

**Spec:** `docs/superpowers/specs/2026-09-25-visual-prompt-sfx-design.md`

## Global Constraints

- `sfxPrompt` is optional in AI input and defaults to `''` when omitted.
- Non-empty SFX suggestions are at most 120 characters, describe short ambient/foley audio, and use the narration language; empty is valid.
- Existing `visualPrompt` and `sfxPrompt` values are never overwritten, with independent current-value guards.
- A chapter is skipped only when every scene has both a non-empty `visualPrompt` and a non-empty `sfxPrompt`.
- `VisualPromptJobResult` keeps its existing shape; SFX counts appear in chapter and final logs.
- Existing prompt retry, cancellation, failure isolation, style-note continuity, per-scene SFX generation, and bulk SFX generation remain unchanged.
- Preserve existing callers that pass updates containing only `sceneId` and `visualPrompt`; `sfxPrompt` must remain optional in the mutation update type.
- Stage exact files only; never use `git add -A`, `git add .`, or `git commit -a`.

## Review Focus

- An omitted `sfxPrompt` in an older provider response parses as `''` and does not cause a retry or database write. (Task 1 parser test)
- A prompt input with an existing SFX value includes it verbatim, while an empty value renders `(none)`. (Task 1 prompt-boundary test)
- A scene with a filled visual prompt but empty SFX prompt is reprocessed for backfill, while a scene with both fields filled is skipped. (Task 3 orchestration tests)
- A concurrent edit to only `sfxPrompt` cannot be overwritten while another SFX target in the same atomic update still changes. (Task 2 project-service test)
- A scene with a filled SFX prompt but empty visual prompt still receives a visual update without changing its existing SFX value. (Task 2/3 field-independence tests)

---

### Task 1: Extend the visual-prompt AI contract and prompt

**Files:**

- Modify: `src/server/modules/script/ai/output-schema.ts`
- Modify: `src/server/modules/script/ai/build-prompt.ts`
- Test: `src/server/modules/script/ai/prompt-boundary.test.ts`

**Interfaces:**

- `VisualPromptBatchSchema` produces prompt items with `sceneIndex: number`, required non-empty `visualPrompt: string`, and defaulted `sfxPrompt: string`.
- `VisualPromptSceneInput` gains required `sfxPrompt: string`.
- `buildVisualPromptPrompt` requires the current scene SFX value and returns the same `BuiltPrompt` shape.

- [ ] **Step 1: Update prompt-boundary fixtures and add failing assertions**

Update every `buildVisualPromptPrompt` scene fixture with `sfxPrompt`. Add assertions that the system contract names `{sceneIndex, visualPrompt, sfxPrompt}`, explains short ambient/foley-or-empty behavior, and that the user prompt contains:

```ts
expect(result.user).toContain('Existing SFX prompt: Existing wind');
```

Add an empty-scene case asserting `Existing SFX prompt: (none)`. Update parser cases so a response with `sfxPrompt: 'wind through trees'` parses, an omitted field parses as `sfxPrompt: ''`, and a 121-character SFX value throws `SCRIPT_PARSE_ERROR`.

- [ ] **Step 2: Run the focused boundary test and verify it fails**

Run:

```bash
npx vitest run src/server/modules/script/ai/prompt-boundary.test.ts
```

Expected: FAIL because the input type, contract field, prompt line, and parser output do not yet include SFX data.

- [ ] **Step 3: Extend the schema and prompt builder**

Add the defaulted field beside `visualPrompt`:

```ts
sfxPrompt: z.string().trim().max(120).default(''),
```

Extend `VisualPromptSceneInput` with `sfxPrompt: string`. Change the visual-prompt system contract to require exactly `{sceneIndex, visualPrompt, sfxPrompt}` per scene, keep visual prompts non-empty, and describe SFX as a few-word ambient/foley suggestion in the narration language or `''` when no distinct sound fits. Add this user line beside the existing visual reference:

```ts
`Scene ${scene.sceneIndex}\nNarration: ${scene.narration}\nExisting visual prompt: ${scene.visualPrompt || '(none)'}\nExisting SFX prompt: ${scene.sfxPrompt || '(none)'}`
```

Do not change the visual prompt version or unrelated prompt builders.

- [ ] **Step 4: Run the boundary tests and typecheck**

Run:

```bash
npx vitest run src/server/modules/script/ai/prompt-boundary.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the AI contract and prompt changes**

```bash
git diff --stat -- src/server/modules/script/ai/output-schema.ts src/server/modules/script/ai/build-prompt.ts src/server/modules/script/ai/prompt-boundary.test.ts
git add src/server/modules/script/ai/output-schema.ts src/server/modules/script/ai/build-prompt.ts src/server/modules/script/ai/prompt-boundary.test.ts
git commit -m "feat(script): add SFX suggestions to visual prompts"
```

### Task 2: Extend the project-owned atomic prompt mutation

**Files:**

- Modify: `src/server/modules/project/service.ts`
- Test: `src/server/modules/script/script.test.ts`

**Interfaces:**

```ts
type EmptyScenePromptUpdate = {
  sceneId: string;
  visualPrompt?: string;
  sfxPrompt?: string;
};

type EmptyScenePromptWriteResult = {
  project: ProjectDetail;
  updatedSceneIds: string[];
  updatedSfxPromptSceneIds: string[];
};
```

`applyEmptySceneVisualPrompts` keeps returning only `ProjectDetail`, while `applyEmptySceneVisualPromptsWithResult` accepts optional per-field values and returns both changed-ID lists. Existing visual-only callers continue compiling unchanged.

- [ ] **Step 1: Add failing project-service tests**

In the existing `empty scene visual prompts` suite, add tests for:

1. A visual-only update still works with no `sfxPrompt` property.
2. A scene with a filled visual prompt and empty SFX receives only the SFX value when both fields are supplied.
3. A scene with a filled SFX prompt and empty visual prompt receives only the visual value.
4. A `findOneAndUpdate` race that fills scene 1's SFX prompt before the atomic write updates scene 2's SFX prompt, returns `updatedSfxPromptSceneIds: ['scene-2']`, preserves scene 1's manual value, and increments the version once for the race edit plus once for the successful atomic update.
5. Duplicate updates preserve the last supplied value independently for visual and SFX fields.

Use the existing `Collection.prototype.findOneAndUpdate` and `patchProjectScene` race-test pattern so the test observes the pre-image accounting rather than only the final document.

- [ ] **Step 2: Run the focused project test and verify it fails**

Run:

```bash
npx vitest run src/server/modules/script/script.test.ts -t "empty scene visual prompts"
```

Expected: FAIL because the mutation result has no SFX list and the existing updater only writes `visualPrompt`.

- [ ] **Step 3: Implement independent field updates in one atomic pass**

Keep `applyEmptySceneVisualPrompts` as a wrapper. In `applyEmptySceneVisualPromptsWithResult`:

1. Deduplicate by scene ID while preserving the last supplied value separately for `visualPrompt` and `sfxPrompt`.
2. Validate every referenced scene before any write.
3. Ignore undefined or empty field values for write eligibility; return an unchanged project and empty ID lists when no non-empty field remains.
4. Build `$set` and `arrayFilters` with separate identifiers per scene/field. For example:

```ts
set[`scenes.$[visual${index}].visualPrompt`] = update.visualPrompt;
arrayFilters.push({ [`visual${index}.id`]: sceneId, [`visual${index}.visualPrompt`]: '' });
set[`scenes.$[sfx${index}].sfxPrompt`] = update.sfxPrompt;
arrayFilters.push({ [`sfx${index}.id`]: sceneId, [`sfx${index}.sfxPrompt`]: '' });
```

5. Build the top-level `scenes.$elemMatch` predicate from exact eligible field clauses (`{ id: sceneId, visualPrompt: '' }` or `{ id: sceneId, sfxPrompt: '' }`) so a concurrent edit that fills every requested field cannot cause a version-only update.
6. Keep one `$inc: { version: 1 }` for the whole successful update. Use the returned pre-image to populate `updatedSceneIds` and `updatedSfxPromptSceneIds` independently.

Do not alter `patchProjectScene` or any unrelated project mutation.

- [ ] **Step 4: Run project and existing script tests**

Run:

```bash
npx vitest run src/server/modules/script/script.test.ts
npm run typecheck
```

Expected: PASS, including all existing visual-only callers and the new SFX concurrency tests.

- [ ] **Step 5: Commit the atomic project mutation**

```bash
git diff --stat -- src/server/modules/project/service.ts src/server/modules/script/script.test.ts
git add src/server/modules/project/service.ts src/server/modules/script/script.test.ts
git commit -m "feat(project): atomically fill visual and SFX prompts"
```

### Task 3: Forward SFX suggestions and enable retroactive backfill

**Files:**

- Modify: `src/server/modules/script/visual-prompts.ts`
- Test: `src/server/modules/script/visual-prompts.test.ts`

**Interfaces:**

`chapterScenes` forwards `sfxPrompt`. `generateVisualPrompts` continues returning:

```ts
{ updatedScenes: number; skippedScenes: number; failedChapters: number[] }
```

Its mutation call consumes both `updatedSceneIds` and `updatedSfxPromptSceneIds` from Task 2.

- [ ] **Step 1: Update fixtures and add failing orchestration tests**

Extend the scene fixture helper with optional SFX prompt values and make the default generated test batches include a non-empty SFX suggestion. Preserve existing skip-focused fixtures by giving their already-filled visual scenes an already-filled SFX value. Add tests asserting:

1. Captured AI input includes each scene's existing SFX prompt and generated batch SFX values are persisted.
2. A scene with an existing SFX prompt keeps it when the AI returns a different suggestion, while empty SFX scenes are filled.
3. A chapter with all visual prompts filled but SFX prompts empty still calls the AI and backfills SFX without changing the visual prompts; this covers the retroactive project case.
4. A chapter with both fields filled for every scene makes no AI call and logs that visual and SFX prompts are already filled.
5. An empty SFX suggestion remains empty and appears in the fill log as zero SFX prompts added.

Keep existing index-retry, cancellation, failure-isolation, and visual-field concurrency tests intact, updating only fixtures/expected prompt payloads where the new defaulted response field requires it.

- [ ] **Step 2: Run the focused orchestration test and verify it fails**

Run:

```bash
npx vitest run src/server/modules/script/visual-prompts.test.ts
```

Expected: FAIL because scene inputs omit SFX, chapters still skip on visual prompts alone, and the write call maps only `visualPrompt`.

- [ ] **Step 3: Implement SFX forwarding, skip logic, and logging**

In `chapterScenes`, map `sfxPrompt: scene.sfxPrompt`. In the chapter loop, compute:

```ts
const prefilledVisual = scenes.filter((scene) => scene.visualPrompt !== '').length;
const fullyPrefilled = scenes.filter((scene) => scene.visualPrompt !== '' && scene.sfxPrompt !== '').length;
result.skippedScenes += prefilledVisual;
```

Skip only when `fullyPrefilled === scenes.length`. Otherwise build the existing prompt, map every batch item to `{ sceneId, visualPrompt: item.visualPrompt, sfxPrompt: item.sfxPrompt }`, and pass the updates to `applyEmptySceneVisualPromptsWithResult`. Continue counting `updatedScenes` from `updatedSceneIds` only, and add `updatedSfxPromptSceneIds.length` to the chapter and final log messages. Empty SFX values must flow through as no-op values and must never overwrite existing data.

Preserve all current cancellation checks, retry behavior, style-note updates, progress reporting, and chapter failure handling.

- [ ] **Step 4: Run the complete relevant regression set**

Run:

```bash
npx vitest run src/server/modules/script/ai/prompt-boundary.test.ts src/server/modules/script/script.test.ts src/server/modules/script/visual-prompts.test.ts
npm run typecheck
npm run lint
```

Expected: PASS, including the retroactive backfill and independent SFX concurrency guards.

- [ ] **Step 5: Commit the orchestration changes**

```bash
git diff --stat -- src/server/modules/script/visual-prompts.ts src/server/modules/script/visual-prompts.test.ts
git add src/server/modules/script/visual-prompts.ts src/server/modules/script/visual-prompts.test.ts
git commit -m "feat(script): backfill SFX prompts with visual generation"
```

## Final verification after all checkpoints

Run the focused regression set from Task 3 plus:

```bash
npm run build
```

The build is expected to pass with the existing non-blocking client chunk-size warning. No client/UI files, video SFX generation functions, scene-split code, or new schema marker are part of this task.
