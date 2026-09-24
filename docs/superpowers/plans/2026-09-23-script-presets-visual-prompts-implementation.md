# Script Presets and Visual-Prompt Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the selected script preset materially shape generation/regeneration and add a cancellable, resumable, race-safe job that proposes visual prompts for finalized scenes.

**Architecture:** Versioned Markdown presets are loaded by the script module's `ai/` boundary from either the source tree or the copied production artifact. Initial generation and chapter regeneration use typed prompt builders and parsers; visual-prompt generation runs sequentially per chapter through the existing MongoDB job queue and writes only empty prompts through a new project-owned atomic mutation. Studio adds one action and reuses the existing job SSE state.

**Tech Stack:** TypeScript strict ESM, Zod, Express 5, MongoDB driver, Vitest with `mongodb-memory-server`, provider-neutral AI clients, React 19, TanStack Query, and the existing job/SSE infrastructure.

**Spec:** `docs/superpowers/specs/2026-09-23-script-presets-visual-prompts-design.md`

## Global Constraints

- `SceneDoc.visualPrompt` remains a string with `''` as the existing “not authored yet” sentinel; no schema migration is introduced.
- `finalizeScript()` remains a fast synchronous operation: it writes empty visual prompts, advances the project to `assets`, and returns immediately.
- The script module may import `project` only through `src/server/modules/project/index.ts`; it never imports `getCollection('projects')`, `project/repo.ts`, or project persistence internals.
- `project` remains the sole owner of `projects` and all scene writes; the new batch write increments `version` once only when at least one empty prompt is filled.
- Presets remain versioned Markdown files in `src/server/modules/script/ai/presets/`; no YAML loader, Markdown runtime dependency, preset editor, or preset collection is added.
- The two allowed preset IDs remain exactly `documentary` and `explainer`, from `SCRIPT_PRESET_IDS` in `src/contracts/project.ts`.
- Visual-prompt work is a separate `generate-visual-prompts` job and never runs inside `finalizeScript()`.
- Visual-prompt processing is sequential by project chapter; a chapter with no empty prompts is skipped, and a chapter with empty prompts receives one initial AI call plus at most one validation-error retry.
- AI batch responses must contain one prompt object for every supplied global `sceneIndex`, including scenes whose existing prompts are non-empty; existing prompts are references and are never overwritten.
- Cancellation is cooperative at chapter boundaries and immediately after provider responses; an in-flight response is discarded when cancellation is observed and no scene write is made from it.
- Tests use mocked AI clients and `mongodb-memory-server`; provider network calls are not made.
- `eslint.config.js` remains unchanged and no new client DOM-testing dependency is added.
- `AGENTS.md` Status and `src/server/modules/script/MODULE.md` are updated in the same meaningful commit as the corresponding code.
- Never use `git add -A`, `git add .`, destructive Git commands, or `git push`.

## Review Focus

- **Preset drift:** documentary and explainer must be observably different in the composed system prompt; test the documentary phrase “open a chapter with a hook” present only for documentary and the explainer phrase “one self-contained beat” present only for explainer in Task 7.
- **AI index-contract corruption:** missing, duplicate, extra, out-of-range, or count-mismatched `sceneIndex` values must reject the whole chapter response without a write; test all five forms and the one-retry path in Task 7.
- **Concurrent manual editing:** a prompt edited after the AI read must win over the AI result, and an all-filled race must not increment `version`; test the empty-only project mutation in Task 3 and rerun behavior in Task 7.
- **Partial/cancelled jobs:** one failed chapter must not prevent later chapters, while cancellation between chapters must stop later calls and let the worker mark the job cancelled; test both in Task 7.
- **Production asset resolution:** the built server/worker must load copied presets without assuming `src/` exists; test `dist/presets/documentary.md` and `dist/presets/explainer.md` after the build in Task 8.

---

### Task 1: Load and package versioned script presets

