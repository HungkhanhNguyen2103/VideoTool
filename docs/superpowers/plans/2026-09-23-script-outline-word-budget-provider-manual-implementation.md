# Script outline, word budget, provider, manual mode, and hubris-trap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace single-call script generation with a word-budgeted outline/expansion job, add provider and manual-generation controls, add the `hubris-trap` preset, and display/finalize durations from real narration word counts.

**Architecture:** The script module owns three distinct AI response contracts: `ScriptOutlineSchema`, `ChapterExpansionSchema`, and `ManualScriptDocumentSchema`. The automatic path persists outline metadata through public project APIs, expands chapters sequentially through the existing `generate-script` job, and shares only the final persistence function with synchronous manual import. `script/routes.ts` owns script-consumer routes, including `ai-provider` and manual generation, while `project` owns the Mongo mutations.

**Tech Stack:** TypeScript strict ESM, Zod, Express 5, MongoDB driver, Vitest with `mongodb-memory-server`, React 19, TanStack Query, existing job/SSE infrastructure, and the current provider-neutral AI clients.

**Spec:** `docs/superpowers/specs/2026-09-23-script-outline-word-budget-provider-manual-design.md`

## Global Constraints

- `NARRATION_WORDS_PER_MINUTE` is `150` and `totalWordBudget = Math.round(targetDurationSec / 60 * 150)`.
- `ChapterDoc` and `ProjectDoc` receive additive Zod defaults; no migration script is added.
- `SCRIPT_PRESET_IDS` becomes exactly `['documentary', 'explainer', 'hubris-trap']`.
- Documentary and `hubris-trap` use the 5-act weighting guidance; explainer uses a flatter mostly-`rising` shape without forced hook/climax structure.
- `endsOnTension` is true for every outline chapter except the last.
- A chapter below 80% of `targetWords` receives exactly one longer/detail retry; the second valid response is accepted regardless of count.
- The automatic path is always outline then sequential chapter expansion; no threshold or hybrid automatic path is introduced.
- Provider/network calls are mocked in tests; no automated test calls VieNeu, DeepSeek, Claude, or another external provider.
- `script` imports `project` only through `src/server/modules/project/index.ts` and never writes the `projects` collection directly.
- `script/routes.ts` owns `PATCH /api/project/:id/ai-provider` because script consumes `aiProvider`; the project module owns `setProjectAiProvider`.
- The three response shapes have separate schemas and parsers: `ScriptOutlineSchema`/`parseScriptOutline`, `ChapterExpansionSchema`/`parseChapterExpansion`, and `ManualScriptDocumentSchema`/`parseManualScriptDocument`.
- Manual mode is synchronous, uses one combined prompt, stores neither prompt nor raw response, and preserves invalid pasted text in the client.
- `finalizeScript()` remains synchronous and keeps empty visual prompts and `assets` status, but scene duration estimates become word-based with a minimum of one second.
- `regenerateChapter` remains streaming and behaviorally unchanged except for receiving available role, beat, target-word, and tension metadata.
- `eslint.config.js` remains unchanged and no client DOM-testing dependency is added.
- Update `AGENTS.md` and relevant `MODULE.md` files in the same meaningful commits as code changes.
- Never use `git add -A`, `git add .`, destructive Git commands, or `git push`.
- Work directly on the real `main` checkout. Do not create a worktree or dispatch implementer/reviewer subagents. Implement, test, self-review, and commit incrementally on `main`.

## Review Focus

- Legacy project/chapter documents missing the new additive fields must normalize without changing old behavior — test in Task 1.
- A non-hubris response containing `motif`, or a hubris response missing one motif field, must fail the correct parser before persistence — test in Task 2.
- Explicit `chapterCount` must be exact while nullable `chapterCount` accepts only an AI-selected count from 1–20 — test in Task 2 and Task 4.
- A cancelled or failed expansion must not overwrite later/manual content and must not prevent later chapters from running — test in Task 4.
- Manual combined output must not accidentally be accepted by an automatic parser, and failed manual imports must leave the project unchanged while preserving the pasted text in the UI — test in Tasks 2, 5, and 7.
- Word-based finalization must update the existing finalization assertion rather than leave the old even-split `sum === 60` expectation in place — test explicitly in Task 6.

