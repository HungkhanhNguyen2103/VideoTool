# Phase 3 Script Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement provider-neutral chapter script generation, review/regeneration/history APIs, final scene splitting, the `generate-script` worker job, and the Duyệt & Tái Tạo client page while preserving the project's module ownership rules.

**Architecture:** Shared chapter/provider contracts live under `src/contracts`; the project module remains the sole writer of `projects`; the script module orchestrates AI, chapter workflows, routes, and the job handler through the project and job public APIs. Initial generation runs as a job with progress logs, while per-chapter regeneration uses an abortable fetch/ReadableStream SSE connection so token chunks are visible immediately.

**Tech Stack:** TypeScript strict ESM, Zod, MongoDB driver, Express 5, Vitest + `mongodb-memory-server`, OpenAI-compatible DeepSeek client, Anthropic SDK, React 19, React Router, TanStack Query, CSS Modules.

**Spec:** `docs/superpowers/specs/2026-09-22-phase3-script-design.md`

## Global Constraints

- Install only `openai` and `@anthropic-ai/sdk`; `@types/node` is already present.
- No provider key may enter `client/`; absent server keys warn at import time and fail only when a call is attempted.
- `project` is the only module that writes `projects`; script code imports project functions only through `src/server/modules/project/index.ts`.
- Preserve `PROJECT_STATUSES = draft | script | assets | rendered`; generation sets `script`, finalization sets `assets`.
- Initial generation does not create a history snapshot; mutations of an existing chapter array snapshot first and retain only the newest ten.
- Use the existing `JobContext.isCancelled()` and `appendLog()` APIs; register handlers explicitly in `src/worker/registry.ts`.
- Keep routes thin, validate every body/param with Zod, and do not add public job create/list routes.
- Do not add automated tests to the existing `project` module test surface; script tests exercise the public project-service methods instead.
- Update `AGENTS.md` Status and `src/server/modules/script/MODULE.md` in the same commit as every meaningful implementation change.
- Stage only files with real content changes; never use `git add -A` or `git add .`; never push.

## Review Focus

- **Boundary cycle/ownership:** `project/docs.ts` must import shared chapter schemas from `contracts/script.ts`, and no script file may call `getCollection('projects')`; pin with typecheck/lint and a script integration assertion that uses project public methods.
- **Provider configuration and abort:** missing keys must not crash module import, provider stream abort must stop iteration, and no client bundle may contain provider names/keys; pin with mocked adapter tests and a dependency/boundary scan.
- **Malformed/fenced AI output:** invalid JSON or a non-array/chapter shape must map to `SCRIPT_PARSE_ERROR` without a partial write; pin with service tests for malformed JSON and markdown-fenced output.
- **History ordering/pruning:** every existing-array mutation snapshots the pre-mutation state, restore index `0` is newest, and history never exceeds ten; pin with regen, patch/restore, finalize, and eleven-snapshot tests.
- **SSE framing/abort:** chunks are emitted in order, `done` is emitted once only after persistence, abort leaves old paragraphs and marks `needs-fix`, and no event is written after the request closes; pin with route stream tests.

---

### Task 1: Shared contracts and project-owned chapter persistence

**Files:**
- Create: `src/contracts/script.ts`
- Modify: `src/contracts/project.ts`
- Modify: `src/server/modules/project/docs.ts`
- Modify: `src/server/modules/project/service.ts`
- Modify: `src/server/modules/project/index.ts`
- Modify: `src/server/modules/project/MODULE.md`
- Modify: `AGENTS.md`
- Test: no new project-module test file (existing project-test omission remains a decision)

**Interfaces:**
- Produces `ChapterDocSchema`, `ChapterSnapshotSchema`, `CHAPTER_STATUSES`, `ChapterDoc`, `ChapterSnapshot` from `contracts/script.ts`.
- Produces project-service methods exported from `project/index.ts`:

```ts
replaceProjectChapters(
  projectId: string,
  chapters: ChapterDoc[],
  snapshot: ChapterSnapshot | null,
  newStatus?: ProjectStatus,
): Promise<ProjectDetail>;

patchProjectChapter(
  projectId: string,
  chapterId: string,
  patch: Partial<Pick<ChapterDoc, 'paragraphs' | 'status' | 'title'>>,
  snapshot?: ChapterSnapshot | null,
): Promise<ProjectDetail>;

restoreProjectChapters(
  projectId: string,
  chapters: ChapterDoc[],
  snapshot: ChapterSnapshot,
): Promise<ProjectDetail>;

getProjectHistory(projectId: string): Promise<ChapterSnapshot[]>;
```

