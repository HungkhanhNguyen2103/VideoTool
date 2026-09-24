# Phase 3 Prompt 1 — Script Module (Design Brief)

Phase 2 is complete. Begin Phase 3: the script module.

This prompt is a **design brief only**. Do not write any code yet. Read the brief, produce a spec commit covering data contracts + module structure, then wait for review before implementation.

---

## Context

The pipeline so far: user creates a project (Phase 1) → jobs run async with SSE progress (Phase 2) → **Phase 3: AI generates the script chapter by chapter; user reviews and regenerates per chapter; user finalizes and triggers scene splitting.**

The prototype lives at `docs/prototypes/duyet-tai-tao/`. Read `app.js` in that folder carefully — the data shapes, UX states, and API calls there define the expected behaviour.

---

## 1. New npm dependencies

Install these before any code changes:

```
npm install openai @anthropic-ai/sdk
npm install -D @types/node   # already present, skip if so
```

No other new dependencies are allowed for this prompt.

---

## 2. AI client abstraction — `src/server/shared/ai/`

### 2a. Provider type

In `src/contracts/project.ts`, add:

```ts
export const AI_PROVIDERS = ['deepseek', 'claude'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
```

Also add `aiProvider: z.enum(AI_PROVIDERS).default('deepseek')` to `ProjectDocSchema` and `CreateProjectSchema`.

### 2b. Environment variables

Add to `.env.example` (values **empty** — keys present, no defaults):

```
DEEPSEEK_API_KEY=
ANTHROPIC_API_KEY=
DEFAULT_AI_PROVIDER=deepseek
```

### 2c. Common interface — `src/server/shared/ai/types.ts`

```ts
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface AiClient {
  /** Non-streaming: returns the full assistant reply. */
  chat(messages: ChatMessage[], opts?: { maxTokens?: number }): Promise<string>;

  /** Streaming: yields text chunks as they arrive. */
  stream(
    messages: ChatMessage[],
    opts?: { maxTokens?: number; signal?: AbortSignal }
  ): AsyncIterable<string>;
}
```

### 2d. DeepSeek client — `src/server/shared/ai/deepseek.ts`

Use the `openai` package with a custom `baseURL`:

```ts
import OpenAI from 'openai';

// baseURL: 'https://api.deepseek.com'
// model: 'deepseek-chat'
// If DEEPSEEK_API_KEY is absent, log a warning but do not throw at import time.
```

Implement both `chat()` and `stream()` from the `AiClient` interface. For `stream()`, iterate `openai`'s `stream.toReadableStream()` / async iterator and yield each text delta. Honour the `signal` by passing it to the OpenAI call.

### 2e. Claude client — `src/server/shared/ai/claude.ts`

Use `@anthropic-ai/sdk`:

```ts
import Anthropic from '@anthropic-ai/sdk';

// model: 'claude-opus-4-5'  (latest stable)
// If ANTHROPIC_API_KEY is absent, log a warning but do not throw at import time.
```

Implement `chat()` using `client.messages.create()` (non-streaming). Implement `stream()` using `client.messages.stream()` and yield `inputDelta.text` chunks. Honour `signal` by aborting the stream on signal abort.

### 2f. Factory — `src/server/shared/ai/index.ts`

```ts
export function getAiClient(provider: AiProvider): AiClient { ... }
// Returns the singleton for the requested provider.
// Export AiClient type, AiProvider, ChatMessage.
```

---

## 3. Script module — `src/server/modules/script/`

**Add `'script'` to the `ALLOWED` map in `eslint.config.js`** only if `script` is not already present — check first. `script` may import from `project`. Do **not** change `MODULES` itself if `script` is already listed. If `script` is missing from `MODULES`, add it. *(Confirm the current state of `eslint.config.js` before touching it.)*

### 3a. `ChapterDoc` — `src/server/modules/script/docs.ts`

```ts
import { z } from 'zod';

export const CHAPTER_STATUSES = ['pending', 'generating', 'approved', 'needs-fix'] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

export const ChapterDocSchema = z.object({
  id: z.string(),            // ULID, stable across regen
  no: z.number().int(),      // 1-based display order
  title: z.string(),
  paragraphs: z.array(z.string()),
  status: z.enum(CHAPTER_STATUSES),
  scenesCount: z.number().int().nonnegative().nullable(),  // null until finalize
  durationSec: z.number().nonnegative().nullable(),        // null until finalize
});
export type ChapterDoc = z.infer<typeof ChapterDocSchema>;
```

### 3b. Extend `ProjectDoc`

In `src/server/modules/project/docs.ts`, add to `ProjectDocSchema`:

```ts
chapters: z.array(ChapterDocSchema).default([]),
aiProvider: z.enum(AI_PROVIDERS).default('deepseek'),
```

Import `ChapterDocSchema` from `'../script/docs'` and `AI_PROVIDERS` from `'../../../contracts/project'`.

Also add `'script'` to the `PROJECT_STATUSES` tuple (after `'draft'`):

```ts
export const PROJECT_STATUSES = ['draft', 'script', 'asset', 'render', 'done'] as const;
```

### 3c. Version history snapshot

In `src/server/modules/script/docs.ts`, also define:

```ts
export const ChapterSnapshotSchema = z.object({
  takenAt: z.date(),
  chapters: z.array(ChapterDocSchema),
});
export type ChapterSnapshot = z.infer<typeof ChapterSnapshotSchema>;
```

Add to `ProjectDocSchema`:

```ts
chapterHistory: z.array(ChapterSnapshotSchema).default([]),
```

History policy: push a snapshot **before** any mutation to chapters (regen, bulk-regen, finalize). Keep the last **10** snapshots. Prune in the repo layer.

### 3d. `src/server/modules/script/repo.ts`

```ts
// All writes target the `projects` collection.

setProjectChapters(
  projectId: string,
  chapters: ChapterDoc[],
  snapshot: ChapterSnapshot | null,   // push to history if non-null; prune to last 10
  newStatus?: ProjectStatus            // optionally update project status
): Promise<void>

setChapter(
  projectId: string,
  chapterId: string,
  patch: Partial<Pick<ChapterDoc, 'paragraphs' | 'status' | 'title'>>
): Promise<void>
// Uses positional operator: { $set: { 'chapters.$[elem].field': value } }
// arrayFilters: [{ 'elem.id': chapterId }]

getProjectHistory(projectId: string): Promise<ChapterSnapshot[]>
```

### 3e. `src/server/modules/script/service.ts`

**Script generation (called by job handler):**

```ts
generateScript(projectId: string, appendLog: (msg: string) => Promise<void>): Promise<void>
```

Steps:
1. Load project (via `getProject`).
2. `appendLog('Loading project and AI client…')`.
3. Compute `systemPrompt` + `userPrompt` from project fields: `title`, `brief`, `referencesText`, `scriptPresetId`, `language`, `chapterCount`, `targetDurationSec`.
4. `appendLog('Sending request to AI…')`.
5. Call `aiClient.chat(messages)` (non-streaming, single call).
6. `appendLog('Parsing AI response…')`.
7. Parse the AI response into `ChapterDoc[]`. Expected JSON structure:

```json
[
  {
    "no": 1,
    "title": "...",
    "paragraphs": ["...", "..."],
    "scenesCount": null,
    "durationSec": null
  }
]
```

If parsing fails, throw an `AppError('SCRIPT_PARSE_ERROR', 'AI returned invalid script structure.', 422)`.

8. Assign a fresh ULID to each chapter's `id`; set `status: 'pending'`.
9. Call `repo.setProjectChapters(projectId, chapters, null, 'script')`.
10. `appendLog('Script saved — ${chapters.length} chapters.')`.

**Prompts:** Keep prompts in `src/server/modules/script/prompts.ts`. Define:

```ts
export function buildScriptPrompt(project: ProjectDoc): { system: string; user: string }
```

The system prompt instructs the AI to return only a JSON array of chapters (no markdown fences, no prose). Language of the script content must match `project.language`. The user prompt includes brief, references, target duration and chapter count.

**Per-chapter regen (called by route handler — streaming):**

```ts
regenerateChapter(
  projectId: string,
  chapterId: string,
  opts: { instruction: string; level: 'light' | 'medium' | 'rewrite' },
  onChunk: (text: string) => void,
  signal: AbortSignal
): Promise<ChapterDoc>
```

Steps:
1. Load project; find chapter by id.
2. Mark chapter `status: 'generating'` via `repo.setChapter`.
3. Take snapshot before mutation (push to history via `setProjectChapters` with the snapshot).
4. Build regen prompt from current chapter paragraphs + instruction + level.
5. Collect full streamed text, calling `onChunk` for each delta.
6. Parse result into `paragraphs: string[]`.
7. Update chapter: `status: 'pending'`, new `paragraphs`, same `id`/`no`/`title`/`scenesCount`/`durationSec`.
8. Return the updated `ChapterDoc`.

**Finalize script:**

```ts
finalizeScript(projectId: string): Promise<void>
```