---

### Task 1: Add shared narrative contracts and the hubris-trap preset

**Files:**
- Modify: `src/contracts/project.ts`
- Modify: `src/contracts/script.ts`
- Modify: `src/server/modules/project/docs.ts`
- Modify: `src/server/modules/project/service.ts`
- Modify: `src/server/modules/script/ai/presets/loader.ts`
- Create: `src/server/modules/script/ai/presets/hubris-trap.md`
- Modify: `src/client/features/project/components/NewProjectForm.tsx`
- Test: `src/server/modules/script/ai/presets/loader.test.ts`
- Test: `src/server/modules/project` public integration coverage in `src/server/modules/script/script.test.ts`
- Modify: `AGENTS.md`
- Modify: `src/server/modules/script/MODULE.md`

**Interfaces:**
- Produces `NarrativeRole`, `OpenLoop`, `HubrisMotif`, `OpenLoopSchema`, and `HubrisMotifSchema` from `src/contracts/script.ts`.
- Produces additive `ChapterDoc` fields `role`, `beat`, `targetWords`, and `endsOnTension`, plus project `openLoops` and nullable `motif` fields.
- Produces `SCRIPT_PRESET_IDS = ['documentary', 'explainer', 'hubris-trap']` and a loadable `hubris-trap.md` with version `1`.
- Keeps `createProject` and `getProject` backward-compatible by applying defaults to legacy documents.

- [ ] **Step 1: Write failing contract/default tests**

Add tests that parse a legacy chapter/project-shaped object without the new fields and assert defaults: `role: null`, `beat: ''`, `targetWords: null`, `endsOnTension: false`, `openLoops: []`, and `motif: null`. Add a preset-loader case asserting `hubris-trap` loads with version `1` and non-empty system/instructions.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```text
npm test -- src/server/modules/script/ai/presets/loader.test.ts src/server/modules/script/script.test.ts
```

Expected failure: the new preset ID, fields, or defaults are not yet accepted.

- [ ] **Step 3: Implement the additive schemas and preset**

Add the new enum/object schemas and defaults without changing `schemaVersion`. Add the exact `hubris-trap` Vietnamese guidance from the spec, including the four motif keys and five-act instructions. Add the third option to the project preset select with label `Kẻ đi săn kiêu ngạo (Hubris Trap)`.

- [ ] **Step 4: Verify the focused tests and compatibility**

Run the focused command again, then:

```text
npm run typecheck
npm run lint
```

Expected: all focused tests, typecheck, and lint pass; no project migration is created.

- [ ] **Step 5: Commit**

```text
git add -- src/contracts/project.ts src/contracts/script.ts src/server/modules/project/docs.ts src/server/modules/project/service.ts src/server/modules/script/ai/presets/loader.ts src/server/modules/script/ai/presets/hubris-trap.md src/server/modules/script/ai/presets/loader.test.ts src/server/modules/script/script.test.ts src/client/features/project/components/NewProjectForm.tsx AGENTS.md src/server/modules/script/MODULE.md
git commit -m "feat(script): add narrative metadata and hubris trap preset"
```

### Task 2: Implement the three AI response contracts and prompt builders

**Files:**
- Modify: `src/server/modules/script/ai/output-schema.ts`
- Modify: `src/server/modules/script/ai/parse-output.ts`
- Modify: `src/server/modules/script/ai/build-prompt.ts`
- Modify: `src/contracts/script.ts`
- Modify: `src/contracts/script.ts` for the client/server-safe word-count helpers and constant
- Test: `src/server/modules/script/ai/prompt-boundary.test.ts`
- Create: `src/server/modules/script/ai/outline-boundary.test.ts`
- Modify: `src/server/modules/script/MODULE.md`

**Interfaces:**
- `parseScriptOutline(raw: string, presetId: ScriptPresetId): ScriptOutline`.
- `parseChapterExpansion(raw: string): ChapterExpansion`.
- `parseManualScriptDocument(raw: string, presetId: ScriptPresetId): ManualScriptDocument`.
- `buildOutlinePrompt(project: ProjectDetail): BuiltPrompt`.
- `buildChapterExpansionPrompt(input: ChapterExpansionPromptInput): BuiltPrompt`.
- `buildManualScriptPrompt(project: ProjectDetail): BuiltPrompt`.
- A shared word counter used by server and client duration logic, with `NARRATION_WORDS_PER_MINUTE = 150`.