- Extends `ProjectDetail` and `CreateProjectRequest` with `aiProvider`; extends project documents/details with `chapters` and `chapterHistory` where appropriate.

- [ ] **Step 1: Add failing contract/type fixtures**

Add a `ChapterDoc`/`ChapterSnapshot` fixture to the script test scaffold and update the existing project input fixtures with `aiProvider: 'deepseek'`. Assert that a parsed new project detail contains `chapters: []`, `chapterHistory: []`, and `aiProvider: 'deepseek'`.

- [ ] **Step 2: Run the focused type/test check**

Run: `npm test -- src/server/modules/script/script.test.ts`  
Expected: FAIL because the new schemas and fields do not exist yet.

- [ ] **Step 3: Implement shared schemas and project document defaults**

Define the schemas in `src/contracts/script.ts`, re-export them from `src/server/modules/script/docs.ts` later, and import only from `contracts/script.ts` in `project/docs.ts`. Add `AI_PROVIDERS` and the `aiProvider` default to request/detail contracts. Persist empty chapter/history arrays in `createProject`; carry them through duplicate without renaming existing statuses.

- [ ] **Step 4: Implement public project-service chapter/history writes**

Use the existing project collection owner. Atomic updates must set `updatedAt`, increment `version`, and, when a snapshot is supplied, prepend it and slice history to ten entries. Chapter patches use array filters. Missing projects/chapters map to the existing `NotFound` behavior. Return refreshed `ProjectDetail` from public service methods; script code must never import project `repo.ts`.

- [ ] **Step 5: Run verification**

Run: `npm run typecheck` and `npm run lint`  
Expected: PASS with no new boundary exception and no project-to-script import.

- [ ] **Step 6: Commit**

```text
git add -- AGENTS.md src/contracts/project.ts src/contracts/script.ts src/server/modules/project/docs.ts src/server/modules/project/service.ts src/server/modules/project/index.ts src/server/modules/project/MODULE.md
git commit -m "feat(contracts): add AI provider and chapter contracts"
```

### Task 2: Provider-neutral AI clients

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `.env.example`, `src/server/config.ts`
- Create: `src/server/shared/ai/types.ts`
- Create: `src/server/shared/ai/deepseek.ts`
- Create: `src/server/shared/ai/claude.ts`
- Create: `src/server/shared/ai/index.ts`
- Create: `src/server/shared/ai/ai.test.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces `ChatMessage`, `AiClient`, and `getAiClient(provider: AiProvider): AiClient`.
- DeepSeek uses OpenAI-compatible `https://api.deepseek.com` and model `deepseek-chat`.
- Claude uses model `claude-opus-4-5` and maps text blocks/deltas into the common interface.

- [ ] **Step 1: Install only the approved dependencies**

Run: `npm install openai @anthropic-ai/sdk`  
Confirm `@types/node` is already present; do not install another package.

- [ ] **Step 2: Write failing adapter/factory tests**

Mock `openai` and `@anthropic-ai/sdk` with Vitest. Assert factory singleton identity per provider, DeepSeek `chat` message mapping, Claude text-block extraction, stream chunk forwarding, and that constructing adapters with empty keys does not throw at import time.

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- src/server/shared/ai/ai.test.ts`  
Expected: FAIL because the common types/factory/adapters are absent.

- [ ] **Step 4: Implement adapters and environment parsing**

Add empty-key warnings through the existing logger, pass `AbortSignal` to OpenAI calls, and abort Claude streams when the signal fires. Keep SDK imports server-only. Add `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, and `DEFAULT_AI_PROVIDER=deepseek` to `.env.example`; validate the provider in `loadConfig` without putting secrets into any client config.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm test -- src/server/shared/ai/ai.test.ts` and `npm run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit**

```text
git add -- .env.example package.json package-lock.json src/server/config.ts src/server/shared/ai AGENTS.md
git commit -m "feat(ai): add DeepSeek and Claude clients"
```

### Task 3: Script docs, prompts, and service workflows

**Files:**
- Create/modify: `src/server/modules/script/docs.ts`, `prompts.ts`, `repo.ts`, `service.ts`
- Create: `src/server/modules/script/script.test.ts`
- Modify: `src/server/modules/project/MODULE.md`, `src/server/modules/script/MODULE.md`, `AGENTS.md`

**Interfaces:**
- Produces `generateScript(projectId, appendLog): Promise<void>`.
- Produces `regenerateChapter(projectId, chapterId, opts, onChunk, signal): Promise<ChapterDoc>`.
- Produces `finalizeScript(projectId): Promise<void>`.
- Produces `buildScriptPrompt(project): { system: string; user: string }` and a typed regeneration prompt builder.
- The script repository contains query-only helpers; all chapter/history writes go through project service exports.

