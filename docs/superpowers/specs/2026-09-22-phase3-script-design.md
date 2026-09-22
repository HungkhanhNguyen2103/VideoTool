# Phase 3 Prompt 1 — Script Module Design Specification

**Date:** 2026-09-22  
**Status:** Design only; implementation is intentionally blocked until review.  
**Source brief:** Phase 3 Prompt 1 — Script Module (Design Brief)

## Goal

Add the script workflow after project creation and job infrastructure: generate a chapter-based script with a selectable AI provider, review and edit chapters, regenerate one chapter over inline SSE, keep the last ten chapter snapshots, and finalize approved chapters into project scenes for Phase 4.

The implementation must preserve the existing modular-monolith boundaries, the Phase 1–2 project API, the Phase 2 job context, and the repository's per-meaningful-change documentation/commit rule.

## Non-goals

- Asset generation, voice assignment, video rendering, upload, ZIP import, and file-store changes.
- Runtime AI-provider switching in the UI.
- Public job create/list endpoints.
- A database migration or a compatibility rewrite of existing project documents unless implementation discovers that one is required by the reviewed design.
- Real AI calls in tests.

## Existing-repo baseline

- `src/contracts/project.ts` already defines `PROJECT_STATUSES` as `draft | script | assets | rendered`; `script` is already present.
- `src/server/modules/project` is the owner of the `projects` collection, and `replaceProjectScenes` already performs the direct versioned update in `project/service.ts`.
- `src/server/modules/script` is currently a stub (`MODULE.md` plus a todo test).
- `src/worker/registry.ts` is the explicit `Record<string, JobHandler>` registry; there is no `src/server/worker.ts`.
- `JobContext` currently exposes `reportProgress`, `isCancelled`, and `appendLog`; it does not expose `checkCancellation`.
- `ProjectDetail` currently exposes scenes but not chapters or AI-provider metadata.
- `eslint.config.js` already lists `script` in `MODULES` and allows `script -> project`; do not change the boundary map unless the reviewed design explicitly requires it.

## Boundary resolutions required by this design

The source brief contains three instructions that conflict with established ownership. The implementation plan must use these resolutions unless review changes them:

1. **Shared chapter schema without a module cycle.** `project` cannot import `script/docs.ts` because the dependency table is one-way (`script -> project`). Canonical `ChapterDocSchema`, `ChapterSnapshotSchema`, their status tuples, and shared inferred types will therefore live in `src/contracts/script.ts`. `src/server/modules/script/docs.ts` will re-export those shared schemas/types and add script-module-only parsing types if needed. `project/docs.ts` imports only from `contracts/script.ts`.
2. **Projects collection ownership.** `project` remains the only module allowed to write `projects`. Script service calls new public project-service methods for chapter/history mutations; script code must not call `getCollection('projects')` or a project repository write directly. The exact public methods will be named in the implementation plan (`replaceProjectChapters`, `patchProjectChapter`, `restoreProjectChapters`, and `getProjectHistory` or equivalent) and exported only through `src/server/modules/project/index.ts`.
3. **Existing status vocabulary.** Preserve `assets` and `rendered` because Phase 1 client filters, duplicate behavior, and downstream contracts already use them. Script generation sets `script`; finalization sets `assets`. No silent rename to `asset | render | done` is allowed without an explicit reviewed migration decision.
4. **Existing worker/job contract.** The handler will use the current `(job, context)` signature, parse `job.payload` as `ScriptJobPayload`, and call `context.isCancelled()` before starting work. It will register in `src/worker/registry.ts`. If a stronger cancellation helper is needed, it must be added to the public job API rather than assumed to exist.

## Data contracts

### AI providers

Add to `src/contracts/project.ts`:

```ts
export const AI_PROVIDERS = ['deepseek', 'claude'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
```

Add `aiProvider: z.enum(AI_PROVIDERS).default('deepseek')` to the project-create request schema and the persisted project document. The public `ProjectDetail` contract also includes `aiProvider` so the client can display or preserve it, but the Phase 3 UI does not expose a provider toggle.

### Chapters and snapshots

Canonical shared shapes in `src/contracts/script.ts`:

```ts
export const CHAPTER_STATUSES = ['pending', 'generating', 'approved', 'needs-fix'] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

export const ChapterDocSchema = z.object({
  id: z.string(),
  no: z.number().int(),
  title: z.string(),
  paragraphs: z.array(z.string()),
  status: z.enum(CHAPTER_STATUSES),
  scenesCount: z.number().int().nonnegative().nullable(),
  durationSec: z.number().nonnegative().nullable(),
});
export type ChapterDoc = z.infer<typeof ChapterDocSchema>;

export const ChapterSnapshotSchema = z.object({
  takenAt: z.date(),
  chapters: z.array(ChapterDocSchema),
});
export type ChapterSnapshot = z.infer<typeof ChapterSnapshotSchema>;
```