- [ ] **Step 1: Write failing parser and prompt tests**

Cover:

```text
parseScriptOutline(documentary) accepts chapters/openLoops and rejects motif.
parseScriptOutline(hubris-trap) requires all four motif strings.
parseScriptOutline enforces positive targetWords, valid roles, and chapterCount exactness when requested.
parseChapterExpansion accepts paragraphs + styleNote and rejects missing/oversized styleNote.
parseManualScriptDocument accepts full chapter metadata + paragraphs and is not interchangeable with either automatic shape.
buildOutlinePrompt contains totalWordBudget, chapter-count rule, weighting guidance, and explainer-specific flatter guidance.
buildChapterExpansionPrompt contains beat, role, targetWords, endsOnTension, relevant open loops, and previous styleNote.
buildManualScriptPrompt requests one complete manual document and flattens system/user content only at the route layer.
```

Use exact documentary/hubris phrases and assert that `motif` is absent for the other presets.

- [ ] **Step 2: Run the focused AI suite and verify red**

Run:

```text
npm test -- src/server/modules/script/ai
```

Expected failure: the new parser/build-prompt exports and schemas are missing.

- [ ] **Step 3: Implement the distinct schemas/parsers**

Keep the three roots separate. Use preset-specific strict schemas for outline/manual motif presence. Keep `ChapterExpansionSchema` limited to `paragraphs` and a bounded `styleNote`. Normalize optional JSON fences through the existing parser convention, but do not make one parser dispatch on three unrelated shapes.

- [ ] **Step 4: Implement prompts and word counting**

Build the outline prompt with total budget, exact/AI-selected chapter-count instructions, role/beat/target/tension fields, and the 5-act or explainer weighting guidance. Build expansion and manual prompts with the contracts above. Implement whitespace word counting and the 150 WPM constant in a shared import-safe location.

- [ ] **Step 5: Verify green and commit**

Run:

```text
npm test -- src/server/modules/script/ai
npm run typecheck
npm run lint
```

Then commit:

```text
git add -- src/server/modules/script/ai/output-schema.ts src/server/modules/script/ai/parse-output.ts src/server/modules/script/ai/build-prompt.ts src/contracts/script.ts src/server/modules/script/ai/prompt-boundary.test.ts src/server/modules/script/ai/outline-boundary.test.ts src/server/modules/script/MODULE.md
git commit -m "feat(script): add outline and manual AI contracts"
```

### Task 3: Add project-owned provider and generated-script persistence APIs

**Files:**
- Modify: `src/server/modules/project/service.ts`
- Modify: `src/server/modules/project/index.ts`
- Modify: `src/server/modules/project/docs.ts`
- Modify: `src/contracts/project.ts`
- Modify: `src/server/modules/script/service.ts`
- Modify: `src/server/modules/script/index.ts`
- Test: `src/server/modules/script/script.test.ts`
- Modify: `src/server/modules/project/MODULE.md`
- Modify: `src/server/modules/script/MODULE.md`

**Interfaces:**
- `setProjectAiProvider(projectId: string, provider: AiProvider): Promise<ProjectDetail>`; this is the only function that writes `aiProvider`.
- Produces `replaceProjectScript(id: string, chapters: ChapterDoc[], openLoops: OpenLoop[], motif: HubrisMotif | null, snapshot: ChapterSnapshot | null, newStatus?: ProjectStatus): Promise<ProjectDetail>` as the project-owned atomic replacement for generated chapter metadata plus project-level outline metadata.
- Script service exposes one shared `saveGeneratedScript` persistence path for automatic and manual generation. It assigns fresh chapter IDs, initializes statuses, preserves metadata, and delegates all project writes through `project/index.ts`.

- [ ] **Step 1: Write failing project API tests**

Add public integration tests that set a project from DeepSeek to Claude and assert one versioned project mutation. Add tests that initialize generated chapters with metadata/open loops/motif and read them back through `getProject`. Assert legacy defaults remain stable.

- [ ] **Step 2: Run the focused project/script suite and verify red**

Run:

```text
npm test -- src/server/modules/script/script.test.ts
```

