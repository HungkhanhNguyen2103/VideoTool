# Script Presets and Visual-Prompt Generation Design Specification

**Date:** 2026-09-23
**Status:** Design only; implementation is intentionally blocked until this spec is reviewed.
**Source brief:** Make script presets shape generation and automatically suggest scene visual prompts.

## Goal

Close two script-pipeline gaps without changing the already-working finalize-to-Studio transition:

1. The project's `scriptPresetId` must materially shape initial script generation and single-chapter regeneration through real, versioned preset guidance.
2. After finalization, a user must be able to enqueue an explicit, cancellable, progress-visible job that proposes visual prompts for scenes derived from their narration. The job must preserve manual edits, support partial completion, and maintain visual continuity across chapters.

The implementation keeps the existing modular-monolith boundaries, provider-neutral AI client, MongoDB job queue, project-owned scene writes, and current `SceneDoc` shape.

## Non-goals

- Generating visual prompts inside `finalizeScript()` or delaying navigation to Studio.
- Automatically generating images, importing assets, or changing the Google Flow ZIP/export format.
- Overwriting a non-empty `visualPrompt`, even when the AI job is rerun.
- Duration-aware narration pacing or word-count guidance tied to `targetDurationSec`.
- Adding neighboring chapters and the full project brief to single-chapter regeneration beyond the selected preset guidance.
- Validating the AI chapter count against `project.chapterCount` in this prompt.
- Adding a custom-preset editor or a preset database collection; presets remain versioned files shipped with the server.

## Existing-repo baseline

- `src/server/modules/script/prompts.ts` is the live prompt path, but currently treats `scriptPresetId` as a label only.
- `src/server/modules/script/ai/build-prompt.ts`, `output-schema.ts`, and `parse-output.ts` are empty scaffolds. The implementation will make this directory the only script-AI prompt/schema/parser path and delete `prompts.ts`.
- `src/server/modules/script/ai/presets/documentary.md` contains only placeholder text. `explainer.md` does not exist.
- `script` may import `project` only through `src/server/modules/project/index.ts`; `project` owns the `projects` collection and all scene writes.
- `worker/registry.ts` explicitly registers `generate-script`, `generate-voiceover`, and `render-full-video`; jobs expose `reportProgress`, `isCancelled`, and `appendLog`.
- `StudioPage` already tracks a project-wide job id and displays progress/log events through `useJobProgress`.
- `SceneDoc.visualPrompt` is a string with `''` as the existing “not authored yet” sentinel. No schema migration is required.
- `finalizeScript()` currently splits paragraphs into scenes with empty visual prompts and must remain a fast synchronous operation.

## Design decisions

### 1. Preset architecture

The `src/server/modules/script/ai/` directory becomes the single script-AI boundary:

- `presets/loader.ts` reads and parses the selected markdown preset.
- `build-prompt.ts` builds initial-generation and regeneration messages from a typed preset definition.
- `output-schema.ts` owns the Zod schemas for generated chapters, regenerated paragraphs, and visual-prompt batches.
- `parse-output.ts` owns JSON-fence removal, JSON parsing, schema validation, and AI-shape normalization.

`prompts.ts` is deleted after its behavior moves to `build-prompt.ts`; no second live builder remains. The service imports only the `ai/` public functions.

Each preset file has this exact structure:

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

The loader performs dependency-free frontmatter parsing, validates that the declared `id` matches the requested `SCRIPT_PRESET_IDS` entry, parses a positive integer version, and requires non-empty `## System` and `## Instructions` sections. Unknown preset ids and malformed files fail before an AI request with a clear application error.

`buildScriptPrompt(project)` composes:

1. A common system contract: role as a professional video script writer, project language, JSON-only output, one chapter item shape, and no markdown/prose outside JSON.
2. The selected preset's `## System` guidance.
3. The selected preset's `## Instructions` guidance.
4. A project-specific user message containing title, brief, references, language, chapter count, and target duration.

`buildRegenerationPrompt(project, chapter, instruction, level)` uses the same selected preset sections in its system message, then adds the chapter, current paragraphs, instruction, and regeneration level. This keeps a regenerated chapter aligned with the rest of the script without expanding regeneration context to neighboring chapters in this prompt.

