# AGENTS.md — video-tool

Read this first. It is the map of the project. Per-module details live in `src/server/modules/<name>/MODULE.md`.

## 1. What this is

A personal tool that produces videos in three stages: **write script → generate assets (images, voice) → render video**.
One Node.js/TypeScript **modular monolith** (single codebase, single package) run as two processes: a web server and a worker.
Data lives in **MongoDB**. Binary files (images, audio, video) live on disk; the DB stores relative paths only.

## Status

_Last updated: 2026-09-23 · Script Task 5 route/worker wiring verified_

### Works today (verified)
- Config validation, JSON error shape, `/api` 404, malformed-JSON 400, `/files` 404 and SPA fallback remain covered by the suite (241 tests pass, 1 skipped; the pre-existing `project` todo file is skipped). Typecheck and lint (incl. module boundary rules) pass.
- `CreateProjectRequestSchema` (contracts/project.ts) validates title/brief/duration/chapterCount/renderSettings and produces the exact Vietnamese messages from `docs/prototypes/khoi-tao-du-an/app.js`; checked with a throwaway (uncommitted) script, not a committed test.
- `titleSearch` normalization (`modules/project/title-search.ts`) matches the prototype's `norm()` (accent-insensitive), same throwaway script.
- `npm run build` succeeds end to end: `vite build` (client bundle) and `tsup` (server.js, worker.js) both complete with no errors. This is the first time the full build has been exercised.
- Windows acceptance verified against the installed MongoDB 8.0 service at `127.0.0.1:27017`: `GET /api/health` returned `{ ok: true, db: true }`, project CRUD persisted in MongoDB, and the current-project fallback survived a reload.
- Browser acceptance verified at `http://localhost:5173/production/init` with a 1440px viewport: invalid submit focused the first field and made no DB write; draft/outline creation, reload persistence, accent-insensitive search, status filtering, duplicate, confirmed delete, and delete fallback all worked.
- `npm run typecheck`, `npm run lint`, `npm test` (101 passed, 2 skipped), and `npm run build` all pass on Windows. The client bundle contains no server environment/API-key identifiers.
- Phase 3 final review fixes are covered by 81 passing tests: legacy project reads apply defaults for new script fields, chapter regeneration preserves concurrent edits, paragraph edits reset approval, empty scripts cannot be saved/finalized, and the client prevents overlapping regeneration streams with lifecycle abort cleanup.
- Versioned documentary/explainer preset loading and the production Markdown copy step are implemented and verified.
- Script generation and regeneration use preset-aware, versioned prompts in the script `ai/` boundary. Generated chapters, regenerated paragraphs, and visual batches share JSON parsing with 422 `SCRIPT_PARSE_ERROR` behavior.
- Script Task 4 processes finalized scenes sequentially by chapter with stable project-global scene indexes. It validates the exact returned index set, retries one parse/schema/index failure, writes through the project-owned empty-only mutation, preserves existing prompts, seeds a bounded style note from existing project prompts, reports per-chapter progress, isolates chapter failures, and discards responses when cancellation is observed. The project-owned companion returns atomic pre-image changed IDs for exact job counts while the original wrapper still returns `ProjectDetail`.
- Script Task 5 exposes `POST /api/project/:id/scenes/generate-visual-prompts` with finalized-scene readiness validation and registers `generate-visual-prompts` explicitly in the worker; route/worker focused tests (45) plus typecheck and lint pass.

### Modules
| Module | State | Notes |
|---|---|---|
| project | done | server: contracts + service/repo/routes plus chapter/history persistence, atomic scene/status replacement, public render-engine mutation, and empty-only AI visual-prompt batch mutation; client: ProjectInitPage + form/list/dialog. Live MongoDB and browser acceptance verified on Windows; automated project-module tests remain intentionally omitted by request |
| script | done | Phase 3 Prompt 1 complete; Tasks 4–5 add sequential visual-prompt orchestration, finalized-scene enqueue route, and explicit worker registration over the typed AI boundary and project-owned empty-only mutation. Studio wiring remains in later tasks. |
| asset | done | Phase 4 complete: SceneDoc asset references, project-owned scene mutation APIs, Flow export, tolerant ZIP import, routes, integration tests, and Studio UI |
| video | done | Phase 5 Prompt 1 plus Prompt 2 complete: FFmpeg and Remotion renderers, cached bundle/public staging, atomic engine selection route, matching web/worker wiring, Studio selector, Chromium integration, and build-isolation scan |
| job | done | Prompt 1 complete plus append-only logs/SSE extension |

