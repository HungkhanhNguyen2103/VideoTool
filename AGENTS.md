# AGENTS.md — video-tool

Read this first. It is the map of the project. Per-module details live in `src/server/modules/<name>/MODULE.md`.

## 1. What this is

A personal tool that produces videos in three stages: **write script → generate assets (images, voice) → render video**.
One Node.js/TypeScript **modular monolith** (single codebase, single package) run as two processes: a web server and a worker.
Data lives in **MongoDB**. Binary files (images, audio, video) live on disk; the DB stores relative paths only.

## Status

_Last updated: 2026-09-22 · Phase 2, Prompt 2 of 2 done (file store + reference upload + ZIP import) · latest implementation commit: `b0a3b5c test(file-store): clean temporary directories after suite`_

### Works today (verified)
- Config validation, JSON error shape, `/api` 404, malformed-JSON 400, `/files` 404 and SPA fallback (`npm test`: 7 tests pass, 5 stub test files skipped). Typecheck and lint (incl. module boundary rules) pass.
- `CreateProjectRequestSchema` (contracts/project.ts) validates title/brief/duration/chapterCount/renderSettings and produces the exact Vietnamese messages from `docs/prototypes/khoi-tao-du-an/app.js`; checked with a throwaway (uncommitted) script, not a committed test.
- `titleSearch` normalization (`modules/project/title-search.ts`) matches the prototype's `norm()` (accent-insensitive), same throwaway script.
- `npm run build` succeeds end to end: `vite build` (client bundle) and `tsup` (server.js, worker.js) both complete with no errors. This is the first time the full build has been exercised.
- Windows acceptance verified against the installed MongoDB 8.0 service at `127.0.0.1:27017`: `GET /api/health` returned `{ ok: true, db: true }`, project CRUD persisted in MongoDB, and the current-project fallback survived a reload.
- Browser acceptance verified at `http://localhost:5173/production/init` with a 1440px viewport: invalid submit focused the first field and made no DB write; draft/outline creation, reload persistence, accent-insensitive search, status filtering, duplicate, confirmed delete, and delete fallback all worked.
- `npm run typecheck`, `npm run lint`, `npm test` (7 passed, 5 skipped), and `npm run build` all pass on Windows. The client bundle contains no server environment/API-key identifiers.

### Modules
| Module | State | Notes |
|---|---|---|
| project | done | server: contracts + service/repo/routes; client: ProjectInitPage + form/list/dialog. Live MongoDB and browser acceptance verified on Windows; automated project-module tests remain intentionally omitted by request |
| script | stub | Phase 3 |
| asset | stub | Phase 4 |
| video | stub | Phase 5 |
| job | done | Prompt 1 complete plus append-only logs/SSE extension |

State values: `stub` (files exist, empty), `partial` (some behaviour), `done` (implemented and tested).

### Endpoints implemented
All implemented and exercised against the live MongoDB service on Windows:
- `GET /api/health` -> `{ ok: true, db: true }`
- `GET /api/project` (query: `q`, `status`) -> `ProjectSummary[]`
- `POST /api/project` -> 201 `ProjectDetail`
- `GET /api/project/:id` -> `ProjectDetail` or 404
- `POST /api/project/:id/duplicate` -> 201 `ProjectDetail`
- `DELETE /api/project/:id` -> 204 or 404
- `POST /api/project/:id/files` -> 201 `FileSummary` or 400/404
- `GET /api/project/:id/files` -> `FileSummary[]` or 404
- `DELETE /api/project/:id/files/:fileId` -> 204 or 404
- `POST /api/project/:id/import-zip` -> updated `ProjectDetail` or 400/404/422
- `POST /api/job/:id/cancel` -> current `JobSummary` or 404/409
- `GET /api/job/:id/events` -> SSE current state/deltas/heartbeats until terminal

Unknown `/api/*` returns JSON 404.

### Client screens
| Route | State |
|---|---|
| `/production/init` | implemented and browser-verified: NewProjectForm (react-hook-form + zodResolver, error summary, focus-first-invalid, duration chips, aspect->resolution) + RecentProjects (server-side search/status filter, debounced 300ms, open/duplicate/delete) + ConfirmDeleteDialog (native `<dialog>`) |
| `/production/:projectId/review` \| `/studio` \| `/seo` | ComingSoonPage placeholder, names the delivering phase |