`ProjectDocSchema` gains `chapters: z.array(ChapterDocSchema).default([])`, `chapterHistory: z.array(ChapterSnapshotSchema).default([])`, and `aiProvider`. `ProjectDetailSchema` gains `chapters` and `aiProvider`; history remains behind its dedicated route.

Every newly created project persists `chapters: []` and `chapterHistory: []`. Existing documents are read with the same defaults and are not rewritten by this prompt.

## AI client abstraction

Create `src/server/shared/ai/types.ts`:

```ts
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface AiClient {
  chat(messages: ChatMessage[], opts?: { maxTokens?: number }): Promise<string>;
  stream(
    messages: ChatMessage[],
    opts?: { maxTokens?: number; signal?: AbortSignal },
  ): AsyncIterable<string>;
}
```

Create DeepSeek and Claude adapters under `src/server/shared/ai/`. They are lazy/singleton clients selected by `getAiClient(provider)`, use the specified model/base URL, pass abort signals to provider calls, and warn rather than throw when a key is absent at module import time. The actual call will still fail with a readable application error if a handler attempts to use an unconfigured provider.

Environment additions in `.env.example` have empty key values:

```dotenv
DEEPSEEK_API_KEY=
ANTHROPIC_API_KEY=
DEFAULT_AI_PROVIDER=deepseek
```

`loadConfig` will validate `DEFAULT_AI_PROVIDER` and expose the provider keys/default to server code. No AI key is imported by client code.

Only `openai` and `@anthropic-ai/sdk` are new runtime dependencies; `@types/node` remains unchanged because it is already present.

## Script module architecture

### Files and ownership

- `src/server/modules/script/docs.ts`: re-exports chapter/snapshot contracts and owns script-specific persisted/parse types.
- `src/server/modules/script/prompts.ts`: pure prompt builders for initial generation and chapter regeneration.
- `src/server/modules/script/repo.ts`: script-facing read/query helpers only; project-owned writes are delegated to the public project service as described above.
- `src/server/modules/script/service.ts`: generation, chapter regeneration, snapshot orchestration, finalization math, and scene construction.
- `src/server/modules/script/routes.ts`: thin validation, enqueueing, SSE framing, and response mapping.
- `src/server/modules/script/handler.ts`: adapts the job document/context to `generateScript`.
- `src/server/modules/script/index.ts`: the only public script-module surface.
- `src/server/modules/script/script.test.ts`: Mongo-backed service and route tests with mocked AI clients.
- `src/server/modules/script/MODULE.md`: invariants, state machine, flow, and acceptance evidence.

### Generation flow

`generateScript(projectId, appendLog)`:

1. Load the project through the public project module.
2. Log loading, AI request, and parsing milestones.
3. Build a system/user prompt from title, brief, references, preset, language, chapter count, and target duration. The system prompt requires one JSON array only, no markdown fences/prose, and content in the project's language.
4. Call the selected client's non-streaming `chat` once.
5. Parse and validate the JSON array. Invalid shape throws `AppError('SCRIPT_PARSE_ERROR', 'AI returned invalid script structure.', 422)`.
6. Assign fresh ULIDs, preserve one-based `no`, set status `pending`, and set `scenesCount`/`durationSec` to `null`.
7. Save chapters and status `script`; this initial generation does not push a history snapshot because there is no prior chapter state.
8. Log the number of saved chapters.

### Chapter regeneration flow

`regenerateChapter(projectId, chapterId, opts, onChunk, signal)`:

1. Load the project and locate the chapter; missing project/chapter is a normal 404 error.
2. Push a snapshot of the pre-regeneration chapter array before changing persisted content.
3. Mark the target chapter `generating` while leaving its current paragraphs available for recovery.
4. Build a prompt from the current chapter, instruction, and level (`light`, `medium`, `rewrite`).
5. Consume the provider's async stream, forwarding each text delta to `onChunk` and honoring `AbortSignal`.
6. On abort, set the chapter to `needs-fix` and leave paragraphs unchanged; do not emit a successful `done` event.
7. Parse the completed response as a paragraph array, then save the same `id`, `no`, `title`, `scenesCount`, and `durationSec` with new paragraphs and status `pending`.
8. The route sends `chunk`, then exactly one `done` or `error` event.

### Finalization flow

`finalizeScript(projectId)` requires every chapter to be `approved`, otherwise it throws `NOT_ALL_APPROVED` with HTTP 422. It snapshots the current chapters, distributes the target duration proportionally by paragraph count, assigns each chapter at least one scene, splits paragraphs into `SceneDoc` records with fresh ULIDs and empty `visualPrompt`, replaces project scenes through the project service (which increments version), then updates project status to `assets` through the project service. Scene duration values are non-negative integer seconds and the total follows the target duration subject to integer rounding.

### History policy