- [ ] **Step 1: Write failing service tests**

In `script.test.ts`, start/stop `mongodb-memory-server`, insert projects through `createProject`, mock `getAiClient`, and add tests for:

```ts
await generateScript(project.id, appendLog);
expect((await getProject(project.id)).chapters).toHaveLength(2);
expect((await getProject(project.id)).status).toBe('script');

await expect(generateScript(project.id, vi.fn())).rejects.toMatchObject({ code: 'SCRIPT_PARSE_ERROR', status: 422 });

const chapter = await regenerateChapter(project.id, chapterId, { instruction: 'shorter', level: 'light' }, chunks.push, signal);
expect(chunks).toEqual(['first', ' second']);
expect(chapter.status).toBe('pending');
expect((await getProjectHistory(project.id))[0].chapters[0].paragraphs).toEqual(oldParagraphs);
```

Also pin abort behavior: abort the signal during the mocked async stream, expect rejection/termination, then assert the persisted chapter has `status: 'needs-fix'` and unchanged paragraphs. Add invalid JSON, fenced JSON, and non-array shape cases.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- src/server/modules/script/script.test.ts`  
Expected: FAIL because the service, prompts, and script docs are not implemented.

- [ ] **Step 3: Implement docs and prompt builders**

Re-export shared chapter/snapshot schemas from `script/docs.ts`. `buildScriptPrompt` must include title, brief, references, preset, language, chapter count, and target duration, explicitly require JSON array-only output, and require content in `project.language`. The regeneration prompt includes current paragraphs, instruction, and level.

- [ ] **Step 4: Implement initial generation**

Load the project through `project/index.ts`, log the four required milestones, call `getAiClient(project.aiProvider).chat`, parse strict JSON after rejecting/stripping only a single optional markdown fence, validate an array of `{ no, title, paragraphs, scenesCount: null, durationSec: null }`, assign fresh ULIDs and `pending`, then call `replaceProjectChapters(projectId, chapters, null, 'script')`. Do not create history for this first generation.

- [ ] **Step 5: Implement regeneration and history**

Take the current chapter snapshot before setting `generating`; stream through `AiClient.stream`, call `onChunk` in arrival order, and use `patchProjectChapter`/`replaceProjectChapters` to persist the state transitions. On abort, preserve old paragraphs and persist `needs-fix`; on parse/provider failure, leave a recoverable status and throw a mapped error. Successful regeneration preserves `id`, `no`, `title`, scene metadata and sets `pending`.

- [ ] **Step 6: Implement finalization math and scenes**

Reject any non-approved chapter with `AppError('NOT_ALL_APPROVED', 'All chapters must be approved before finalizing.', 422)`. Snapshot first, allocate integer chapter durations proportionally by paragraph count with deterministic remainder handling, enforce `scenesCount >= 1`, build one scene per paragraph with fresh ULIDs/empty visual prompts, call `replaceProjectScenes`, then update project status to `assets` through the project service.

- [ ] **Step 7: Run service tests and lint**

Run: `npm test -- src/server/modules/script/script.test.ts`, `npm run typecheck`, and `npm run lint`  
Expected: all focused tests pass; no direct `getCollection('projects')` import from script and no boundary errors.

- [ ] **Step 8: Commit**

```text
git add -- src/server/modules/script src/server/modules/project src/contracts/script.ts AGENTS.md
git commit -m "feat(script): add docs, prompts and service workflows"
```

### Task 4: Generation job handler and worker registration

**Files:**
- Create: `src/server/modules/script/handler.ts`
- Modify: `src/server/modules/script/index.ts`, `src/worker/registry.ts`
- Create/modify: `src/worker/worker.test.ts`
- Modify: `src/server/modules/script/MODULE.md`, `AGENTS.md`

**Interfaces:**
- Produces `ScriptJobPayload = { projectId: string }` and `handleGenerateScript(job, context)`.
- Registers the exact key `'generate-script'` in the existing explicit `jobHandlers` map.

- [ ] **Step 1: Write failing registry/handler tests**

Assert `jobHandlers['generate-script']` exists, a queued job invokes `generateScript` with `job.payload.projectId` and `context.appendLog`, and a pre-cancelled job returns without calling the service.

- [ ] **Step 2: Run focused worker tests**

Run: `npm test -- src/worker/worker.test.ts`  
Expected: FAIL because the registry remains empty.

- [ ] **Step 3: Implement handler and registration**

Parse `job.payload` with a Zod payload schema, check `if (await context.isCancelled()) return`, then call `generateScript(payload.projectId, context.appendLog)`. Export the payload type/handler through the script public index as needed; do not introduce dynamic registration.

- [ ] **Step 4: Run tests/typecheck and commit**

Run: `npm test -- src/worker/worker.test.ts` and `npm run typecheck`  
Expected: PASS.

```text
git add -- src/server/modules/script/handler.ts src/server/modules/script/index.ts src/worker/registry.ts src/worker/worker.test.ts src/server/modules/script/MODULE.md AGENTS.md
git commit -m "feat(script): register generation job handler"
```

### Task 5: HTTP routes, SSE regeneration, and app mounting

**Files:**
- Create/modify: `src/server/modules/script/routes.ts`, `src/server/modules/script/index.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/modules/script/script.test.ts`
- Modify: `src/server/modules/script/MODULE.md`, `AGENTS.md`

**Interfaces:**
- Produces the six `/api/project/:id/...` endpoints from the spec.
- Regeneration emits `event: chunk`, `event: done`, or `event: error`; `req.close` aborts the active controller.

- [ ] **Step 1: Write failing route tests**

Start an `createApp({ filesDir, clientDir: null })` server against the test Mongo and assert: generate returns `201 { jobId }`; patch returns updated chapters; history is newest-first; restore validates and applies index; finalize returns scenes/status; regeneration stream contains ordered chunk frames followed by exactly one done frame with the persisted chapter. Add missing-project, invalid body, invalid restore index, and provider-error -> error-frame assertions.

- [ ] **Step 2: Run route tests to verify failure**

Run: `npm test -- src/server/modules/script/script.test.ts`  
Expected: FAIL because the router is not mounted and endpoints do not exist.

- [ ] **Step 3: Implement thin routes and SSE framing**

Use `CreateJob`/enqueue through the job public API, not direct job repository calls. For regeneration, set `Content-Type: text/event-stream`, create an `AbortController`, attach `req.on('close')`, forward `onChunk` as JSON-encoded data, send final JSON `ChapterDoc` once, send JSON-string error messages on failures when the stream remains open, and never write after abort/close. Patch/restore/finalize re-fetch through public project service methods.

- [ ] **Step 4: Mount and export**

Mount `scriptRouter` at `/api/project` after the existing project/file-store routers in `app.ts`. Export only router/service/handler contracts needed by worker or app. Keep route ordering specific before any future catch-all route.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- src/server/modules/script/script.test.ts`, `npm run typecheck`, and `npm run lint`  
Expected: PASS.