State values: `stub` (files exist, empty), `partial` (some behaviour), `done` (implemented and tested).

### Endpoints implemented
Existing project/file/job routes were exercised against live MongoDB on Windows; Phase 5 video routes are covered by in-memory integration/HTTP tests and await live-browser/provider acceptance:
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
- `GET /api/project/:id/scenes/export-json` -> Flow scene JSON with attachment filename
- `POST /api/project/:id/scenes/import-assets` -> `{ updated, skipped }` with 400/422 errors
- `POST /api/project/:id/scenes/generate-voiceover` -> 201 `{ jobId }`
- `POST /api/project/:id/scenes/:sceneId/regenerate-voiceover` -> updated `ProjectDetail`
- `GET /api/project/:id/scenes/:sceneId/render-preview` -> `video/mp4` buffer
- `POST /api/project/:id/scenes/:sceneId/generate-sfx` -> updated `ProjectDetail`
- `POST /api/project/:id/generate-bgm` -> updated `ProjectDetail`
- `POST /api/project/:id/render` -> 201 `{ jobId }`
- `PATCH /api/project/:id/render-engine` -> updated `ProjectDetail` (`{ engine: 'ffmpeg' | 'remotion' }`)
- `PATCH /api/project/:id/scenes/:sceneId` -> updated `ProjectDetail`
- `POST /api/project/:id/scenes/set-asset-type` -> updated `ProjectDetail`
- `POST /api/job/:id/cancel` -> current `JobSummary` or 404/409
- `GET /api/job/:id/events` -> SSE current state/deltas/heartbeats until terminal

Unknown `/api/*` returns JSON 404.

### Client screens
| Route | State |
|---|---|
| `/production/init` | implemented and browser-verified: NewProjectForm (react-hook-form + zodResolver, error summary, focus-first-invalid, duration chips, aspect->resolution) + RecentProjects (server-side search/status filter, debounced 300ms, open/duplicate/delete) + ConfirmDeleteDialog (native `<dialog>`) |
| `/production/:projectId/review` \| `/studio` \| `/seo` | ReviewScriptPage implemented for `/review`; Studio asset import/export/editor plus voiceover/SFX/BGM/preview/render controls implemented; SEO remains ComingSoonPage placeholder |

### Run and verify
`npm run typecheck`, `npm run lint`, `npm test` (184 passed; the pre-existing `project` todo file is skipped), and `npm run build` all pass. The Remotion integration rendered a non-empty one-second MP4 with `node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe`; FFmpeg/ffprobe were available as `C:\ffmpeg\bin\ffmpeg.exe` and `C:\ffmpeg\bin\ffprobe.exe`, and the real scene+BGM plus short-video duration integration ran. The artifact scan found no Remotion composition code in built server/worker/client outputs. Vite emits a non-blocking client chunk-size warning above 500 kB.
- The post-review Remotion parity fix mutes embedded audio on source video scenes, and progress log writes are serialized and surfaced as controlled render failures instead of unhandled rejections; the focused Remotion suite passes 13/13.
- Remotion cleanup failures are logged without replacing the primary staging/render error.
- ReviewScriptPage now derives its production stepper from chapter/job state and uses the shared dark-theme tokens; four focused regression tests cover the state matrix and CSS token references.
- ReviewScriptPage records chapter-history snapshots only for actual paragraph/title edits, leaves decision-only changes out of content history, stops a regeneration batch after cancellation, and preserves an explicitly collapsed list across refetches.