Expected failure: provider mutation and metadata persistence APIs are absent.

- [ ] **Step 3: Implement project ownership and shared save mapping**

Add the atomic provider mutation and export it from `project/index.ts`. Add the exact `replaceProjectScript` public method, extend project-to-detail mapping, and keep the existing `replaceProjectChapters` API for unrelated chapter edits. Refactor the script service's final mapping into a single `saveGeneratedScript` function that calls `replaceProjectScript` for automatic and manual callers; do not add direct `getCollection('projects')` access to script.

- [ ] **Step 4: Verify boundaries and commit**

Run:

```text
npm test -- src/server/modules/script/script.test.ts
npm run typecheck
npm run lint
rg -n "getCollection|../project/(repo|service)|modules/project/(repo|service)" src/server/modules/script --glob '!*.test.ts'
```

Expected: focused tests and checks pass; the production scan returns no direct project collection/repository access.

```text
git add -- src/server/modules/project/service.ts src/server/modules/project/index.ts src/server/modules/project/docs.ts src/contracts/project.ts src/server/modules/script/service.ts src/server/modules/script/index.ts src/server/modules/script/script.test.ts src/server/modules/project/MODULE.md src/server/modules/script/MODULE.md
git commit -m "feat(project): persist script outline metadata and provider"
```

### Task 4: Replace generateScript with the sequential outline/expansion job