```text
git add -- src/server/modules/script/routes.ts src/server/modules/script/index.ts src/server/app.ts src/server/modules/script/script.test.ts src/server/modules/script/MODULE.md AGENTS.md
git commit -m "feat(script): add chapter routes and regeneration SSE"
```

### Task 6: Script integration tests and history edge coverage

**Files:**
- Modify: `src/server/modules/script/script.test.ts`
- Modify: `src/server/modules/script/MODULE.md`, `AGENTS.md`

- [ ] **Step 1: Add remaining RED tests**

Pin eleven pre-mutation snapshots pruning to ten, restore index `0` as the newest, manual chapter patch snapshot behavior, finalization rounding/minimum-one-scene behavior, job enqueue response, cancellation-to-needs-fix, malformed fenced output, and exact SSE no-replay behavior across a second read/poll.

- [ ] **Step 2: Run focused tests**

Run: `npm test -- src/server/modules/script/script.test.ts`  
Expected: any missing edge behavior is exposed before final verification.

- [ ] **Step 3: Implement only the minimal fixes**

Keep fixes within the script/project public surfaces. Do not add a project-module test file and do not weaken Zod validation or SSE abort semantics to make a test pass.

- [ ] **Step 4: Run focused and full tests; commit**

Run: `npm test -- src/server/modules/script/script.test.ts` and `npm test`  
Expected: focused script suite passes and the existing suite remains green.

```text
git add -- src/server/modules/script/script.test.ts src/server/modules/script/MODULE.md AGENTS.md
git commit -m "feat(script): add Mongo-backed script tests"
```

### Task 7: Client API, streaming parser, and ReviewScriptPage

**Files:**
- Modify: `src/contracts/project.ts`
- Modify: `src/client/features/script/api.ts`, `hooks.ts`, `ScriptPage.tsx`
- Create: `src/client/features/script/ReviewScriptPage.tsx` and CSS Modules as needed
- Modify: `src/client/app/router.tsx`
- Create: `src/client/features/script/script-api.test.ts` only for pure parser logic (no DOM dependency)
- Modify: `AGENTS.md`, `src/server/modules/script/MODULE.md`