### Known gaps / TODO
- Directly opening the prototype `file:///.../docs/prototypes/khoi-tao-du-an/index.html` was blocked by the browser automation URL policy, so the comparison used the fully read prototype source and matched the shared 1440px layout measurements (232px sidebar, 430px recent-project panel, no horizontal overflow). A direct visual side-by-side comparison remains unverified.
- No automated tests were added for the `project` module by explicit request; acceptance coverage is manual on Windows plus the existing suite.
- Generic reference-file upload still has no dedicated client screen; Studio Flow ZIP import is implemented for Phase 4.
- Tabs 2/3/4 are all gated on "there is a current project" (disabled otherwise) — the prompt only specified this rule for tab 2; extended it to 3/4 too since their routes require a `:projectId`. Flag if you want tab 1's gate rule only.
- Project chapter/scene writes now exercise the `version` increment and history snapshot paths; compare-and-swap remains a future enhancement because the current mutation APIs use targeted atomic updates without an expected-version parameter.
- A brief empty-list state can appear while TanStack Query fetches a newly selected status filter; the settled result is correct (`3/3` in the acceptance run). This is a loading-state polish item, not a data or API failure.
- The client hook's EventSource open/change/unmount lifecycle is not DOM-automated by design; its pure state transition is covered by Node tests and the hook is not consumed until Phase 4/5.
- Browser visual acceptance of the updated Studio engine selector at 1440px remains pending in this headless environment; API, real Remotion render, and build checks are green.
- Task 6 verified a real one-second image-only Remotion MP4 with local Chrome Headless Shell and no staged render leftovers; the artifact scan found no composition imports in server/worker/client outputs. Studio exposes mutually exclusive FFmpeg/Remotion choices, disables them while busy, refreshes project state on success, and preserves the prior state on failure.
- Live VieNeu and Freesound calls are not made in automated tests; provider adapters are covered with mocks, and an empty `FREESOUND_API_KEY` intentionally disables optional audio generation.
- Orphaned files after partial failures, re-imports, or project deletion are not garbage-collected; deferred by design.