The prompt builder returns a `promptVersion` composed from the prompt contract version and preset id/version, so tests and future script-run metadata can identify which guidance produced a response. No client receives preset file contents.

### 2. Preset content

The implementation must replace the documentary stub and add the explainer file. The following is the approved content direction; wording may be polished without weakening the required distinctions.

#### `documentary.md` (`version: 2`)

**System guidance:** You are a documentary narrator and scriptwriter for long-form history and documentary video. Build tension through pacing and stakes, not fact recitation. Write in the project's language. Use a measured, authoritative, slightly dramatic voice; mix short declarative sentences with longer explanatory ones. Avoid academic hedging unless uncertainty is itself important. Each paragraph must be speakable in one breath-group and should fit roughly one screen of narration. Because each paragraph becomes one scene, make concrete people, objects, actions, and places visible in the wording; avoid abstract summaries when a specific image can carry the idea.

**Instructions:** Open a chapter with a hook, conflict, question, or stake rather than a topic sentence. Let paragraphs advance time, reveal a decision, or sharpen a consequence. Keep clauses easy to speak aloud and avoid deeply nested syntax. Prefer concrete visual nouns and active verbs: identify who is present, what they do, where they are, and what changes. Use longer explanatory paragraphs only when they clarify a turning point; vary sentence length to control tension. Do not invent unsupported precision merely to make a scene visual.

#### `explainer.md` (`version: 1`)

**System guidance:** You are a clear, friendly explainer writing short how-it-works video scripts in the project's language. Explain one idea per paragraph in plain language. Use second person where natural, define a technical term the first time it appears, and keep jargon to the minimum needed for accuracy. Each paragraph is one self-contained beat and one scene. Prefer literal, diagram-friendly visual language: a process, comparison, transformation, interface, object, or before/after state rather than scenic or metaphorical imagery.

**Instructions:** Start with the question or outcome the viewer cares about. Break complex ideas into short sequential beats. Use explicit transitions such as “đầu tiên”, “sau đó”, or their equivalent when they clarify order. Give examples that can be shown literally. Keep paragraphs shorter and more numerous than documentary paragraphs. Avoid unexplained acronyms, rhetorical suspense, ornamental description, and abstract claims without a visible example.

The distinguishing phrases above are part of the regression contract: documentary prompt tests must assert a documentary-specific phrase is present and an explainer-specific phrase is absent, with the inverse assertion for explainer.

### 3. Preset packaging

Markdown remains the source of truth in `src/server/modules/script/ai/presets/`. Development resolves files from the source tree. Production resolves a copied `presets/` directory beside the built server chunks. A small build asset-copy script copies the markdown files into the server artifact, and `npm run build` invokes it between the client build and `tsup`. The loader never assumes that `src/` exists in a deployed installation.

The implementation must test both source-tree loading under Vitest/tsx and the production artifact copy path during the build gate. No markdown loader or YAML runtime dependency is added.

### 4. Visual-prompt job timing and ownership

`finalizeScript()` remains unchanged in timing and scene creation: it writes scenes with empty `visualPrompt` values, advances the project to `assets`, and returns immediately. Studio navigation remains instant.

Add a script-owned endpoint and job:

```text
POST /api/project/:id/scenes/generate-visual-prompts
→ 201 { jobId }
job type: generate-visual-prompts
payload: { projectId }
```

The route verifies that the project has finalized scenes (non-empty scenes, chapters with scene counts, and a scene-count sum matching the project scene array) and returns `SCENES_NOT_READY` rather than enqueueing an invalid project. It then enqueues the job using the existing injected enqueue callback. The script handler is registered explicitly in `worker/registry.ts`. Studio's asset page calls this endpoint because that is where the user encounters scenes; the server route and job remain script-owned because preset-aware narration-to-visual prompting is script-AI behavior.

The job service receives the existing `reportProgress`, `isCancelled`, and `appendLog` callbacks. Cancellation is cooperative at chapter boundaries: the handler checks before each AI call and immediately after each response. If cancellation arrives while a provider request is in flight, the current response is discarded and no scene write occurs; the worker then observes the cancellation and marks the job cancelled. Adding a second cancellation API or a cross-process abort controller is out of scope.