1. Load project. All chapters must have `status: 'approved'` — otherwise throw `AppError('NOT_ALL_APPROVED', 'All chapters must be approved before finalizing.', 422)`.
2. Take snapshot.
3. Compute `scenesCount` and `durationSec` for each chapter: distribute `project.targetDurationSec` proportionally by paragraph count. Assign integer `scenesCount` per chapter (minimum 1).
4. Populate `project.scenes` by splitting each chapter's paragraphs into scenes:
   - Each scene gets fields from `SceneDocSchema`: `id` (ULID), `narration` (one paragraph or sentence), `visualPrompt` (`''`), `durationSec`.
5. Call `replaceProjectScenes` from the project module.
6. Update project `status: 'asset'`.

### 3f. `src/server/modules/script/index.ts`

Export: `scriptRouter`, `generateScript`, `ScriptJobPayload`.

---

## 4. Job handler — `src/server/modules/script/handler.ts`

Register a new job type `'generate-script'`. Payload:

```ts
export type ScriptJobPayload = { projectId: string };
```

The handler function signature matches `JobHandler<ScriptJobPayload>`:

```ts
async function handleGenerateScript(payload, context) {
  const { appendLog, checkCancellation } = context;
  await checkCancellation();
  await generateScript(payload.projectId, appendLog);
}
```

**Register in `src/server/worker.ts`:**

```ts
registry.register('generate-script', handleGenerateScript);
```

---

## 5. Routes — `src/server/modules/script/routes.ts`

Mount at `/api/project` (alongside project and file-store routes in `app.ts`).

### `POST /api/project/:id/generate-script`

1. Verify project exists.
2. Enqueue a `'generate-script'` job via `createJob` from the job module.
3. Return `201 { jobId }`.

### `PATCH /api/project/:id/chapters/:chapterId`

Body schema:

```ts
z.object({
  status: z.enum(['approved', 'needs-fix']).optional(),
  paragraphs: z.array(z.string()).optional(),
  title: z.string().optional(),
})
```

Call `repo.setChapter`. Return `200` with the updated project's chapters array (re-fetch via `getProject`).

### `POST /api/project/:id/chapters/:chapterId/regenerate` — **SSE streaming**

Body: `{ instruction: string; level: 'light' | 'medium' | 'rewrite' }`.

Response: `Content-Type: text/event-stream`.

Events:
- `event: chunk` / `data: "<text>"` — each AI token chunk
- `event: done` / `data: <ChapterDoc JSON>` — final chapter after parsing + DB write
- `event: error` / `data: "<message>"` — on any failure

Cancel: listen to `req.on('close')` and abort the `AbortController`. On abort, set chapter `status: 'needs-fix'` (leave paragraphs unchanged).

### `GET /api/project/:id/chapters/history`

Return `200 ChapterSnapshot[]` (latest first).

### `POST /api/project/:id/chapters/restore`

Body: `{ index: number }` (0 = most recent snapshot).

Restore `project.chapters` from `chapterHistory[index]`. Take a new snapshot of current state before overwriting. Return `200` with updated chapters.

### `POST /api/project/:id/finalize-script`

Call `service.finalizeScript`. Return `200` with updated `ProjectDetail`.

---

## 6. Client — "Duyệt & Tái Tạo" page

### 6a. Route

Add `/production/:projectId/review` in the React router.

### 6b. API layer — `src/client/modules/script/api.ts`

```ts
getProject(id: string): Promise<ProjectDetail>
patchChapter(projectId, chapterId, body): Promise<ChapterDoc[]>
regenerateChapter(projectId, chapterId, body, onChunk, signal): Promise<ChapterDoc>
// Uses EventSource or fetch + ReadableStream for streaming
getChapterHistory(projectId): Promise<ChapterSnapshot[]>
restoreChapters(projectId, index): Promise<ChapterDoc[]>
finalizeScript(projectId): Promise<ProjectDetail>
generateScript(projectId): Promise<{ jobId: string }>
```

For `regenerateChapter`: use `fetch` (not EventSource) so `AbortController.signal` works. Parse the SSE stream manually from `response.body` readable stream. On each `event: chunk` frame, call `onChunk(text)`. On `event: done`, parse the chapter. On `event: error`, throw.

### 6c. Job progress hook

Reuse the existing `useJobProgress` hook (Phase 2). When `generateScript` is called, store `jobId` in state and display job progress + log lines while `status !== 'done'`.

### 6d. Page component — `src/client/pages/ReviewScriptPage.tsx`

Implement the full prototype from `docs/prototypes/duyet-tai-tao/app.js`. Key requirements:

**Layout:**
- Stepper at top: Dàn ý → Nháp kịch bản → Duyệt & Tái Tạo → Chốt & Chia Cảnh
- If project has no chapters and `status === 'draft'`: show "Generate Script" button → calls `POST /generate-script` → show job progress bar + log stream while generating.
- Once chapters exist: show chapter list.

**Chapter card (one per chapter):**
- Header: chapter number, title, badge (`pending` / `approved` / `needs-fix` / `generating`), scene count, duration.
- Body: paragraphs as `<p>` tags. On "Edit" click: replace with `<textarea>` (one per paragraph) + Save/Cancel.
- Actions row:
  - "Approve" → PATCH `status: 'approved'`.
  - "Flag" → PATCH `status: 'needs-fix'`.
  - "Regenerate" → opens inline panel with `instruction` textarea + `level` select (light/medium/rewrite) + Regenerate button. While streaming, show token-by-token preview below; show Cancel button that aborts.
- While `status === 'generating'`: disable all actions, show spinner.

**Bulk actions bar** (visible when ≥1 chapter selected via checkbox):
- "Regenerate selected" — sequential regeneration of each selected chapter.
- "Approve all" — PATCH all selected to `approved`.

**Version history panel** (collapsible sidebar or drawer):
- List snapshots (timestamp).
- "Restore" button per snapshot → confirm → `POST /restore`.

**Finalize button** (sticky footer):
- Enabled only when all chapters have `status === 'approved'`.
- On click: confirm dialog → `POST /finalize-script` → navigate to asset page (Phase 4).

---

## 7. Tests — `src/server/modules/script/script.test.ts`

Use `mongodb-memory-server`. Mock AI client so no real API calls are made.

Cover:
- `generateScript`: inserts chapters, sets project `status: 'script'`.
- `generateScript`: on invalid AI JSON, throws `SCRIPT_PARSE_ERROR`.
- `regenerateChapter`: streams chunks to `onChunk`, returns updated `ChapterDoc`, pushes history snapshot.
- `regenerateChapter`: on `signal.abort()`, sets chapter `status: 'needs-fix'`.
- `finalizeScript`: with all chapters approved → populates `scenes`, sets `status: 'asset'`.
- `finalizeScript`: with any chapter not approved → throws `NOT_ALL_APPROVED`.
- Route: `POST /generate-script` → 201 with `jobId`.
- Route: `PATCH /chapters/:chapterId` with `status: 'approved'` → 200, chapter updated.
- Route: `GET /chapters/history` → returns snapshot array.
- Route: `POST /chapters/restore` → restores chapters.
- Route: `POST /finalize-script` → 200 with updated project, scenes populated.
- Route: `POST /chapters/:chapterId/regenerate` SSE → emits `chunk` events then `done`.

---

## 8. `src/server/modules/script/MODULE.md`

Cover: module purpose, chapter status machine diagram (pending → generating → approved/needs-fix), regen flow, version history policy (last 10 snapshots), finalize → scene split logic, why regen uses inline SSE (not job queue), AI client abstraction location.

---

## 9. AGENTS.md + commit discipline

Same rules as previous phases:
- Update `## Status` and `MODULE.md` in the same commit as each meaningful code change.
- No `git add -A`/`git add .`. Stage only real content changes.
- Verify with `git diff --ignore-cr-at-eol --stat` before staging.
- Do not push.

Suggested commit order:
1. `feat(contracts): add AiProvider, AI_PROVIDERS, ChapterDoc, extend ProjectDoc`
2. `feat(ai): add DeepSeek and Claude client implementations`
3. `feat(script): docs, repo, service (generate + regen + finalize)`
4. `feat(script): job handler + worker registration`
5. `feat(script): routes (generate, patch, regen SSE, history, restore, finalize)`
6. `feat(script): tests`
7. `feat(client): ReviewScriptPage + script API layer`
8. `docs(phase3): record phase 3 prompt 1 acceptance`

---

## 10. Out of scope for this prompt

- Asset generation (Phase 4).
- Video rendering (Phase 5).
- Voice-over assignment.
- AI provider switching at runtime from UI (the `aiProvider` is set on project create and read by the script service; no UI toggle needed yet).
- Do not push.

---

## 11. Report format

When done:
1. Checklist of each section above (done / skipped + reason).
2. Commits with hashes and one-line descriptions.
3. `npm run typecheck`, `npm run lint`, `npm test` (counts), `npm run build` — results.
4. Decisions made outside this spec (note any AI prompt content you wrote for `prompts.ts`).
5. Blockers or open questions.
6. Confirm ready for Phase 4 (asset module).