**Interfaces:**
- API functions: `getProject`, `generateScript`, `patchChapter`, `regenerateChapter`, `getChapterHistory`, `restoreChapters`, `finalizeScript`.
- `regenerateChapter` accepts `(projectId, chapterId, body, onChunk, signal)` and consumes `fetch(...).body` as SSE frames.

- [ ] **Step 1: Write failing pure parser/API tests**

Test a byte stream split across frame boundaries, ordered `chunk` callbacks, JSON `done` parsing, JSON-string `error` throwing, and abort propagation. Keep the tests in Node-compatible pure functions; do not add jsdom/testing-library for this unwired Phase 3 page.

- [ ] **Step 2: Implement typed client API**

Use `ProjectDetailSchema`, `ChapterDocSchema`, and `ChapterSnapshotSchema` for JSON responses. Implement a small exported `parseSseFrames`/`readRegenerationStream` helper that buffers `\n\n`-delimited frames and ignores heartbeat/comment lines. Pass the caller's `AbortSignal` to `fetch`.

- [ ] **Step 3: Implement page state and actions**

Replace the review route's `ComingSoonPage` with `ReviewScriptPage`. Use the existing project query/header, `useJobProgress` for initial generation job state/logs, and local state for selected chapters, expanded cards, edits, regeneration preview/controller, and history drawer. Disable actions while a chapter is `generating`; implement sequential selected regeneration and selected approve-all; confirm restore/finalize; navigate to `/production/:projectId/studio` after finalize.

- [ ] **Step 4: Match prototype behavior with scoped CSS**

Implement the stepper, badges, paragraphs/textareas, action buttons, progress/log panel, history list, sticky finalize footer, and accessible labels using CSS Modules and existing shared UI components. Do not implement asset/studio behavior.

- [ ] **Step 5: Run client checks and commit**

Run: `npm test -- src/client/features/script/script-api.test.ts`, `npm run typecheck`, and `npm run lint`  
Expected: PASS with no new dependency.

```text
git add -- src/contracts/project.ts src/client/features/script src/client/app/router.tsx AGENTS.md src/server/modules/script/MODULE.md
git commit -m "feat(client): add ReviewScriptPage and script API"
```

### Task 8: Acceptance documentation and whole-branch verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `src/server/modules/script/MODULE.md`
- Create/modify: `docs/superpowers/acceptance/2026-09-22-phase3-script-acceptance.md` if the repository keeps a phase acceptance ledger

- [ ] **Step 1: Run the complete verification set**

Run:

```text
npm run typecheck
npm run lint
npm test
npm run build
```

Expected: all pass; record exact Vitest counts and any skipped stub files. Confirm `mongodb-memory-server` ran; if it falls back, record the reason and fallback URI.

- [ ] **Step 2: Run static boundary/dependency checks**

Confirm `git diff --ignore-cr-at-eol --stat`, `git diff --name-only -- eslint.config.js` is empty, only `openai`/`@anthropic-ai/sdk` were added directly, no script import reaches a project repo/collection, and no public `POST /api/job`/`GET /api/job` route was introduced.

- [ ] **Step 3: Run worker smoke test**

Build first, then start `node --env-file=.env dist/worker.js`; confirm `worker started`, send SIGINT, and confirm the shutdown log. Stop without pushing.

- [ ] **Step 4: Update status and module acceptance**

Mark the script module `done` only after the commands above pass. Record the chapter state machine, ten-snapshot policy, provider abstraction, inline-SSE rationale, and any documented fallback/open question in `MODULE.md` and `AGENTS.md` in the same commit.

- [ ] **Step 5: Commit acceptance docs**

```text
git add -- AGENTS.md src/server/modules/script/MODULE.md docs/superpowers/acceptance/2026-09-22-phase3-script-acceptance.md
git commit -m "docs(phase3): record script module acceptance"
```

## Self-review checklist

- Spec coverage: provider contracts/env, AI adapters, chapter/history data, project ownership, generation/regen/finalize service, worker job, all routes, client page/API, tests, docs, and verification are mapped to Tasks 1–8.
- Placeholder scan: every task names files, signatures, tests, commands, and commit scope; no vague implementation step remains.
- Type consistency: `ChapterDoc`/`ChapterSnapshot` originate in `contracts/script.ts`; project service owns persistence; script service consumes project public methods; worker consumes `ScriptJobPayload`; client consumes `ProjectDetail`/chapter contracts.
- Review focus coverage: each of the five failure modes has a named test in Tasks 2, 3, 5, 6, or 7.
- Scope: no asset/video implementation, no provider UI switch, no file-store changes, no public job create/list API, and no boundary-rule edits are planned.
