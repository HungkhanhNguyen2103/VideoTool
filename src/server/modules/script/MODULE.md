# Module: script

**Purpose:** Generate and review chapter-based scripts with a provider-neutral AI client, then finalize approved chapters into project scenes.
**Owns collection(s):** none; chapter/history and scene writes remain owned by the project module.
**May import (via their index.ts only):** project
**Public API:** only what `index.ts` exports. Nothing else in this module may be imported from outside.

## Invariants
- Phase 3 Prompt 1 complete: shared contracts, project-owned chapter/history persistence, provider-neutral AI adapters, prompts, generation/regeneration/finalization service, explicit worker handler, project routes/SSE, edge coverage, typed client streaming API, and ReviewScriptPage are implemented and verified.
- The module may call the project module only through its public `index.ts`; it must not write the `projects` collection directly.
- Versioned Markdown files in `ai/presets/*.md` are the only preset source; `ai/presets/loader.ts` validates and loads them, and production builds copy them beside the bundled server and worker.
- `SCRIPT_PRESET_IDS` includes `documentary`, `explainer`, and `hubris-trap`; `ChapterDoc` narrative metadata and project `openLoops`/`motif` use additive defaults so legacy documents need no migration.
- `ChapterDoc` continuity metadata uses additive defaults: `chapterSummary: null`, `avoidRepeating: []`, `persistentFacts: []`, and `reviewStatus: 'clean'`; project `coreQuestion` and `openingHook` default to empty strings for legacy reads.
- Outline and manual document contracts require non-empty root `coreQuestion` and `openingHook`; automatic outline generation persists both through `saveGeneratedScript`. Act-weighting ratios live only in `ai/presets/config.ts`: documentary is soft, hubris-trap is strict, and explainer has none.
- Initial generation and chapter regeneration compose selected preset guidance in `ai/build-prompt.ts`; the prompt version is `script-prompt-v1/<id>@<version>`. The service uses `ai/parse-output.ts` for both response types, preserving the existing 422 `SCRIPT_PARSE_ERROR` contract and final scene shape.
- Automatic generation uses separate outline and chapter-expansion contracts; manual mode uses its own complete-document contract. Preset-specific motif validation and explicit/AI-selected chapter-count validation happen before persistence. Shared narration word counting uses `NARRATION_WORDS_PER_MINUTE = 150`.
- `saveGeneratedScript` is the shared persistence path for automatic and manual script documents: it assigns fresh chapter IDs, initializes pending status, preserves narrative metadata, and delegates project writes through `project/index.ts`.
- Script owns the provider and manual-generation routes because it consumes AI settings and parsers: provider changes delegate to `project.setProjectAiProvider`, manual prompts flatten system/user text for display, and manual imports never call an AI client or enqueue a job.
- The client exposes provider selection, automatic/manual entry controls, paste/import error preservation, and narrative metadata in the review page; API helpers validate all provider/manual responses through contracts.
- Visual-prompt generation slices finalized scenes by chapter count, assigns stable project-global one-based indexes, and sends every scene's narration and current prompt as reference. Internal scene IDs never enter the AI request.
- Each visual batch must pass schema and exact index-set validation before a chapter write. A parse, schema, or index failure gets one retry with the validation error; provider and project-write failures are isolated to their chapter. Successful batches write only empty prompts through the public `project.applyEmptySceneVisualPromptsWithResult` companion, whose atomic pre-image IDs provide exact update counts.
- The running continuity note starts as an ordered excerpt of all existing non-empty project prompts, capped at 500 characters. Only a successful chapter response replaces it with that batch's bounded `styleNote`; failed and skipped chapters preserve it. Progress is rounded by chapter, and the result records updated scenes, prefilled skipped scenes, and failed chapter numbers.
- The structural `VisualPromptJobContext` does not import `job`. The handler parses `{ projectId }` and checks cancellation before orchestration. Orchestration checks before each call and after each response, discarding in-flight output when cancelled so the worker's post-handler check marks the job cancelled.
- `POST /api/project/:id/scenes/generate-visual-prompts` is script-owned because it enqueues preset-aware narration-to-visual work. It accepts only projects with non-empty scenes, positive `scenesCount` on every chapter, and a chapter-count sum equal to the scene array length; otherwise it returns `SCENES_NOT_READY` without creating a job. The exact `generate-visual-prompts` handler is registered in `src/worker/registry.ts`.

## Flow
- Generate chapters asynchronously through the `generate-script` job: persist a validated outline first, then expand chapters sequentially with one short-response retry and cooperative cancellation.
- Regenerate one chapter through inline SSE so token chunks can be cancelled by the client.
- Snapshot chapter state before mutations and retain the newest ten snapshots.
- Normalize legacy project documents on read so new `aiProvider`, `chapters`, and `chapterHistory` fields receive schema defaults.
- Paragraph edits reset a chapter to `pending`; empty generated chapter lists and empty finalizations are rejected before any write.
- Finalize approved chapters by asking the project module to replace scenes and advance project status.

## Chapter state machine

```text
pending ──approve──> approved
   │                    │
   └─regenerate──> generating ──success──> pending
                         └────abort/error──> needs-fix
needs-fix ──edit/regen──> pending or generating
```