### Decisions log (newest first, keep the last 15)
- 2026-09-23: Task 4 review fixes seed visual style from all existing non-empty prompts at job start; failed and skipped chapters preserve that context. `project.applyEmptySceneVisualPromptsWithResult` uses a single `findOneAndUpdate` pre-image to report exactly which empty prompts the atomic write filled; the original `ProjectDetail` wrapper delegates to it.
- 2026-09-23: Script Task 4 maps each chapter to a stable slice of the finalized project scene array, validates complete global-index echoes before any write, and retries only parse/schema/index failures once. It carries a maximum 500-character continuity note, counts only empty scenes filled by the project mutation, and stops on cooperative cancellation without writing an in-flight response.
- 2026-09-23: Script Task 3 makes `project.applyEmptySceneVisualPrompts` the sole added writer for AI visual prompts. It validates scene IDs, deduplicates last-value-wins, and uses a top-level empty-target predicate plus per-target array filters so manual edits win; no schema migration is needed. Mongo-backed script integration tests cover the public API while `project.test.ts` remains a todo.
- 2026-09-22: Phase 5 Task 2 keeps audio, SFX, BGM, and final-render writes in `project`; BGM mood/file and render file/status each update atomically with one version increment.
- 2026-09-22: Phase 5 Prompt 2 chooses copy-based Remotion staging into the effective bundle `public/` directory because `bundle()` snapshots its source public directory; this preserves bundle-once behavior without coupling renders to Express uptime.
- 2026-09-22: Phase 5 Prompt 2 implementation is split into seven sequential TDD tasks: scaffold/build isolation, project mutation, renderer/staging, route wiring, Studio selector, conditional integration, and acceptance docs.
- 2026-09-22: Phase 5 Prompt 2 Task 1 keeps `src/remotion` outside the Vite/tsup TypeScript graphs; server/client artifacts are checked for composition imports while the Remotion bundle remains an independent entry.
- 2026-09-22: Phase 5 Prompt 2 Task 2 keeps `renderEngine` writes in `project.setProjectRenderEngine`, with one version increment and no direct project-collection access from video code.
- 2026-09-22: Phase 5 Prompt 2 Task 3 caches one Remotion bundle per renderer process, stages generated media under bundle-output `public/renders/<renderId>/`, validates purpose/MIME/extension before copy, and awaits cleanup on every render path.
- 2026-09-22: Phase 5 Prompt 2 Task 4 mounts `PATCH /api/project/:id/render-engine` in the video router and passes the same configured Remotion public root through web `createApp` and worker startup.
- 2026-09-22: Phase 5 Prompt 2 Task 5 keeps the Studio engine selector typed through `contracts/project`, uses the new PATCH API, disables choices during mutations, and refreshes the persisted project after success.
- 2026-09-22: Phase 5 Prompt 2 Task 6 runs the Chromium integration under an explicit temp-file render lock so it cannot contend with the existing FFmpeg integration; the lock is test-only and leaves no file behind.
- 2026-09-22: Phase 5 Prompt 2 caches the Remotion bundle for the worker process lifetime, uses Remotion's default host-aware concurrency, and keeps SFX/BGM numeric volumes derived from the existing FFmpeg string constants.
- 2026-09-22: Phase 5 Prompt 2 places render-engine selection in the video router while the project service owns the atomic `renderEngine` mutation.
- 2026-09-22: Phase 5 Prompt 2 review fix mutes embedded source-video audio to match FFmpeg's explicit audio mapping and serializes/awaits Remotion progress-log writes so persistence failures remain controlled render errors.
- 2026-09-22: Phase 5 Prompt 2 cleanup diagnostics log staging/output removal failures while preserving the original render error.
- 2026-09-22: ReviewScriptPage fixes derive stepper progress from chapters/job state and replace undefined light-theme CSS fallbacks with the shared dark tokens; pure client regression coverage avoids adding a DOM dependency.
- 2026-09-22: Phase 5 Task 3 adds a plain-fetch VieNeu client with one retry, timeout/error mapping, FFmpeg mastering fallback, and ffprobe duration measurement; no TTS SDK or runtime dependency was added.
- 2026-09-22: Phase 5 Task 4 adds resilient Freesound search/download adapters and ports the Vietnamese keyword dictionary/reference query extraction verbatim; missing API key, no result, malformed response, and download failure all return null without throwing.
- 2026-09-22: Phase 5 Prompt 1 follow-up corrects Freesound matching order, delimiter splitting, two-word fallback queries, and first-seen deduplication to match the reference implementation exactly.
- 2026-09-22: Phase 5 Task 5 adds pure FFmpeg scene/concat/BGM builders, temporary-file cleanup, project-owned path resolution, and a documented Remotion 501 stub; the BGM second pass intentionally re-encodes the full video.
- 2026-09-22: Phase 5 Task 6 keeps generated binaries in file-store, patches scene/project metadata through project APIs, continues batch voiceovers after per-scene failures, and rejects renders with one-based `SCENES_NOT_READY` numbers.
- 2026-09-22: Phase 5 Task 7 mounts video routes explicitly under `/api/project`; project-wide voiceover/render work is queued as `generate-voiceover` and `render-full-video`, and handlers check cooperative cancellation before work.
- 2026-09-22: Phase 5 Task 8 runs real scene+BGM and short-video duration FFmpeg integration because `C:\ffmpeg\bin\ffmpeg.exe` and `C:\ffmpeg\bin\ffprobe.exe` are installed; no binary tests were skipped. Prompt 2 raises final acceptance to 154 passing tests with the existing project todo file skipped.
- 2026-09-22: Phase 5 Task 9 keeps Studio media URLs derived from MIME-checked `FileSummary` records, revokes preview object URLs on replacement/unmount, and exposes project readiness/job logs without adding client dependencies.
- 2026-09-22: Phase 5 Task 1 adds render/audio/SFX/BGM defaults, TTS/FFmpeg/Freesound config, five file purposes, audio MIME support, and ownership-checked `resolveFilePath`; no new dependency or boundary rule was added.
- 2026-09-22: Phase 5 Prompt 1 combined design spec includes VieNeu TTS, FFmpeg rendering, Freesound SFX/BGM, atomic file/project ownership, and a Remotion stub; implementation proceeded after the approved review.
- 2026-09-22: Final Phase 4 review fixes pass 101 tests (2 stub files skipped): ZIP enumeration/extraction failures map or skip safely, Studio uses dark design tokens and MIME-based previews with mismatch notice, and duplicated projects clear file references; browser Studio comparison remains a documented headless-environment gap.
- 2026-09-22: Phase 4 acceptance before final review passed 97 tests; the follow-up regression pass added malformed ZIP, duplicate-project, and MIME preview coverage without adding dependencies.
- 2026-09-22: Phase 4 Task 5 keeps `FlowSceneExport` in `contracts/asset.ts` so client code shares the route contract without importing the server asset module; Studio ZIP upload uses dependency-free XHR progress and preview URLs use validated `storedPath`.
- 2026-09-22: Phase 4 Task 4 treats `skipped[]` as an unordered membership list because `adm-zip` may enumerate entries in archive order; tests assert exact membership/count, not incidental order.
- 2026-09-22: Phase 4 Task 3 adds configured asset orchestration over `createFileStoreService`, root-level Flow ZIP parsing, image/video MIME/type checks, 200 MB upload middleware, and explicit `/api/project` route mounting; `eslint.config.js` remains unchanged.
- 2026-09-22: Phase 4 Task 2 keeps all scene writes in `project`; `applySceneAssets` deduplicates last-value-wins and applies dynamic array-filter `$set` paths in one versioned update.
- 2026-09-22: Phase 4 Task 1 adds defaulted `SceneDoc.assetType` (`image`) and `assetFileId` (`null`) for legacy reads, plus additive `FileSummary.storedPath` for client previews; no migration or `assetUrl` field is used.
- 2026-09-22: final review fixes normalize legacy project reads through `ProjectDocSchema` defaults, target only the regenerated chapter during generating/error transitions, force paragraph edits back to `pending`, reject empty scripts/finalizations, and abort/serialize client regeneration streams across unmount/project changes.
- 2026-09-22: review regression coverage uses a controlled concurrent chapter edit during an aborted stream; the unrelated chapter must survive while the target chapter becomes `needs-fix`.
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
- 2026-09-22: shared chapter/snapshot schemas live in `contracts/script.ts` and are re-used by project/script to preserve the one-way `script -> project` boundary.
- 2026-09-22: `replaceProjectScenes(projectId, scenes, newStatus?)` applies scenes and optional project status in one atomic update; script finalization will use `newStatus: 'assets'`.
- 2026-09-22: `CreateProjectRequest` is the zod input type so the defaulted `aiProvider` stays optional for existing callers; project service persists `deepseek` when omitted.
- 2026-09-22: AI adapters warn on missing provider keys at client construction and pass abort signals through provider request options; tests mock both SDKs and make no network calls.
- 2026-09-22: script parsing tolerates one optional JSON markdown fence for provider robustness, while still rejecting non-JSON/non-schema output with `SCRIPT_PARSE_ERROR` before any chapter write.
- 2026-09-22: finalization writes chapter metadata/history separately, then updates scenes and project status `assets` in one atomic `replaceProjectScenes` update as required by the implementation review note.
- 2026-09-22: script job handler uses a local structural context type instead of importing `job`, preserving the enforced `script -> project` boundary while remaining assignable to the worker's `JobHandler`.
- 2026-09-22: script routes receive an injected `enqueueJob` callback from `app.ts`; this keeps route behavior public-API based without adding a forbidden script-to-job module import.
- 2026-09-22: regeneration listens to request close before headers and response close after headers, avoiding false aborts when a normal request body stream closes while the SSE response is still active.
- 2026-09-22: script edge tests pin ten-snapshot pruning, invalid restore index, deterministic remainder seconds, and SSE error/no-done behavior for malformed streamed output.
- 2026-09-22: ReviewScriptPage uses fetch + ReadableStream for chapter regeneration (not EventSource) so AbortController cancellation works; no DOM test dependency was added.
- 2026-09-22: Phase 3 acceptance uses `mongodb-memory-server`; 81 tests pass and 3 stub files remain skipped. Vite reports a non-blocking client chunk-size warning above 500 kB.

### Next step
Script-presets/visual-prompts Task 4 is complete. Task 5 adds the enqueue route and worker registration; later tasks add the Studio action and end-to-end coverage.

## 2. Stack

- Runtime: Node.js >= 22, ESM, TypeScript strict
- Backend: Express 5, zod, official `mongodb` driver (no Mongoose), ULID string ids (`_id` is a string, never ObjectId)
- Frontend: React + Vite SPA, React Router, TanStack Query (server state), Zustand (UI-only state), react-hook-form
- Tests: Vitest + mongodb-memory-server
- Dev: `tsx watch`. Build: `vite build` (client) + `tsup` (server, worker)
- Renderer: FFmpeg implemented; Remotion design committed and awaiting implementation-plan review. Isolated behind `modules/video` renderer interfaces.
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

- `presets/*.md`: the only preset source of truth (prompt text data), with validated `id` + `version`; the production build copies these Markdown files to `dist/presets/`.
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