**Files:**
- Create: `src/server/modules/script/ai/presets/loader.ts`
- Create: `src/server/modules/script/ai/presets/loader.test.ts`
- Create: `src/server/modules/script/ai/presets/explainer.md`
- Modify: `src/server/modules/script/ai/presets/documentary.md`
- Create: `scripts/copy-script-presets.mjs`
- Modify: `package.json`
- Modify: `AGENTS.md`
- Modify: `src/server/modules/script/MODULE.md`

**Interfaces:**
- `loader.ts` exports:

```ts
export type ScriptPreset = {
  id: ScriptPresetId;
  version: number;
  system: string;
  instructions: string;
};

export function loadScriptPreset(id: ScriptPresetId, presetDirectory?: string): ScriptPreset;
```

- The default directory is `dirname(fileURLToPath(import.meta.url))`, so source execution reads the sibling Markdown files and the bundled server reads `dist/presets/<id>.md` beside `dist/server.js` or `dist/worker.js`.
- `scripts/copy-script-presets.mjs` copies `src/server/modules/script/ai/presets/*.md` to `dist/presets/` with Node built-ins only. Change the build script to `vite build && node scripts/copy-script-presets.mjs && tsup`.

- [ ] **Step 1: Write failing loader and packaging tests**

  Add tests that load both IDs from a temporary/source preset directory, assert `id`, positive integer `version`, and non-empty `system`/`instructions`, and reject an unknown requested ID, mismatched frontmatter ID, non-positive/non-integer version, and missing required section. Use a temporary directory created by `fs.mkdtemp` for malformed fixtures; do not add a runtime dependency.

- [ ] **Step 2: Run the focused test to verify failure**

  Run: `npm test -- src/server/modules/script/ai/presets/loader.test.ts`

  Expected: FAIL because the loader and the explainer preset do not exist.

- [ ] **Step 3: Implement dependency-free frontmatter and section parsing**

  Parse the exact frontmatter form below, validate the declared ID against `SCRIPT_PRESET_IDS`, require that it equal the requested ID, parse `version` with `/^[1-9][0-9]*$/`, and extract non-empty `## System` and `## Instructions` sections. Throw an application error with code `SCRIPT_PRESET_INVALID` before an AI request for every malformed case.

  ```markdown
  ---
  id: documentary
  version: 2
  ---
  # Preset: documentary

  ## System
  ...

  ## Instructions
  ...
  ```

- [ ] **Step 4: Add the approved preset content**

  Replace the documentary placeholder with `version: 2` and the approved documentary guidance: documentary narrator for long-form history/documentary video; tension through pacing and stakes; measured, authoritative, slightly dramatic voice; speakable breath-groups; concrete people, objects, actions, and places; chapter openings with a hook, conflict, question, or stake; active verbs; varied sentence length; and no unsupported precision. Include the exact regression phrase `open a chapter with a hook`.

  Add `explainer.md` with `version: 1` and the approved explainer guidance: clear, friendly how-it-works scripts; one idea per paragraph; plain language and defined terms; second person where natural; each paragraph as one self-contained beat and one scene; literal diagram-friendly process/comparison/transformation/interface/before-after imagery; explicit sequential transitions; short numerous paragraphs; and no unexplained acronyms or ornamental suspense. Include the exact regression phrase `one self-contained beat`.

- [ ] **Step 5: Implement and exercise the production copy step**

  Copy only the two Markdown files into `dist/presets/` and make the script idempotent when the destination already exists. Run `node scripts/copy-script-presets.mjs` and assert both destination files exist before committing.

- [ ] **Step 6: Run focused checks and commit**

  Run: `npm test -- src/server/modules/script/ai/presets/loader.test.ts` and `npm run typecheck`

  Expected: PASS. Update `AGENTS.md` Status to record that versioned documentary/explainer preset loading and the production copy step are implemented and verified; update the script module invariant to state that Markdown is the only preset source.

  ```text
  git add -- AGENTS.md package.json scripts/copy-script-presets.mjs src/server/modules/script/ai/presets src/server/modules/script/MODULE.md
  git commit -m "feat(script): load versioned script presets"
  ```