### 5. Per-chapter batching and AI contract

The job processes chapters sequentially in project order. It performs at most one AI call per chapter that still contains at least one empty prompt; a fully populated chapter is skipped without a call.

For each called chapter, the user message contains:

- Project title and brief, language, and the selected preset's visual-language guidance.
- A short running `styleNote` from the previous successful chapter, or a bounded excerpt of existing non-empty prompts when a rerun starts after earlier chapters are already filled.
- Every scene in the chapter in order, with its stable 1-based project-global `sceneIndex`, narration, and current visual prompt if one exists. The example index `1` below is illustrative; a later chapter echoes the global indexes assigned to its scenes rather than restarting at 1.
- An explicit count statement: “This chapter contains exactly N scenes. Return exactly N prompt objects, one for every supplied `sceneIndex`. Echo each supplied `sceneIndex` exactly; do not invent, omit, duplicate, or renumber indexes.”

The AI must return exactly:

```json
{
  "styleNote": "short continuity note for the next chapter",
  "prompts": [
    { "sceneIndex": 1, "visualPrompt": "..." }
  ]
}
```

The `prompts` array must contain exactly one object for every input scene, including scenes whose existing prompt is non-empty. Existing prompts are references only and are never replaced. `styleNote` is bounded to a short string suitable for carrying into the next call.

Validation has two layers:

1. `VisualPromptBatchSchema` validates the JSON shape, non-empty prompt strings, positive integer indexes, and bounded style-note length.
2. The service compares the returned index set with the exact supplied index set. Any count mismatch, missing index, out-of-range index, duplicate index, or extra index marks that chapter attempt invalid. The chapter is logged as failed, no prompts from that response are written, and processing continues with the next chapter. A first parse, schema, or count/index validation failure receives one retry containing the validation error; a second invalid response follows the same skip-and-continue path.

Only a successful, fully validated chapter response advances the running style note. If a chapter is skipped because it is already full, its existing non-empty prompts remain available as bounded style references for later calls.

Visual prompts follow `project.language` so the user can review them directly beside Vietnamese or English narration. The prompt instructions favor concrete, literal image language and recurring-character/location descriptions; the future image provider may translate or interpret them without changing this job contract.

### 6. Project-owned, race-safe scene writes

Add this public method to `src/server/modules/project/service.ts` and export it through `project/index.ts`:

```ts
applyEmptySceneVisualPrompts(
  projectId: string,
  updates: Array<{ sceneId: string; visualPrompt: string }>,
): Promise<ProjectDetail>
```

The method validates that update ids exist, deduplicates updates last-value-wins, and performs one atomic update for the chapter batch. Its Mongo array filters require both the target id and `visualPrompt: ''`; a prompt edited manually between the AI read and this write therefore remains untouched. If all targets are already non-empty, the method returns the current project without incrementing its version. A successful write increments the project version once.

The script module calls this public method only. It never imports `getCollection('projects')`, project repositories, or scene persistence internals. The method is intentionally separate from `patchProjectScene`: the latter remains the user-facing single-scene edit path, while this method provides a bounded batch write with the empty-prompt guard.

### 7. Partial completion, idempotency, and job result

Failures are isolated per chapter. AI errors, validation/count mismatches, and project-write conflicts are logged with the chapter number; later chapters continue. Earlier successful writes remain in the project. The job reports progress after each chapter and returns a summary such as:

```ts
{
  updatedScenes: number,
  skippedScenes: number,
  failedChapters: number[],
}
```

The worker treats a completed partial batch as a successful job with an informative final log, matching project-wide voiceover generation. Cancellation is the exception: it stops the remaining queue and lets the worker mark the job cancelled.

Reruns are idempotent with respect to authored prompts: the job may call the AI for a partially filled chapter to preserve the exact count contract, but the project write can only fill scenes whose prompt is still empty. A user-edited prompt is never silently overwritten, including under concurrent writes.

### 8. Studio behavior