Every mutation that changes chapters (regeneration, bulk/restore operations, and finalization) snapshots the pre-mutation array. The write layer keeps the newest ten snapshots only. `GET /chapters/history` returns newest first. Restore index `0` means newest; restore itself first snapshots the current chapters, then replaces them with the selected snapshot.

## HTTP API

Routes mount at `/api/project` alongside project and file-store routes:

- `POST /:id/generate-script` verifies the project, enqueues `generate-script` with `{ projectId }`, and returns `201 { jobId }`.
- `PATCH /:id/chapters/:chapterId` accepts optional `status` (`approved` or `needs-fix`), `paragraphs`, and `title`; it returns the refreshed chapters array.
- `POST /:id/chapters/:chapterId/regenerate` accepts `{ instruction, level }` and streams `text/event-stream` frames: `chunk`, `done`, or `error`. `req.close` aborts the provider stream.
- `GET /:id/chapters/history` returns newest-first snapshots.
- `POST /:id/chapters/restore` accepts `{ index }`, validates bounds, and returns restored chapters.
- `POST /:id/finalize-script` finalizes and returns the refreshed `ProjectDetail`.

Routes remain thin: zod validation, service/module calls, SSE framing, and response serialization only. No route writes Mongo directly.

## Worker integration

`ScriptJobPayload` is `{ projectId: string }`. The handler reads the payload from the existing `JobDoc`, checks cancellation before starting, and calls `generateScript(payload.projectId, context.appendLog)`. It is registered explicitly as `jobHandlers['generate-script'] = handleGenerateScript` in `src/worker/registry.ts`; no magic registration is introduced.

## Client design

Add `src/client/modules/script/api.ts` (or the repository's established client feature path if the current router conventions require it) with typed functions for project load, chapter patch, generation enqueue, regeneration fetch/SSE parsing, history, restore, and finalization. Regeneration uses `fetch` plus `ReadableStream`, not `EventSource`, so an `AbortController` can cancel it.

Add `/production/:projectId/review` and `ReviewScriptPage.tsx`. The page mirrors `docs/prototypes/duyet-tai-tao/app.js`: stepper, initial generate state, chapter cards, paragraph edit/save/cancel, approve/flag/regenerate actions, streaming preview and cancel, selected-chapter bulk actions, history drawer/restore confirmation, and a sticky finalize action enabled only when all chapters are approved. Generation progress reuses `useJobProgress`, including accumulated log lines. Finalization navigates to the Phase 4 asset route without implementing that route.

## Verification strategy

Use `mongodb-memory-server` and mocked AI clients; no provider network calls. Tests must cover:

- Project defaults and chapter schema parsing.
- Initial generation success, status transition, prompt language/input inclusion, and invalid JSON -> `SCRIPT_PARSE_ERROR`.
- Regeneration chunk forwarding, pre-mutation history, abort -> `needs-fix` with unchanged paragraphs, and no successful done event after abort.
- Finalization duration/scene splitting, minimum one scene, `assets` status, and `NOT_ALL_APPROVED`.
- History newest-first, ten-snapshot pruning, restore, and invalid index.
- Generate route enqueue response, chapter patch, history, restore, finalize, and regeneration SSE chunk/done/error frames.
- Worker registry registration and payload/context adaptation.
- Client pure SSE frame parsing and abort behavior where testable without adding a DOM dependency; full page rendering is not required unless existing client test infrastructure supports it.

Run after each implementation task and before claiming completion:

```text
npm run typecheck
npm run lint
npm test
npm run build
```

The implementation must document a fallback if `mongodb-memory-server` cannot download its binary, as in Phase 2.

## Commit and documentation discipline

Suggested implementation commits, each with `AGENTS.md` Status and `src/server/modules/script/MODULE.md` updated when the change is script-owned:

1. `feat(contracts): add AI provider and chapter contracts`
2. `feat(ai): add DeepSeek and Claude clients`
3. `feat(script): add docs, project-facing persistence, prompts and service`
4. `feat(script): register generation job handler`
5. `feat(script): add chapter routes and regeneration SSE`
6. `feat(script): add Mongo-backed script tests`
7. `feat(client): add ReviewScriptPage and script API`
8. `docs(phase3): record script module acceptance`

Stage only files with real content changes. Never use `git add -A` or `git add .`; never push. Do not change `eslint.config.js` boundary rules unless the reviewed ownership resolution explicitly requires a minimal, documented adjustment.

## Review questions before planning

1. Is the shared-schema resolution (`src/contracts/script.ts` with re-exports from `modules/script/docs.ts`) accepted, given the existing one-way module boundary?
2. Is preserving the existing `assets`/`rendered` status vocabulary correct, or should a separate migration/spec change rename it to `asset`/`render`/`done`?
3. Is it acceptable for project service to own chapter/history writes, as it already owns `replaceProjectScenes`, rather than allowing a script repository to write `projects` directly?
4. Is the current `JobContext.isCancelled()` contract sufficient for the initial worker check, or should a separate cancellation helper be added before implementation?