### Task 2: Move script prompts, schemas, and parsers into the AI boundary

**Files:**
- Modify: `src/server/modules/script/ai/build-prompt.ts`
- Modify: `src/server/modules/script/ai/output-schema.ts`
- Modify: `src/server/modules/script/ai/parse-output.ts`
- Delete: `src/server/modules/script/prompts.ts`
- Modify: `src/server/modules/script/service.ts`
- Modify: `src/server/modules/script/index.ts`
- Modify: `src/server/modules/script/MODULE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- `build-prompt.ts` exports:

```ts
export type BuiltPrompt = { system: string; user: string; promptVersion: string };
export type VisualPromptSceneInput = {
  sceneId: string;
  sceneIndex: number;
  narration: string;
  visualPrompt: string;
};
export type VisualPromptPromptInput = {
  project: ProjectDetail;
  chapter: ChapterDoc;
  scenes: readonly VisualPromptSceneInput[];
  styleNote: string;
};
export function buildScriptPrompt(project: ProjectDetail): BuiltPrompt;
export function buildRegenerationPrompt(
  project: ProjectDetail,
  chapter: ChapterDoc,
  instruction: string,
  level: 'light' | 'medium' | 'rewrite',
): BuiltPrompt;
export function buildVisualPromptPrompt(input: VisualPromptPromptInput): BuiltPrompt;
```

- `output-schema.ts` owns `GeneratedChapterSchema`, `RegeneratedParagraphsSchema`, and `VisualPromptBatchSchema`. Use `styleNote: z.string().max(500)` and non-empty trimmed visual prompts; use positive integer `sceneIndex` values.
- `parse-output.ts` exports `parseGeneratedChapters`, `parseRegeneratedParagraphs`, and `parseVisualPromptBatch`. Each strips one optional ` ```json ... ``` ` fence, parses JSON, validates the relevant Zod schema, and maps failures to `SCRIPT_PARSE_ERROR`.
- Define the prompt version exactly as `script-prompt-v1/${preset.id}@${preset.version}`. `buildScriptPrompt` and `buildRegenerationPrompt` load the selected preset and never expose Markdown file contents to the client.

- [ ] **Step 1: Add failing prompt/parser tests**

  Add tests for both preset IDs, fenced and unfenced JSON, invalid JSON, invalid chapter shape, invalid regenerated paragraph shape, and invalid visual-prompt batch shape. Assert the initial prompt contains title, brief, references, language, chapter count, target duration, preset system/instruction guidance, JSON-only rules, and the exact prompt version.

- [ ] **Step 2: Run the focused test to verify failure**

  Run: `npm test -- src/server/modules/script/ai`

  Expected: FAIL because the scaffold files are empty and the live service still imports `prompts.ts`.

- [ ] **Step 3: Implement the typed prompt builders**

  Compose the initial system message in this order: common professional-video-script-writer/JSON-only contract, selected preset `system`, selected preset `instructions`. Compose the user message with title, brief, references, project language, chapter count, and target duration. Compose regeneration with the same selected preset sections plus chapter title/number, current paragraphs, instruction, and level, without neighboring chapters or the full project brief. Compose visual-prompt prompts from the selected preset guidance plus project title/brief/language and the chapter scene inputs.

- [ ] **Step 4: Implement schemas and parsers, then update the service imports**

  Move the current generated-chapter and regenerated-paragraph validation out of `service.ts`. Preserve the current `SCRIPT_PARSE_ERROR` status/code behavior and the current `finalizeScript()` scene shape. Delete `prompts.ts` only after every call site imports from `ai/build-prompt.ts` and `ai/parse-output.ts`.

- [ ] **Step 5: Run checks and commit**

  Run: `npm test -- src/server/modules/script/ai`, `npm run typecheck`, and `npm run lint`

  Expected: PASS, with no second live prompt builder and no server imports in client/contracts.

  ```text
  git add -- AGENTS.md src/server/modules/script/ai src/server/modules/script/service.ts src/server/modules/script/index.ts src/server/modules/script/MODULE.md
  git rm -- src/server/modules/script/prompts.ts
  git commit -m "feat(script): move prompt schemas and parsers into ai"
  ```

### Task 3: Add the race-safe project-owned empty-prompt mutation

**Files:**
- Modify: `src/server/modules/project/service.ts`
- Modify: `src/server/modules/project/index.ts`
- Modify: `src/server/modules/script/script.test.ts`
- Modify: `src/server/modules/project/MODULE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Export this exact public project API:

```ts
export async function applyEmptySceneVisualPrompts(
  projectId: string,
  updates: Array<{ sceneId: string; visualPrompt: string }>,
): Promise<ProjectDetail>;
```

- The method validates every submitted scene ID against the current project, deduplicates with a `Map` so the last value wins, and returns the current project for an empty update list.

- [ ] **Step 1: Write failing public-service tests**

  Extend the existing Mongo-backed script test fixture with finalized scenes and assert: two updates are applied in one version increment; duplicate IDs retain the last prompt; a missing scene ID rejects with `NotFound`; a non-empty existing prompt remains unchanged; and when every target is already non-empty, the returned project is unchanged and `version` is unchanged. Keep `src/server/modules/project/project.test.ts` as the existing todo; exercise the public project API from the script integration suite.

- [ ] **Step 2: Run the focused test to verify failure**

  Run: `npm test -- src/server/modules/script/script.test.ts -t "empty scene visual prompts"`

  Expected: FAIL because the public method is absent.

- [ ] **Step 3: Implement validation, deduplication, and the atomic update**

  Read the project through `getProject`, validate IDs, and discard updates whose current prompt is already non-empty before constructing the update. For each remaining scene use an array filter requiring both the stable scene ID and `visualPrompt: ''`; include a query predicate requiring at least one target scene with an empty prompt, `$set` only for matching array elements, `$inc: { version: 1 }`, and one `updatedAt` timestamp. If the atomic query matches zero documents because a concurrent edit filled every target, return a fresh project without incrementing `version`; if some targets still match, the single update increments `version` once. A concurrent manual `patchProjectScene` therefore wins.

- [ ] **Step 4: Verify the module boundary and commit**

  Run: `npm test -- src/server/modules/script/script.test.ts -t "empty scene visual prompts"`, `npm run typecheck`, and `npm run lint`. Confirm the script module imports only `applyEmptySceneVisualPrompts` from `../project` and no new script file imports the project collection.

  Update `AGENTS.md` and the project module documentation to state that the empty-only batch mutation is the sole writer added for AI visual prompts and has no schema migration.

  ```text
  git add -- AGENTS.md src/server/modules/project/service.ts src/server/modules/project/index.ts src/server/modules/project/MODULE.md src/server/modules/script/script.test.ts
  git commit -m "feat(project): add race-safe empty visual prompt mutation"
  ```

### Task 4: Implement sequential visual-prompt orchestration and cancellation

**Files:**
- Create: `src/server/modules/script/visual-prompts.ts`
- Create: `src/server/modules/script/visual-prompt-handler.ts`
- Modify: `src/server/modules/script/ai/build-prompt.ts`
- Modify: `src/server/modules/script/index.ts`
- Modify: `src/server/modules/script/MODULE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- `visual-prompts.ts` exports:

```ts
export type VisualPromptJobContext = {
  reportProgress: (percent: number, result?: unknown) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
};

export type VisualPromptJobResult = {
  updatedScenes: number;
  skippedScenes: number;
  failedChapters: number[];
};