### Run and verify
`npm run typecheck`, `npm run lint`, `npm test` (52 passed, 4 skipped), and `npm run build` all pass on Windows. The built worker was started with `node --env-file=.env dist/worker.js`, logged `worker started`, and logged clean SIGINT shutdown against the local MongoDB service. Multipart upload/delete/list and ZIP success/422 cases are covered by the file-store route suite.

### Known gaps / TODO
- Directly opening the prototype `file:///.../docs/prototypes/khoi-tao-du-an/index.html` was blocked by the browser automation URL policy, so the comparison used the fully read prototype source and matched the shared 1440px layout measurements (232px sidebar, 430px recent-project panel, no horizontal overflow). A direct visual side-by-side comparison remains unverified.
- No automated tests were added for the `project` module by explicit request; acceptance coverage is manual on Windows plus the existing suite.
- File upload for reference files and "Nhập từ ZIP" are intentionally disabled UI (Phase 2+), matching the prompt.
- Tabs 2/3/4 are all gated on "there is a current project" (disabled otherwise) — the prompt only specified this rule for tab 2; extended it to 3/4 too since their routes require a `:projectId`. Flag if you want tab 1's gate rule only.
- No endpoint updates a project in place yet, so the `version` optimistic-lock compare-and-swap is written into `ProjectDoc`/`AGENTS.md` but not exercised by any code path (arrives with scene edits in Phase 3).
- A brief empty-list state can appear while TanStack Query fetches a newly selected status filter; the settled result is correct (`3/3` in the acceptance run). This is a loading-state polish item, not a data or API failure.
- The client hook's EventSource open/change/unmount lifecycle is not DOM-automated by design; its pure state transition is covered by Node tests and the hook is not consumed until Phase 4/5.
- Orphaned files after partial failures or project deletion are not garbage-collected; deferred to Phase 6+ by design.

