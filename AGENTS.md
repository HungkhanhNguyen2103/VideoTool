# AGENTS.md — video-tool

Read this first. It is the map of the project. Per-module details live in `src/server/modules/<name>/MODULE.md`.

## 1. What this is

A personal tool that produces videos in three stages: **write script → generate assets (images, voice) → render video**.
One Node.js/TypeScript **modular monolith** (single codebase, single package) run as two processes: a web server and a worker.
Data lives in **MongoDB**. Binary files (images, audio, video) live on disk; the DB stores relative paths only.

## Status

_Last updated: 2026-09-21 · Phase 1, step 1 of 7 done (dependencies) · base commit: `dba7d9e first commit`_

### Works today (verified)
- Scaffold only: `npm run typecheck` and `npm run lint` pass; `npm test` runs 5 skipped stub test files (0 tests). Verified on Linux in a scratch copy with `npm ci`.

### Modules
| Module | State | Notes |
|---|---|---|
| project | stub | files exist but empty (Phase 1 builds it) |
| script | stub | Phase 3 |
| asset | stub | Phase 4 |
| video | stub | Phase 5 |
| job | stub | Phase 2 |

State values: `stub` (files exist, empty), `partial` (some behaviour), `done` (implemented and tested).

### Endpoints implemented
None yet.

### Client screens
| Route | State |
|---|---|
| `/production/init` | stub (Phase 1) |
| `/production/:projectId/review` | stub (Phase 3) |

### Run and verify
`npm run typecheck`, `npm run lint`, `npm test` (no tests yet). `npm run dev` / `build` unverified: server and client entry files are still `export {}`.

### Known gaps / TODO
- Everything except the scaffold. `docs/prototypes/` (source of truth for UI copy and tokens) is not in the repo yet.

### Decisions log (newest first, keep the last 15)
- 2026-09-22: `react-hook-form` + `@hookform/resolvers@5` added (resolver supports zod 4; not yet exercised in code).
- 2026-09-21: `video-tool` is its own git repo (`.git` at its root, intentional). Commit only here, never push.
- 2026-09-21: verification runs in a Linux scratch copy because the committed `node_modules` is Windows-built.

### Next step
Phase 1 step 2: server foundation (config, errors, ids, logger, db, app, main, worker).

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
├── .env.example                   PORT, MONGODB_URI, MONGODB_DB, FILES_DIR, WORKER_POLL_MS, AI_*_API_KEY
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
    │   ├── app/                   App.tsx router.tsx Layout.tsx
    │   ├── features/              project/ script/ asset/ video/   (same names as server modules)
    │   │   └── <feature>/         api.ts hooks.ts <Feature>Page.tsx components/
    │   └── shared/                api-client.ts, hooks/use-job-progress.ts (SSE), ui/
    └── test-utils/                mongo.ts (in-memory DB), factories.ts, fake-ai.ts
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
| `projects` | `_id`, `schemaVersion`, `title`, `brief`, `status` (draft, script_ready, assets_ready, rendered), `scriptPresetId`, `renderSettings {fps,width,height}`, `scenes[]`, `version`, `createdAt`, `updatedAt` |
| `assets` | `_id`, `projectId`, `sceneId`, `kind` (image, voice, music, subtitle), `status` (pending, running, done, failed), `path`, `inputHash`, `error`, `meta`, `updatedAt`. Unique `{sceneId, kind}` |
| `script_runs` | `_id`, `projectId`, `presetId`, `promptVersion`, `model`, `rawOutput`, `scenesBefore`, `createdAt` |
| `renders` | `_id`, `projectId`, `status`, `settings`, `timelineHash`, `outputPath`, `progress`, `error`, `createdAt` |
| `jobs` | `_id`, `type`, `projectId`, `payload`, `status` (queued, running, done, failed, cancelled), `attempts`, `maxAttempts`, `runAt`, `lockedBy`, `lockedAt`, `progress`, `result`, `error`. Index `{status, runAt}` |

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