export async function generateVisualPrompts(
  projectId: string,
  context: VisualPromptJobContext,
): Promise<VisualPromptJobResult>;
```

- `visual-prompt-handler.ts` exports `VisualPromptJobPayload = { projectId: string }` and `handleGenerateVisualPrompts(job, context)`, with a Zod payload parse and the existing pre-cancel check.
- `buildVisualPromptPrompt` accepts project metadata, a bounded style note, and ordered scene inputs `{ sceneId, sceneIndex, narration, visualPrompt }`; the scene ID is internal and is never sent to the AI.

- [ ] **Step 1: Define the exact per-chapter input and response contract**

  Compute stable 1-based `sceneIndex` values from the project scene array before processing chapters. For each chapter send every scene in order, including existing prompts as reference text. Include this exact count instruction verbatim in the user message:

  ```text
  This chapter contains exactly N scenes. Return exactly N prompt objects, one for every supplied sceneIndex. Echo each supplied sceneIndex exactly; do not invent, omit, duplicate, or renumber indexes.
  ```

  Validate the returned `VisualPromptBatchSchema`, then compare the returned index multiset with the exact supplied index set. Treat any count mismatch, missing, duplicate, extra, or out-of-range index as invalid. On invalid output, append the validation error to one retry request; discard the second invalid response and continue with the next chapter.

- [ ] **Step 2: Implement style continuity and bounded rerun seeding**

  Carry only the previous successful chapter's bounded `styleNote` into the next call. When a rerun starts with earlier chapters already populated and there is no successful response yet, seed the style note with a bounded excerpt of existing non-empty prompts from project scene order, capped at 500 characters. A fully populated chapter makes no AI call; if the running style note is still empty, derive the next call's bounded style note from that chapter's existing prompts so continuity survives skipped chapters.

- [ ] **Step 3: Implement the sequential job loop**

  Load the project through `getProject`, process chapters in order, skip full chapters, check `isCancelled()` before every initial/retry call and after every response, and call `getAiClient(project.aiProvider).chat` with the typed visual-prompt prompt. Map validated indexes back to stable scene IDs and call `applyEmptySceneVisualPrompts` once for that chapter. Catch AI, validation, and project-write errors per chapter, log the chapter number, add it to `failedChapters`, and continue. Count only actually changed empty scenes as `updatedScenes`; count prefilled scenes and full-chapter scenes as `skippedScenes`.

- [ ] **Step 4: Implement progress, result, and cancellation behavior**

  Report rounded progress after each processed chapter as `Math.round(((chapterIndex + 1) / project.chapters.length) * 100)`. Return the summary even when some chapters fail, and append a final summary log. When cancellation is observed between chapters or immediately after an AI response, stop without writing the response; let the worker's post-handler cancellation check mark the job `cancelled`.

- [ ] **Step 5: Run static checks and commit**

  Run: `npm run typecheck` and `npm run lint`

  Expected: PASS with script-to-project calls limited to public index exports and no direct job-module dependency.

  Update `AGENTS.md` and `MODULE.md` with the per-chapter retry, exact-index validation, empty-only write, partial-success, and cooperative-cancellation rules.

  ```text
  git add -- AGENTS.md src/server/modules/script/ai/build-prompt.ts src/server/modules/script/visual-prompts.ts src/server/modules/script/visual-prompt-handler.ts src/server/modules/script/index.ts src/server/modules/script/MODULE.md
  git commit -m "feat(script): add visual prompt generation job"
  ```

### Task 5: Add the enqueue route and explicit worker registration

**Files:**
- Modify: `src/server/modules/script/routes.ts`
- Modify: `src/server/modules/script/index.ts`
- Modify: `src/worker/registry.ts`
- Modify: `src/worker/worker.test.ts`
- Modify: `src/server/modules/script/script.test.ts`
- Modify: `src/server/modules/script/MODULE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Add this endpoint to the existing script router mounted at `/api/project`:

```text
POST /api/project/:id/scenes/generate-visual-prompts
201 { jobId }
job type: generate-visual-prompts
payload: { projectId }
```

- Keep `createScriptRouter({ enqueueJob })` and use the existing injected enqueue callback. Register the exact key `'generate-visual-prompts'` in `jobHandlers` through `handleGenerateVisualPrompts`.