## Regeneration and history
- Initial generation does not snapshot an empty chapter array.
- Existing-array mutations snapshot first; project-owned persistence prepends the snapshot and prunes to the newest ten.
- Regeneration uses inline SSE rather than the job queue because the user needs token-by-token preview and immediate AbortController cancellation; initial generation remains a job because it is a whole-project operation.

## Finalization
- Every chapter must be `approved`.
- Paragraphs become ordered scenes with fresh ULIDs, empty `visualPrompt`, per-paragraph word-based duration estimates with a one-second minimum, and at least one scene per chapter; the target duration is not forced onto the finalized estimate.
- Finalized scenes explicitly start with `assetType: 'image'` and `assetFileId: null` for the Phase 4 Studio workflow.
- Chapter metadata/history is persisted before the final scene write; `replaceProjectScenes(projectId, scenes, 'assets')` atomically updates scenes and project status.

## AI abstraction
- `src/server/shared/ai/` owns the `AiClient` interface, DeepSeek/OpenAI-compatible adapter, Claude adapter, and provider factory.
- Provider keys remain server/worker-only; the client receives only project/provider metadata and job/SSE results.
- `generateVisualPrompts(projectId, context)` returns `{ updatedScenes, skippedScenes, failedChapters }`; `handleGenerateVisualPrompts(job, context)` is the public job handler for later worker registration.

## Known pitfalls
- Keep the shared chapter schema in `contracts/script.ts` to avoid a project-to-script import cycle.
- Preserve the existing project status vocabulary (`assets`, `rendered`) unless an explicit migration is approved.
- Use the existing job context (`isCancelled`, `appendLog`) and registry location in `src/worker/registry.ts`.
- AI keys are server-only; absent keys warn when an adapter is constructed and provider streams honor `AbortSignal`.
- Finalization updates scenes and `assets` status atomically through `replaceProjectScenes`; chapter metadata/history is persisted before that final scene/status write.
- The script handler is structurally compatible with `JobHandler` without importing the job module, so the module boundary remains enforced.
- Routes receive job enqueueing from the app composition root and distinguish normal request-body close from an actual SSE response disconnect.
- Regeneration transitions update only the target chapter, preserving unrelated concurrent edits; the client serializes bulk regeneration and aborts its active stream on unmount or project change.
- Edge coverage verifies ten-snapshot pruning, restore bounds, duration rounding, malformed-stream errors, and the absence of a false successful `done` event.
- The client parser buffers split SSE frames and uses fetch/ReadableStream plus AbortController for regeneration; ReviewScriptPage's stepper state and shared theme-token usage are covered by pure Node tests, while full page rendering remains untested without a DOM dependency.

## Acceptance
- Task 1: additive legacy-default tests and preset-loader/package tests cover the third preset and narrative metadata; focused tests pass 52/52, typecheck/lint pass, and the full suite passes 255 tests with the pre-existing project todo skipped.
- Phase 6 final acceptance: `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` passed. Vitest reports 20 files passed, 1 skipped and 252 tests passed, 1 skipped; `mongodb-memory-server` ran successfully and AI provider calls were mocked. Presets were verified at `dist/presets/documentary.md` and `dist/presets/explainer.md`; see `docs/superpowers/acceptance/2026-09-23-phase6-script-presets-visual-prompts-acceptance.md`.
- Task 7 regression suite: focused script/AI/worker/client tests 106 passed; typecheck and lint passed; full suite 252 passed with one pre-existing skipped project todo. Coverage pins preset phrase separation, explainer regeneration versioning, all visual index/count validation paths and one-retry behavior, rerun style seeding, cancellation, manual-edit races, route/worker/client contracts, and finalization's empty visual prompts.
- Phase 7 final acceptance: the full suite passes 282 tests across 22 files with the pre-existing project todo skipped; typecheck, lint, build, three-preset packaging, client secret scan, and script module-boundary scan pass. Regression coverage explicitly pins chapter-relevant open-loop filtering, manual chapter-count rejection before persistence, and review/finalization parity for per-paragraph word-based durations. See `docs/superpowers/acceptance/2026-09-23-script-outline-word-budget-provider-manual-acceptance.md`.
- Task 5 route/worker focused tests: 45 passed; `npm run typecheck` and `npm run lint` passed. The endpoint enqueue test asserts the exact job type/payload, three readiness-invalid cases assert no enqueue, and worker tests cover context mapping and pre-cancelled jobs.
- Task 4 review round 1: focused visual-prompt/project tests passed 50/50; typecheck, lint, and full suite passed with 241 tests and one pre-existing skipped project todo. Coverage includes a corrected validation retry, cancellation gates, project-write isolation, style seeding after a failure, and atomic same-value/count races.
- Task 4 focused orchestration/prompt-boundary suite: 31 tests passed. Typecheck and lint passed; the full suite passed with 231 tests and the pre-existing project todo skipped. Mongo-backed tests used `mongodb-memory-server` and mocked provider chat calls.
- Task 2 focused AI boundary suite: 33 tests passed; typecheck, lint, and full suite (216 passed, 1 skipped) passed on Windows. This task did not run a production build.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass; Vitest reports 81 passed and 3 stub files skipped.
- `mongodb-memory-server` ran successfully; no fallback was required.
- Built worker logged startup and graceful SIGINT shutdown.
- `eslint.config.js` was unchanged; only `openai` and `@anthropic-ai/sdk` were added as direct runtime dependencies.