**Files:**
- Modify: `src/server/modules/script/service.ts`
- Modify: `src/server/modules/script/handler.ts`
- Modify: `src/worker/registry.ts`
- Modify: `src/server/modules/script/visual-prompts.ts` only if a shared continuity/progress helper is extracted without crossing boundaries
- Test: `src/server/modules/script/script.test.ts`
- Create: `src/server/modules/script/generation.test.ts`
- Modify: `src/worker/worker.test.ts`
- Modify: `src/server/modules/script/MODULE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- `generateScript(projectId: string, context: ScriptGenerationJobContext): Promise<void>` where context has `reportProgress`, `isCancelled`, and `appendLog`.
- `handleGenerateScript` passes the real worker context, not only `appendLog`.
- The existing `generate-script` job type and payload remain `{ projectId: string }`.

- [ ] **Step 1: Write failing orchestration tests**

Build a two- or three-chapter project and mock the provider with an outline response followed by expansion responses. Assert call order, outline metadata persistence, previous `styleNote` in the next prompt, open-loop context, progress, and final chapter paragraphs. Add cases for explicit chapter-count mismatch, AI-selected 1–20 count, invalid outline, short first expansion followed by a longer retry, short second response accepted, provider failure continuing to later chapters, cancellation between chapters, cancellation after response, and cancellation before write.

Add a regression that a failed first chapter does not prevent a later chapter from being saved and that the failed chapter is marked `needs-fix`.

- [ ] **Step 2: Run the focused tests and verify red**

Run:

```text
npm test -- src/server/modules/script/generation.test.ts src/server/modules/script/script.test.ts src/worker/worker.test.ts
```

Expected failure: the current implementation still makes one `buildScriptPrompt` call and the handler does not accept/report the full context.

- [ ] **Step 3: Implement outline initialization and sequential expansion**

Load the project and provider once, compute the total budget, call/parse the outline, validate the chapter-count rule, and persist the outline-backed chapter records plus project open loops/motif. Expand chapters in order. Check cancellation before calls, after responses, and before writes. Count words and issue exactly one under-80%-target retry with actual/target counts. Accept the second valid response regardless of length. Log and mark individual failures without aborting later chapters.

Keep the worker's post-handler cancellation behavior intact so a cancelled job reaches the existing terminal cancellation state.

- [ ] **Step 4: Verify green and job wiring**

Run:

```text
npm test -- src/server/modules/script/generation.test.ts src/server/modules/script/script.test.ts src/worker/worker.test.ts
npm run typecheck
npm run lint
```

Expected: all orchestration, cancellation, progress, and worker tests pass.

- [ ] **Step 5: Commit**

```text
git add -- src/server/modules/script/service.ts src/server/modules/script/handler.ts src/worker/registry.ts src/server/modules/script/generation.test.ts src/server/modules/script/script.test.ts src/worker/worker.test.ts src/server/modules/script/MODULE.md AGENTS.md
git commit -m "feat(script): generate scripts from outline and chapter expansions"
```

### Task 5: Add provider route and synchronous manual generation routes

**Files:**
- Modify: `src/server/modules/script/routes.ts`
- Modify: `src/server/modules/script/index.ts`
- Modify: `src/server/app.ts` only if the existing script router mount needs no other change
- Modify: `src/server/modules/script/service.ts`
- Test: `src/server/modules/script/script.test.ts`
- Test: `src/server/modules/script/ai/prompt-boundary.test.ts`
- Modify: `src/server/modules/script/MODULE.md`

**Interfaces:**
- `PATCH /api/project/:id/ai-provider` with `{ provider: 'deepseek' | 'claude' }` returns `ProjectDetail`; route calls `setProjectAiProvider` via the public project API.
- `GET /api/project/:id/generate-script/manual-prompt` returns `{ prompt: string; promptVersion: string }`.
- `POST /api/project/:id/generate-script/manual-import` accepts `{ raw: string }` and returns `ProjectDetail` on success.
- Manual import calls `parseManualScriptDocument` and the same `saveGeneratedScript` path as the automatic job; it never calls `getAiClient`.

- [ ] **Step 1: Write failing route/service tests**

Test exact provider route ownership/delegation, invalid provider rejection, manual prompt response shape and flattened content, manual import success, malformed JSON/schema `SCRIPT_PARSE_ERROR`, and project unchanged after failed import. Assert provider and manual routes do not enqueue jobs.

- [ ] **Step 2: Run focused routes and verify red**

Run:

```text
npm test -- src/server/modules/script/script.test.ts
```

Expected failure: the new routes are absent.

- [ ] **Step 3: Implement routes and manual flow**

Add strict request schemas in `script/routes.ts`. Keep route logic thin: parse, call the script/project public service, respond. Flatten the manual `BuiltPrompt` into labeled system/user text only for the response. Keep raw pasted text out of Mongo and return the existing error shape on parse failure.

- [ ] **Step 4: Verify and commit**

Run focused tests, typecheck, lint, and a route scan confirming the new provider route is in `src/server/modules/script/routes.ts` and no job-create/list endpoint was added. Commit:

```text
git add -- src/server/modules/script/routes.ts src/server/modules/script/index.ts src/server/modules/script/service.ts src/server/modules/script/script.test.ts src/server/modules/script/ai/prompt-boundary.test.ts src/server/modules/script/MODULE.md
git commit -m "feat(script): add provider and manual generation routes"
```

### Task 6: Switch review duration helpers and finalization to word-based estimates

**Files:**
- Modify: `src/server/modules/script/service.ts`
- Modify: `src/client/features/script/chapter-actions.ts`
- Modify: `src/client/features/script/chapter-actions.test.ts`
- Modify: `src/server/modules/script/script.test.ts`
- Modify: `src/contracts/script.ts` shared word-count helper/constants
- Modify: `src/server/modules/script/MODULE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- `countNarrationWords(text: string): number` is deterministic and shared by server/client-safe code.
- `estimateNarrationDurationSec(text: string): number` returns `Math.max(1, Math.round(words / 150 * 60))`.
- `chapterMetaText` and `chaptersSummaryText` use actual paragraph word counts before finalization.
- `finalizeScript()` uses per-paragraph word estimates and sums them into chapter `durationSec`.

- [ ] **Step 1: Update the existing finalization test before adding new assertions**

Modify the existing `script.test.ts` test named `finalizes approved chapters into scenes and sets status assets`. Replace its single-word paragraph fixture and old even-split assertion:

```ts
expect(saved.scenes.reduce((sum, scene) => sum + scene.durationSec, 0)).toBe(60);
```

with narration whose word counts make the new rule visible, and assert exact per-scene values plus their new sum. For example, three paragraphs with 1, 2, and 4 whitespace-delimited words must produce `[1, 1, 2]` and sum to `4`, not `60`. Keep the existing assertions for `assets`, scene count, empty visual prompts, and chapter metadata.

- [ ] **Step 2: Write failing duration-helper tests**

Add pure tests for zero/empty text, one-word text, a 150-word text producing 60 seconds, chapter word totals, and review summary/meta output. Run:

```text
npm test -- src/client/features/script/chapter-actions.test.ts src/server/modules/script/script.test.ts
```

Expected failure: the updated finalization expectation and new helpers do not match the current even-split implementation.

- [ ] **Step 3: Implement shared counting and duration changes**

Add the shared constant/helper, change `finalizeScript()` to compute each scene independently with the one-second minimum, and update chapter duration totals. Update review helpers to derive estimates from `chapter.paragraphs`; do not display a pre-finalization duration when there are no paragraphs.

- [ ] **Step 4: Verify green and commit**

Run focused tests, typecheck, and lint. Expected: the old `sum === 60` assertion is gone, the exact new per-scene assertion passes, and no finalization behavior besides duration calculation changes.

```text
git add -- src/server/modules/script/service.ts src/client/features/script/chapter-actions.ts src/client/features/script/chapter-actions.test.ts src/server/modules/script/script.test.ts src/contracts/script.ts src/server/modules/script/MODULE.md AGENTS.md
git commit -m "feat(script): estimate durations from narration words"
```

### Task 7: Add provider/manual controls and metadata-aware review UI

**Files:**
- Modify: `src/client/features/project/components/NewProjectForm.tsx`
- Modify: `src/client/features/script/api.ts`
- Modify: `src/client/features/script/ReviewScriptPage.tsx`
- Modify: `src/client/features/script/chapter-actions.ts`
- Modify: `src/client/features/script/chapter-actions.test.ts`
- Modify: `src/client/features/script/script-api.test.ts`
- Modify: `src/client/features/script/ReviewScriptPage.module.css`
- Test: pure client helpers in existing script client tests; no DOM dependency
- Modify: `AGENTS.md`
- Modify: `src/server/modules/script/MODULE.md`

**Interfaces:**
- Client API functions `setAiProvider`, `getManualScriptPrompt`, and `importManualScript` validate existing `ProjectDetail`/new response schemas through `apiRequest`.
- `ReviewScriptPage` keeps local manual raw text on validation error and refreshes project state after successful import/provider change.

- [ ] **Step 1: Write failing client API/helper tests**

Assert exact provider PATCH URL/body, manual prompt GET URL/response, manual import POST body/response, and duration metadata for a chapter with known word counts. Add pure state/helper coverage for automatic/manual mode selection and preserving pasted text after a failed import; do not add jsdom/testing-library.

- [ ] **Step 2: Run focused client tests and verify red**

Run:

```text
npm test -- src/client/features/script
```

Expected failure: provider/manual client functions and new UI helpers are absent.

- [ ] **Step 3: Implement project creation/provider controls**

Add the provider select to `NewProjectForm` using `AI_PROVIDERS`. Add provider buttons/selectors near generation controls on `ReviewScriptPage`; disable them while an initial job or chapter regeneration is active, and refresh after success.

- [ ] **Step 4: Implement manual copy/import UI**

Add `Tự động`/`Thủ công` mode controls when no chapters exist. Copy the server-returned combined prompt with `navigator.clipboard.writeText`, hold pasted raw text in component state, submit it to manual import, show parse errors without clearing the textarea, and refresh into the existing chapter-review view after success.

- [ ] **Step 5: Wire metadata display and verify**

Show target words, role/beat/tension metadata where useful in the chapter header/body without changing edit/save behavior. Run focused tests, typecheck, lint, and build. Commit:

```text
git add -- src/client/features/project/components/NewProjectForm.tsx src/client/features/script/api.ts src/client/features/script/ReviewScriptPage.tsx src/client/features/script/chapter-actions.ts src/client/features/script/chapter-actions.test.ts src/client/features/script/script-api.test.ts src/client/features/script/ReviewScriptPage.module.css AGENTS.md src/server/modules/script/MODULE.md
git commit -m "feat(client): add provider and manual script controls"
```

### Task 8: Complete regression coverage and record acceptance