- [ ] **Step 1: Add failing route and registry tests**

  Add an HTTP test that creates a project with finalized chapters/scenes, posts to the endpoint, asserts `201`, and inspects the `jobs` collection for the exact type and payload. Add a not-ready test for empty scenes, missing/null chapter scene counts, and a mismatched scene-count sum; assert `SCENES_NOT_READY` and no inserted job. Add a worker test that mocks `generateVisualPrompts`, verifies project ID/context mapping, and verifies a pre-cancelled job does not call it.

- [ ] **Step 2: Run focused tests to verify failure**

  Run: `npm test -- src/server/modules/script/script.test.ts src/worker/worker.test.ts`

  Expected: FAIL because the endpoint, readiness guard, and handler registration are absent.

- [ ] **Step 3: Implement the thin route and readiness guard**

  Load the project via `getProject`. Reject unless `scenes.length > 0`, every chapter has a positive integer `scenesCount`, and the sum of chapter scene counts equals `scenes.length`; throw `AppError('SCENES_NOT_READY', 422, 'SCENES_NOT_READY')`. Enqueue `{ type: 'generate-visual-prompts', projectId: project.id, payload: { projectId: project.id } }` and return `res.status(201).json({ jobId: job.id })`. Do not duplicate readiness logic in a repository or write project state from the route.

- [ ] **Step 4: Register the handler explicitly**

  Import `handleGenerateVisualPrompts` from the script public index in `src/worker/registry.ts` and add the exact map entry. Preserve the existing `generate-script`, `generate-voiceover`, and `render-full-video` registrations.

- [ ] **Step 5: Run checks and commit**

  Run: `npm test -- src/server/modules/script/script.test.ts src/worker/worker.test.ts`, `npm run typecheck`, and `npm run lint`

  Expected: PASS. No app mount change is required because `createScriptRouter` is already mounted at `/api/project` with the existing enqueue injection.

  ```text
  git add -- AGENTS.md src/server/modules/script/routes.ts src/server/modules/script/index.ts src/server/modules/script/script.test.ts src/server/modules/script/MODULE.md src/worker/registry.ts src/worker/worker.test.ts
  git commit -m "feat(script): add visual prompt routes and worker wiring"
  ```

### Task 6: Add the Studio visual-prompt action

**Files:**
- Modify: `src/client/features/asset/api.ts`
- Modify: `src/client/features/asset/asset-api.test.ts`
- Modify: `src/client/features/asset/StudioPage.tsx`
- Modify: `AGENTS.md`

**Interfaces:**
- Add this typed client function beside the existing project-wide job functions:

```ts
export function generateVisualPrompts(projectId: string): Promise<{ jobId: string }>;
```

- It posts to `/api/project/:id/scenes/generate-visual-prompts` and validates `{ jobId: string }` with the existing `JobResponseSchema`.

- [ ] **Step 1: Write the failing API test**

  Extend `asset-api.test.ts` to call `generateVisualPrompts('project/1')`, assert the encoded URL `/api/project/project%2F1/scenes/generate-visual-prompts`, method `POST`, and the `{ jobId: 'job-1' }` response shape.

- [ ] **Step 2: Run the focused client test to verify failure**

  Run: `npm test -- src/client/features/asset/asset-api.test.ts`

  Expected: FAIL because the client function is absent.

- [ ] **Step 3: Implement the API function and Studio action**

  Add `generateVisualPrompts` to `api.ts`. In `StudioPage.tsx`, add `generateVisualPrompts()` that sets `busy` to `visual-prompts`, stores the returned job ID in the existing `jobId` state, and shows the existing toast style. Add the button near “Tạo voiceover” with label `Tạo visual prompt`.

  Disable it when `scenes.length === 0`, when a local action is busy, or when the current project job is queued/running. Define the active-job predicate so an enqueue response with no SSE state yet is still treated as active. Keep the existing `useJobProgress(jobId)` and terminal refresh behavior; do not add a second progress protocol, page, or DOM test dependency.