### Decisions log (newest first, keep the last 15)
- 2026-09-22: Phase 2 Task 6 will test a dependency-free job-event state transition helper in the existing Node Vitest environment; EventSource lifecycle wiring is manually verified because the hook has no Phase 2 consumer and adding jsdom/testing-library would expand dependencies.
- 2026-09-22: `jobs.cancelRequested` is persisted so a running handler can observe cooperative cancellation without another process releasing its worker lock.
- 2026-09-22: repository tests use `mongodb-memory-server` successfully on this Windows environment; no local MongoDB fallback was needed for Task 2.
- 2026-09-22: service-owned handler errors retry with `min(2 ** attempts * 1000, 30000)` until `maxAttempts`; unknown handler types fail terminally because the registry is explicit.
- 2026-09-22: SSE sends the current job state on the first poll (`lastState` starts undefined), then only changed state and heartbeat comments; terminal state closes the stream.
- 2026-09-22: worker loop drains claims in one tick but checks `closing` before every claim, uses a single in-flight tick guard, and recovers stale jobs every tick.
- 2026-09-22: client hook lifecycle wiring is manually verified in this phase; state transitions use a dependency-free helper test instead of adding jsdom/testing-library dependencies before the hook has a consumer.
- 2026-09-22: Phase 2 Prompt 1 acceptance uses `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, a forbidden-route/boundary scan, and a built-worker idle/startup/shutdown smoke run; no push was performed.
- 2026-09-22: job logs are append-only persisted strings and handlers write them through `JobContext.appendLog`; log SSE events will reuse the existing one-second progress poll.
- 2026-09-22: SSE log events use `lastLogIndex` on the existing poll, flush existing logs on connect, and the client accumulates them separately from main state events.
- 2026-09-22: file-store routes delegate scene replacement to `project.replaceProjectScenes`; only the project module updates `projects` with `$inc: { version: 1 }`.
- 2026-09-22: Multer `LIMIT_FILE_SIZE` maps to HTTP 400 `FILE_TOO_LARGE` in the shared error handler and is covered by a multipart route test.
- 2026-09-22: ZIP import requires root-level `scenes.json`, validates `SceneDoc[]`, and replaces scenes through `project.replaceProjectScenes` with a version increment.
- 2026-09-22: file-store remains shared infrastructure outside `eslint.config.js` module boundaries; only its own `files` collection is owned here, while project scene writes remain in the project module.
- 2026-09-22: `project.replaceProjectScenes` performs its own direct `projects.updateOne` and version increment; file-store routes call only that public project service API.
- 2026-09-22: Phase 2 Prompt 2 acceptance uses exactly four new packages (`multer`, `adm-zip`, `@types/multer`, `@types/adm-zip`); no UI wiring or static `/files` changes were added.
- 2026-09-22: search input in RecentProjects is debounced 300ms client-side before hitting the server (the prototype searches an in-memory array on every keystroke; a real HTTP call per keystroke would be wasteful).
- 2026-09-22: tabs 2/3/4 (Duyệt & Tái Tạo / Studio / SEO) are all disabled without a current project, not just tab 2 as literally specified, because their routes need `:projectId`.
- 2026-09-22: CSS Modules per component, global tokens+resets+small utility classes (`.label`, `.ic`, `.mono`, `.muted`, `.spacer`, `.sr-only`) in `styles/tokens.css` (loaded once); `.btn`/`.badge` variants live in the shared `ui/Button`, `ui/Badge` components instead of global classes.
- 2026-09-22: No automated tests for the `project` module in Phase 1 (user decision): skipped `test-utils/mongo.ts`, `factories.ts` and `project.test.ts`; user verifies manually on Windows and reports bugs.
- 2026-09-22: `docs/prototypes/khoi-tao-du-an/` and `duyet-tai-tao/` added to the repo under `docs/prototypes/` (were missing at repo creation).
- 2026-09-22: Search/list validation lives in one `superRefine` per contract schema (`contracts/project.ts`) instead of per-field zod checks, so each field surfaces exactly one Vietnamese message, matching the prototype's `validate()` behaviour.
- 2026-09-22: Chapters remain an embedded scene/chapter concern for Phase 1; a dedicated chapters model is deferred to Phase 3 (`chapters model (Phase 3)`).
- 2026-09-22: `NODE_ENV=production` (in `.env`) makes web serve `dist/client`; default is development (no cross-platform way to set it in `npm start`).
- 2026-09-22: API error body is `{ error: { code, message, fields? } }` (`contracts/common.ts`); server messages are Vietnamese because they surface in the UI.
- 2026-09-22: `react-hook-form` + `@hookform/resolvers@5` added (resolver supports zod 4; not yet exercised in code).
- 2026-09-21: `video-tool` is its own git repo (`.git` at its root, intentional). Commit only here, never push.
- 2026-09-21: verification runs in a Linux scratch copy because the committed `node_modules` is Windows-built.

### Next step
Phase 3: implement script generation and scene editing; file references and imported scenes are now available as backend foundations.

## 2. Stack

- Runtime: Node.js >= 22, ESM, TypeScript strict
- Backend: Express 5, zod, official `mongodb` driver (no Mongoose), ULID string ids (`_id` is a string, never ObjectId)
- Frontend: React + Vite SPA, React Router, TanStack Query (server state), Zustand (UI-only state), react-hook-form
- Tests: Vitest + mongodb-memory-server
- Dev: `tsx watch`. Build: `vite build` (client) + `tsup` (server, worker)
- Renderer: **undecided** (Remotion or FFmpeg). Isolated in `modules/video/handlers/render-video.ts`
- Imports are relative. No path aliases.

## 3. Runtime layout

Two Node processes from the same code:

- **web** `src/server/main.ts`: HTTP API under `/api/*`, static `/files/*`, serves `dist/client` (SPA fallback last)
- **worker** `src/worker/main.ts`: polls the `jobs` collection, runs handlers. Opens no HTTP port

The web process never does heavy work; it enqueues jobs. Long/failing work (asset generation, rendering) is always a job.
Dev: Vite (5173) proxies `/api` and `/files` to Express (3000).

## 4. Directory map

```
video-tool/
├── AGENTS.md                      this file
├── package.json, tsconfig.{base,server,client}.json
├── tsup.config.ts, vite.config.ts, vitest.config.ts, eslint.config.js
├── .env.example                   PORT, NODE_ENV, MONGODB_URI, MONGODB_DB, FILES_DIR, WORKER_POLL_MS, AI_*_API_KEY
├── docs/prototypes/                vanilla HTML/CSS/JS prototypes (khoi-tao-du-an/, duyet-tai-tao/): source of truth for layout, VN copy, tokens, behaviour
├── migrations/                    numbered scripts, only when reshaping existing documents
├── data/files/<projectId>/        assets/<sceneId>.<kind>.<ext>, output/<renderId>.mp4   (gitignored)
└── src/
    ├── contracts/                 zod schemas + types shared by server AND client (API request/response)
    │   └── common.ts project.ts script.ts asset.ts video.ts job.ts
    ├── server/
    │   ├── main.ts app.ts config.ts error-handler.ts
    │   ├── db/                    client.ts (MongoClient, getCollection<T>), ensure-indexes.ts (calls each module's indexes.ts explicitly)
    │   ├── modules/               business modules, see section 5
    │   │   ├── project/  script/  asset/  video/  job/
    │   └── shared/                no business logic, never imports modules/
    │       ├── ai-clients/        generate-json.ts generate-image.ts tts.ts providers/
    │       ├── file-store/        write/read asset files, path-traversal safe
    │       └── errors.ts logger.ts ids.ts
    ├── worker/                    main.ts (claim loop), registry.ts (job type -> handler, explicit map)
    ├── client/
    │   ├── index.html main.tsx
    │   ├── styles/tokens.css      design tokens (CSS variables), copied from the prototypes' :root block
    │   ├── app/                   App.tsx router.tsx Layout.tsx, pages/ (ComingSoonPage, etc.)
    │   ├── features/              project/ script/ asset/ video/   (same names as server modules)
    │   │   └── project/           api.ts hooks.ts store.ts ProjectInitPage.tsx components/
    │   │   └── <other feature>/   api.ts hooks.ts <Feature>Page.tsx components/
    │   └── shared/                api-client.ts, hooks/use-job-progress.ts (SSE), ui/
    └── test-utils/                mongo.ts (in-memory DB), factories.ts, fake-ai.ts  (Phase 1: not created; see Status)
```

Every module has the same base files:

```
modules/<name>/
├── MODULE.md      purpose, owned collections, allowed imports, invariants, pitfalls
├── index.ts       the ONLY public API of the module
├── docs.ts        zod schema + types of the documents this module owns
├── indexes.ts     Mongo indexes for the collections it owns
├── repo.ts        DB queries only
├── service.ts     business logic / orchestration
├── routes.ts      thin HTTP layer
└── <name>.test.ts
```

Extra files per module:

- `script/ai/`: `presets/*.md`, `build-prompt.ts`, `output-schema.ts`, `parse-output.ts`, `fixtures/`
- `asset/`: `input-hash.ts`, `handlers/{generate-image,generate-voice}.ts`, `ai/` (same shape as script/ai)
- `video/`: `build-timeline.ts` (pure), `handlers/render-video.ts`
- `job/`: `routes.ts` also exposes SSE progress; claim/recover logic lives in `service.ts`

## 5. Modules and dependencies

| Module | Responsibility | Owns collection | May import |
|---|---|---|---|
| project | project CRUD, scene model (scenes embedded in project doc), optimistic lock | `projects` | none |
| job | generic queue: enqueue, claim, progress, cancel, recover stuck jobs. No business logic | `jobs` | none |
| script | AI script generation from brief + preset, run history | `script_runs` | project |
| asset | per-scene assets via jobs, stale detection, retry | `assets` | project, job |
| video | timeline from scenes + assets, render via jobs | `renders` | project, asset, job |

```
script -> project <- asset -> job
                      ^         ^
                      +-- video-+
```

Direction is one-way, no cycles. `job` never imports asset/video; `worker/registry.ts` is the only place that knows both.

## 6. Hard rules (enforced by `eslint.config.js` where possible)

1. Import another module only via its `index.ts`. Never `../project/repo`.
2. Follow the dependency table above. Need something that violates it? Move shared logic down (e.g. into `project`) or pass data in via parameters; do not add exceptions.
3. Each collection has exactly one owning module; only it writes to it. Others call its exported functions.
4. `client/` imports only `contracts/` and itself. `contracts/` imports nothing from server/client/worker. `shared/` never imports `modules/`. `worker/` imports modules only via `index.ts`.
5. Routes are thin: `zod.parse` -> call service -> respond. No business logic in routes or repo.
6. `repo.ts` = queries. `service.ts` = orchestration. Put decision logic in small pure functions (easy to test).
7. Validate everything first; write to Mongo only at the end so a failure never leaves half-written state.
8. Secrets (AI keys) exist only in server/worker env. Never in `client/`.
9. No magic registration. Routes are mounted explicitly in `app.ts`, indexes in `db/ensure-indexes.ts`, job handlers in `worker/registry.ts`.
10. Files ~100-300 lines, one responsibility, descriptive names (no `utils.ts` / `helpers.ts`). Split only when a file has two responsibilities.
11. After every step, and in the same commit as the code change, update the "Status" section. A step is not done until Status matches the code. Never mark something as done unless you verified it by running a command.

## 7. Pipeline

**Script** (synchronous request at first)
`POST /api/script/generate` -> load project + preset -> `buildPrompt` -> `generateJson` (validate with zod, retry once with the zod error) -> `parseOutput` (AI shape -> `SceneDoc[]`) -> insert `script_runs` (with `scenesBefore`) -> update project (`scenes`, `status`, version check).
Manual edit of one scene goes through `PATCH /api/project/:projectId/scenes/:sceneId` (no AI).

**Asset** (always jobs)
`POST /api/asset/generate` -> `asset.service` enqueues `asset.generate-image` / `asset.generate-voice` per scene -> worker runs the handler -> writes file via `file-store` -> upserts `assets` doc (`status`, `path`, `inputHash`).

**Video** (always a job)
`POST /api/video/render` -> `build-timeline(scenes, assets)` (pure) -> enqueue `video.render` -> worker renders -> writes `output/<renderId>.mp4` -> updates `renders` (`progress`, `status`, `outputPath`).

**Stale assets** are computed at read time, not stored: `stale = hashInput(currentScene) !== asset.inputHash`. Regenerating the script never needs to touch `assets`.

## 8. Data model (MongoDB)

| Collection | Key fields |
|---|---|
| `projects` | `_id`, `schemaVersion`, `title`, `titleSearch` (accent-stripped, lowercased `title`), `language` (`vi`\|`en`), `brief`, `referencesText`, `scriptPresetId`, `targetDurationSec`, `chapterCount` (int 1-20 or `null`), `voiceId` (string or `null`), `status` (`draft`\|`script`\|`assets`\|`rendered`), `renderSettings {aspect,width,height,fps}`, `scenes[]`, `version`, `createdAt`, `updatedAt` |
| `assets` | `_id`, `projectId`, `sceneId`, `kind` (image, voice, music, subtitle), `status` (pending, running, done, failed), `path`, `inputHash`, `error`, `meta`, `updatedAt`. Unique `{sceneId, kind}` |
| `script_runs` | `_id`, `projectId`, `presetId`, `promptVersion`, `model`, `rawOutput`, `scenesBefore`, `createdAt` |
| `renders` | `_id`, `projectId`, `status`, `settings`, `timelineHash`, `outputPath`, `progress`, `error`, `createdAt` |
| `jobs` | `_id`, `schemaVersion:1`, `type`, `projectId`, `payload`, `status` (queued, running, done, failed, cancelled), `attempts`, `maxAttempts`, `runAt`, `lockedBy`, `lockedAt`, `progress`, `result`, `error`, `cancelRequested`, `logs[]`, `createdAt`, `updatedAt`. Index `{status, runAt}` |
| `files` | `_id`, `projectId`, `originalName`, `mimeType`, `ext`, `sizeBytes`, `purpose: reference`, `storedPath` (relative to `FILES_DIR`), `createdAt`. Indexes `{projectId, createdAt}` and `{purpose}` |

`SceneDoc` (embedded in `projects.scenes`): `{ id, narration, visualPrompt, durationSec }`. `id` is stable; assets reference it; array order = scene order.

Concurrency patterns:

- **Optimistic lock:** `updateOne({_id, version: expected}, {$set: ..., $inc: {version: 1}})`; `matchedCount === 0` -> throw `Conflict` (HTTP 409).
- **Single scene edit:** `$set: {'scenes.$[s].narration': ...}` with `arrayFilters: [{'s.id': sceneId}]`, and `$inc: {version: 1}`.
- **Job claim (atomic):** `findOneAndUpdate({status:'queued', runAt:{$lte:now}}, {$set:{status:'running', lockedBy, lockedAt:now}, $inc:{attempts:1}}, {sort:{runAt:1}, returnDocument:'after'})`. Worker polls every `WORKER_POLL_MS`.
- **Recovery:** `running` jobs with an old `lockedAt` go back to `queued`.
- Mongo runs standalone (no replica set): do not rely on multi-document transactions or change streams.
- Every doc has `schemaVersion`; zod in `docs.ts` is the single source of truth for shape.

## 9. AI content generation convention

Applies to every `modules/*/ai/` folder. Code, prompt text and JSON format are separate on purpose:

- `presets/*.md`: prompt text (data). Has `id` + `version`. Edited often, no code change needed.
- `output-schema.ts`: zod schema of the JSON the AI returns. Shape chosen for the AI (may use snake_case). One source of truth -> derive TS type, validator and JSON Schema (`z.toJSONSchema`).
- `build-prompt.ts`: typed pure function `(input) => { system, user, jsonSchema, promptVersion }`. No `{{var}}` string templates.
- `parse-output.ts`: the only place that knows both the AI shape and the system model (`AiScriptOutput` -> `SceneDoc[]`: rename fields, generate ids, estimate duration).
- `fixtures/`: real saved AI responses. Tests use them instead of calling the AI.

Rules: always validate AI output even with structured output; on failure retry once, passing the zod error back; then throw `AiOutputError` (HTTP 502) and write nothing. Store `presetId`, `promptVersion`, `model` with generated results.
Do not confuse: API schemas (client<->server) live in `contracts/`; AI output schemas live in `modules/<x>/ai/`.

## 10. Jobs

- Types: `asset.generate-image`, `asset.generate-voice`, `video.render`.
- Handler: `(job, ctx) => Promise<result>` where ctx can report progress and observe cancellation. Exported from the owning module's `index.ts`, registered in `worker/registry.ts`.
- Retries: up to `maxAttempts` with backoff. Store per-asset `failed` + `error` so only the failed part is retried.
- Client tracks progress via SSE (`use-job-progress`), fallback to polling with TanStack Query.

## 11. API conventions

- Prefix `/api/<module>`; files served from `/files/<projectId>/...`.
- Error mapping in `error-handler.ts`: `ZodError` 400, `NotFound` 404, `Conflict` 409, `AiOutputError` 502, otherwise 500. Handlers are `async`; Express 5 forwards thrown errors, no try/catch wrapper needed.
- Validate every request body/params with the zod schema from `contracts/`.

## 12. Client conventions

- Feature folders mirror server modules. One `api.ts` (typed with `contracts/`), one `hooks.ts` (TanStack Query), one `<Feature>Page.tsx`, `components/` for the rest.
- Server data goes through TanStack Query. Zustand only for UI state (selected scene, timeline UI).
- The client only uses URLs (`/api/...`, `/files/...`); it never touches disk or workers.

## 13. Commands

```
npm run dev          # vite + web (tsx watch) + worker (tsx watch)
npm run typecheck    # tsc for server and client
npm run lint         # eslint incl. module boundary rules
npm test             # vitest (in-memory Mongo, fake AI)
npm run build        # dist/client (vite) + dist/server.js + dist/worker.js (tsup)
npm start            # node dist/server.js       (second process: npm run start:worker)
```

Always run `typecheck` and `test` after changes; both are cheaper than reading more code to be sure.

## 14. Where to change what

| Task | Touch |
|---|---|
| Change a request/response shape | `contracts/<m>.ts`, then `modules/<m>/routes.ts`, `client/features/<m>/api.ts` |
| Change a stored document | `modules/<m>/docs.ts` (+ `indexes.ts`, + `migrations/` if old data exists) |
| Tweak AI output text/style | `modules/<m>/ai/presets/*.md` (bump `version`) |
| Change what the AI must return | `ai/output-schema.ts` + `ai/parse-output.ts` + `ai/fixtures/` |
| New AI provider | `shared/ai-clients/providers/` |
| New job type | handler in the module, register in `worker/registry.ts`, enqueue from that module's `service.ts` |
| New page | `client/features/<m>/`, route in `client/app/router.tsx` |
| New module | copy the base layout, add `MODULE.md`, update section 5, `eslint.config.js` (`MODULES`, `ALLOWED`), `db/ensure-indexes.ts`, `app.ts` |

## 15. Open decisions

- Renderer: Remotion vs FFmpeg
- AI providers for text, image, TTS
- Custom presets editable in UI (would become a `preset` module; today only default presets in files)
- Auth (none for now)