**Files:**
- Modify: `src/server/modules/script/ai/presets/loader.test.ts`
- Modify: `src/server/modules/script/ai/prompt-boundary.test.ts`
- Modify: `src/server/modules/script/ai/outline-boundary.test.ts`
- Modify: `src/server/modules/script/generation.test.ts`
- Modify: `src/server/modules/script/script.test.ts`
- Modify: `src/worker/worker.test.ts`
- Modify: `src/client/features/script/script-api.test.ts`
- Modify: `src/client/features/script/chapter-actions.test.ts`
- Modify: `AGENTS.md`
- Modify: `src/server/modules/script/MODULE.md`
- Create: `docs/superpowers/acceptance/2026-09-23-script-outline-word-budget-provider-manual-acceptance.md`

**Interfaces:**
- This task adds regression assertions and acceptance evidence only; production interfaces come from Tasks 1–7.

- [ ] **Step 1: Add cross-feature regression cases**

Ensure the suite covers:

```text
documentary vs explainer vs hubris prompt distinction;
motif required/forbidden behavior;
exact and AI-selected chapter counts;
outline → expansion ordering and continuity;
80%-retry/second-response acceptance;
failed/cancelled partial jobs;
provider route ownership and mutation delegation;
manual combined parser/import preservation;
word-based ReviewScriptPage metadata;
finalization's updated existing per-scene duration assertion;
existing regeneration, visual-prompt, SSE, and finalization regressions.
```

- [ ] **Step 2: Run focused and full verification**

Run exactly:

```text
npm run typecheck
npm run lint
npm test
npm run build
```

Then verify:

```text
node -e "const fs=require('node:fs'); for (const file of ['dist/presets/documentary.md','dist/presets/explainer.md','dist/presets/hubris-trap.md']) { if (!fs.existsSync(file)) throw new Error(file + ' missing'); }"
git diff -- eslint.config.js
rg -n "DEEPSEEK_API_KEY|ANTHROPIC_API_KEY" dist/client
rg -n "getCollection|../project/(repo|service)|modules/project/(repo|service)" src/server/modules/script --glob '!*.test.ts'
```

Expected: tests/typecheck/lint/build pass, all three preset artifacts exist, lint configuration is unchanged, the client has no provider secrets, and script production code has no direct project persistence access.

- [ ] **Step 3: Write acceptance documentation with observed counts**

Record exact command output, mocked-provider/no-network status, `mongodb-memory-server` behavior, copied preset paths, route ownership, parser separation, word-based finalization, and any remaining live-provider/browser gap. Do not invent counts before reading the output.

- [ ] **Step 4: Commit acceptance**

```text
git add -- src/server/modules/script/ai/presets/loader.test.ts src/server/modules/script/ai/prompt-boundary.test.ts src/server/modules/script/ai/outline-boundary.test.ts src/server/modules/script/generation.test.ts src/server/modules/script/script.test.ts src/worker/worker.test.ts src/client/features/script/script-api.test.ts src/client/features/script/chapter-actions.test.ts AGENTS.md src/server/modules/script/MODULE.md docs/superpowers/acceptance/2026-09-23-script-outline-word-budget-provider-manual-acceptance.md
git commit -m "docs(phase7): record script outline and manual mode acceptance"
```

## Plan self-review

- **Spec coverage:** Task 1 covers additive schemas and `hubris-trap`; Task 2 covers three parser contracts, prompts, word counting, and explainer shape; Task 3 covers project ownership and shared persistence; Task 4 covers the two-stage job, retry, progress, and cancellation; Task 5 covers script-owned provider/manual routes; Task 6 covers review/finalization duration behavior and explicitly replaces the old existing test assertion; Task 7 covers provider/manual UI; Task 8 covers regressions and production acceptance.
- **Placeholder scan:** No task depends on an unspecified parser, route, field, or test family; every named production interface is introduced before its consumer.
- **Type consistency:** The outline/expansion/manual parser names are distinct throughout; `NarrativeRole`, `OpenLoop`, and `HubrisMotif` are shared contracts; `saveGeneratedScript` is the only shared persistence path; `setProjectAiProvider` is project-owned while its route is script-owned.
- **Review focus mapping:** Legacy defaults → Task 1; preset-specific motif validation and chapter-count bounds → Task 2; cancellation/partial writes → Task 4; manual parser/import preservation → Tasks 2, 5, and 7; old finalization assertion → Task 6.
- **Execution mode:** The user explicitly selected native execution on the real `main` checkout with no worktree and no per-task implementer/reviewer subagents. This plan preserves that method and still requires TDD, incremental commits, full verification, and self-review.