- [ ] **Step 4: Run client checks and commit**

  Run: `npm test -- src/client/features/asset/asset-api.test.ts`, `npm run typecheck`, and `npm run lint`

  Expected: PASS, with no provider key or server import in the client bundle.

  ```text
  git add -- AGENTS.md src/client/features/asset/api.ts src/client/features/asset/asset-api.test.ts src/client/features/asset/StudioPage.tsx
  git commit -m "feat(client): add Studio visual prompt action"
  ```

### Task 7: Complete preset and visual-prompt regression coverage

**Files:**
- Modify: `src/server/modules/script/ai/presets/loader.test.ts`
- Create: `src/server/modules/script/ai/ai.test.ts`
- Modify: `src/server/modules/script/script.test.ts`
- Modify: `src/worker/worker.test.ts`
- Modify: `src/client/features/asset/asset-api.test.ts`
- Modify: `src/server/modules/script/MODULE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- This task adds tests only; production interfaces are those produced by Tasks 1–6. Keep all Mongo-backed tests on the existing `startTestMongo`/`closeTestMongo` harness and all AI tests on the existing `getAiClient` mock.

- [ ] **Step 1: Pin the mechanical preset distinction**

  Assert the composed documentary system prompt contains `open a chapter with a hook` and does not contain `one self-contained beat`. Assert the composed explainer system prompt contains `one self-contained beat` and does not contain `open a chapter with a hook`. Also assert regeneration carries the selected preset guidance and exact `promptVersion`.

- [ ] **Step 2: Pin the exact visual-batch contract and retry**

  Add cases for a valid batch with all input indexes echoed; missing index; duplicate index; extra index; out-of-range index; and a count mismatch. For each invalid response assert no prompt from that chapter is written, the validation error is sent in exactly one retry, and a second invalid response adds the chapter number to `failedChapters` while later chapters still execute.

- [ ] **Step 3: Pin style continuity, reruns, and partial completion**

  Build a two-chapter finalized project and assert the second AI call contains the first successful `styleNote`. Seed a rerun with prefilled earlier prompts and assert the first call contains a bounded existing-prompt excerpt. Assert a fully populated chapter makes no call. Assert a partial rerun sends every scene for exact-count validation but writes only empty scenes, leaving authored prompts byte-for-byte unchanged. Assert a failed first chapter does not prevent a later chapter write.

- [ ] **Step 4: Pin cancellation and concurrent edit behavior**

  Cancel between chapters and assert no later AI call occurs, no later chapter write occurs, and the worker observes cancellation. Simulate a manual prompt update before applying an AI batch and assert the manual value remains and the project version reflects only the manual write. Assert an all-filled `applyEmptySceneVisualPrompts` call leaves the version unchanged.

- [ ] **Step 5: Pin route, worker, finalization, and client contracts**

  Assert the enqueue route's exact type/payload, `SCENES_NOT_READY` cases, worker registration, client URL/method/response, and existing finalization behavior: finalization still returns promptly with `assets` status and all `visualPrompt` values empty. Keep the existing no-duplicate-SSE and error-frame tests green.

- [ ] **Step 6: Run the focused and full suites; commit**

  Run: `npm test -- src/server/modules/script src/worker/worker.test.ts src/client/features/asset/asset-api.test.ts` and then `npm test`

  Expected: all new and existing tests pass; the pre-existing project todo remains the only intentionally skipped project test surface. Update `AGENTS.md` and `MODULE.md` with the exact passing counts only after reading the command output.

  ```text
  git add -- AGENTS.md src/client/features/asset/asset-api.test.ts src/server/modules/script/ai/presets/loader.test.ts src/server/modules/script/ai/ai.test.ts src/server/modules/script/script.test.ts src/server/modules/script/MODULE.md src/worker/worker.test.ts
  git commit -m "feat(script): add preset and visual prompt coverage"
  ```

### Task 8: Whole-branch verification and acceptance documentation

**Files:**
- Create: `docs/superpowers/acceptance/2026-09-23-phase6-script-presets-visual-prompts-acceptance.md`
- Modify: `AGENTS.md`
- Modify: `src/server/modules/script/MODULE.md`

**Interfaces:**
- The acceptance document records the exact commands, test counts, build artifact paths, and documented environment notes. It does not introduce runtime behavior.

- [ ] **Step 1: Run the required verification commands**

  Run exactly:

  ```text
  npm run typecheck
  npm run lint
  npm test
  npm run build
  ```

  Expected: all commands pass. Record the exact Vitest passed/skipped counts, the fact that mocked providers made no network calls, and whether `mongodb-memory-server` ran or used its existing local-Mongo fallback.

- [ ] **Step 2: Verify production preset packaging and bundle isolation**

  After `npm run build`, run:

  ```text
  node -e "const fs=require('node:fs'); for (const file of ['dist/presets/documentary.md','dist/presets/explainer.md']) { if (!fs.existsSync(file)) throw new Error(file + ' missing'); }"
  rg -n "DEEPSEEK_API_KEY|ANTHROPIC_API_KEY|openai|anthropic|src/server/modules/script/ai/presets" dist/client dist/server.js dist/worker.js
  ```

  The first command must pass. The scan must show no provider secret names or server-only AI imports in `dist/client`; source-tree preset paths must not be required by the built server/worker at runtime.

- [ ] **Step 3: Verify boundaries and unchanged lint configuration**

  Run `git diff -- eslint.config.js` and confirm it is empty. Run `rg -n "getCollection|../project/(repo|service)|modules/project/(repo|service)" src/server/modules/script --glob '!*.test.ts'` and confirm there are no direct project collection/repository imports in production code. Confirm the only new route is under `/api/project/:id/scenes/generate-visual-prompts` and no public job-create/list route was added.

- [ ] **Step 4: Update acceptance/status documentation**

  Record in `AGENTS.md` that the script-preset and visual-prompt phase is done, including the final verification counts, production preset copy path, race-safe empty-only mutation, sequential retry/cancellation behavior, Studio action, and any remaining live-browser/provider acceptance gap. Update `MODULE.md` with the public API, job contract, state/ownership invariants, and final acceptance commands. Create the acceptance file with the same evidence and the eight commit subjects.

- [ ] **Step 5: Commit the acceptance record**

  ```text
  git add -- AGENTS.md src/server/modules/script/MODULE.md docs/superpowers/acceptance/2026-09-23-phase6-script-presets-visual-prompts-acceptance.md
  git commit -m "docs(phase6): record script preset and visual prompt acceptance"
  ```

## Self-review checklist

- **Spec coverage:** Tasks 1–2 cover the single preset-AI boundary, Markdown loader, exact documentary/explainer content distinction, prompt versioning, output schemas, and parsers; Task 3 covers project ownership and the race-safe write; Tasks 4–5 cover the exact-index visual job, retry, partial success, route, and worker; Task 6 covers Studio; Tasks 7–8 cover regression and production acceptance.
- **Placeholder scan:** The plan contains no `TBD`, implementation placeholder, or unspecified error-handling step. Every production file, public function, route, test family, command, and commit subject is named.
- **Type consistency:** `ScriptPreset` comes from `presets/loader.ts`; `BuiltPrompt` comes from `ai/build-prompt.ts`; output parsers own Zod validation; `applyEmptySceneVisualPrompts` returns `ProjectDetail`; `generateVisualPrompts` returns `VisualPromptJobResult`; the handler consumes `{ projectId: string }`; the client consumes `{ jobId: string }`.
- **Review-focus coverage:** Preset drift is tested in Task 7 Step 1; index corruption and retry in Task 7 Step 2; concurrent editing in Tasks 3 and 7; partial/cancelled jobs in Task 7 Steps 3–4; production packaging in Task 8 Step 2.
- **Scope:** No schema migration, image generation, asset import/export change, duration-aware pacing, neighboring-chapter regeneration context, chapter-count validation, preset editor/database, second progress protocol, or client provider-secret exposure is planned.