Add a “Tạo visual prompt” project-level action near the existing project-wide voiceover controls. It is disabled when there are no scenes or while a project job is active, enqueues the new job, and reuses the current `useJobProgress` state/log display. On completion, failure, or cancellation, Studio refreshes the project and shows the existing toast/log treatment. The existing per-scene prompt editor remains unchanged and is the source of manual overrides.

No new page, route, or separate progress protocol is needed. The action uses the existing `/api/job/:id/events` stream and cancellation endpoint.

## Module and file changes

### Script module

- Replace the empty AI scaffold files with preset loading, prompt composition, output schemas, and parsers.
- Add documentary and explainer markdown content.
- Move initial/regeneration prompt construction out of `prompts.ts`, then delete that file.
- Add visual-prompt orchestration and its job handler.
- Extend the script router, public index, `MODULE.md`, and tests.

### Project module

- Add and export `applyEmptySceneVisualPrompts`.
- Keep all scene writes in project; no new collection or migration is introduced.

### Worker and app composition

- Register `generate-visual-prompts` in `worker/registry.ts`.
- Keep the existing script router mounting and enqueue injection in `app.ts`; no new module boundary is needed.

### Client

- Add one typed API function in the asset/Studio feature for enqueueing visual prompts.
- Add the button and reuse existing job progress/log state; no DOM testing dependency is added.

### Build

- Add the preset-copy step to the production build so runtime markdown loading works from `dist`.

## Verification strategy

Tests use mocked AI clients and `mongodb-memory-server`; no provider network calls are made.

### Preset and prompt tests

- Parse frontmatter and both required sections for both files.
- Assert the composed documentary system prompt contains a documentary-specific phrase such as “open a chapter with a hook” and does not contain the explainer-specific “one self-contained beat” phrase.
- Assert the composed explainer system prompt contains “one self-contained beat” and does not contain the documentary-specific hook phrase.
- Assert the regeneration prompt carries the selected preset guidance and prompt version.
- Assert malformed frontmatter/sections fail before an AI request.

### Output and service tests

- Validate generated chapters and regenerated paragraphs through `parse-output.ts`.
- Validate a visual batch with exact scene count and echoed indexes.
- Reject and log missing, duplicate, extra, or out-of-range scene indexes without writing that chapter's prompts.
- Verify sequential calls carry the previous successful style note.
- Verify a failed chapter does not prevent later chapter calls or writes.
- Verify cancellation between chapters stops remaining calls.
- Verify reruns fill empty prompts but leave non-empty prompts unchanged.
- Verify a concurrent/manual prompt update wins over the AI result through the empty-only project mutation.
- Verify the job route enqueues the correct type/payload and the worker registry invokes the handler.

### Project/API/client tests

- Test `applyEmptySceneVisualPrompts` for atomic batch updates, empty-only filtering, duplicate update handling, missing scene ids, and no-op behavior when all prompts are already filled.
- Test the new enqueue endpoint and Studio API response shape.
- Keep finalization tests asserting empty visual prompts and immediate scene/status persistence; prompt generation is a separate job.

Run the existing acceptance commands before implementation completion:

```text
npm run typecheck
npm run lint
npm test
npm run build
```

The build must prove the markdown presets are present in the production server artifact. `eslint.config.js` remains unchanged.

## Documentation and commit discipline

Implementation updates `AGENTS.md` Status and `src/server/modules/script/MODULE.md` in the same meaningful commits as the corresponding code. The design spec is committed separately now; implementation remains blocked until this spec is reviewed and approved.

Suggested implementation commits after spec approval:

1. `feat(script): load versioned script presets`
2. `feat(script): move prompt schemas and parsers into ai`
3. `feat(project): add race-safe empty visual prompt mutation`
4. `feat(script): add visual prompt generation job`
5. `feat(script): add visual prompt routes and worker wiring`
6. `feat(client): add Studio visual prompt action`
7. `feat(script): add preset and visual prompt coverage`
8. `docs(phase6): record script preset and visual prompt acceptance`

No implementation commit is authorized by this spec alone. The next gate is user review of this file, followed by an implementation plan.
