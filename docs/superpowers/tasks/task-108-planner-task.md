# Task 108 — Channel profiles and project assignment

Spec: `Claude outputs/codex-prompt-task108-111-channel-seo.md`, section "Task 108". Read the "General rules" and Task 108 parts; do NOT start 109–111. Commit: `feat(channel): channel profiles and project assignment`. Work on `main`, never push, LF endings, test-first.

## Planner decisions (spec left these open)

1. **Dependency direction.** New module `channel`, `ALLOWED.channel = ['project']`. `project` stays import-free (`ALLOWED.project = []`, unchanged). `seo` will later get `['project', 'channel']` (Task 109, not now).
   - `project` stores only `channelId: string | null` and exposes, via `index.ts`: `countProjectsByChannelId(channelId)` (used by channel delete → 409) and `setProjectChannel(projectId, channelId | null)`.
   - Existence of a channel is checked through an **injected callback**, same pattern as `enqueueJob` in script routes: `createProjectRouter({... , assertChannelExists })`, wired in `app.ts` from the channel module's public API. Used by create-project and by the assignment route. No project → channel import. No cycle.
2. **Assignment route:** project has no generic PATCH. Add `PATCH /api/project/:id/channel` body `{ channelId: string | null }` in the project router (find how other single-field setters such as AI provider / render engine are mounted and follow that). Unknown id → 404 with a Vietnamese message. Returns `ProjectDetail`. Increments `version` once like other setters.
3. **Create project** accepts optional `channelId` (default null); validated through the same callback; unknown id → 404.
4. **Duplicate** keeps `channelId`. **ZIP import:** first check what `import-zip` / `ProjectImportSeedSchema` actually write. If ZIP import only replaces scenes (it appears so), nothing to do and say so in the report. If a seed path creates projects, `channelId` is not part of the seed: imported projects get `null`. Do not add cross-module reads to satisfy the spec sentence; report the deviation.
5. Channel name uniqueness: case-insensitive. Look for an existing helper (grep `titleSearch`, `normalizeTitle`); otherwise store a `nameSearch` (accent-stripped lowercase) + unique index, plus a service-level duplicate check returning 409 `CHANNEL_NAME_TAKEN` (Vietnamese message).

## Required behaviour

Everything in spec "Task 108": `src/contracts/channel.ts` (strict schemas, limits, handle regex, http/https URLs, `defaultHashtags` normalised via `normalizeHashtags` max 5, `publishSchedule` optional/`null` default as a placeholder: define it as `z.unknown().nullable().default(null)` or a minimal object; Task 110 will tighten it, keep it legacy-safe), create/update inputs, `ChannelSummarySchema`; `channels` collection with `schemaVersion`; CRUD routes under `/api/channels`; DELETE → 409 listing the project count; mount in `app.ts`; `db/ensure-indexes.ts`; `eslint.config.js` MODULES/ALLOWED; AGENTS.md section 5 table + directory map + Status line; `modules/channel/MODULE.md`; project `MODULE.md` (new field, new setter, count).

Client: `features/channel/` (api.ts, hooks.ts, pure helpers + tests, `ChannelManagerDialog`), create-project "Kênh" select with last-used channel in `localStorage` (try/catch, falls back silently), SEO page top section "Kênh" with select + "Quản lý kênh" dialog + "Dùng mẫu Lịch Sử Không Khô" prefill button (prefill only, never auto-save). Use the native `<dialog>` pattern of `ConfirmDeleteDialog`. CSS Modules + tokens. Vietnamese copy. Query invalidation: channel list, project detail, project list.

## Hard constraints (I will reject on any of these)

- Legacy project documents with no `channelId` must parse and map to `null`. Add a mapper test for that (doc → detail/summary, and `ProjectDocSchema` parse of an old doc).
- Grep all project mappers (`toDetail`, summary mapper, `duplicateProject`, create) and show in the report the list you updated.
- No module reads another module's collection. channel never touches `projects`; it only calls project's `index.ts`. project never imports channel.
- `ChannelSchema` strict; no field beyond the spec. `thumbnailTemplate` and `publishSchedule` are only stored in this task.
- No DOM-test dependency. Pure helpers tested with Vitest like the rest of the repo.
- Do not stage: `.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks|plans/*`, stray `01M4W*` files, `tools/explainer-3d/out`, `reference`. Never `git add -A`; stage explicit paths and check `git diff --cached --stat`.

## Tests required

Contract (defaults, limits, handle, URL scheme, hashtag normalisation, legacy-safe parse); server routes (CRUD, duplicate name case-insensitive, handle/url validation, 409 delete in use with count, assignment, unknown channel on assign and on create); project mapper/duplicate tests; client api/hook/helper tests (including the Lịch Sử Không Khô prefill values and last-channel storage helper with a throwing `localStorage`).

## Verification (run, report real output)

`npm run typecheck`, `npm run lint`, `npm run build`, `npx vitest run src/contracts src/server/modules/channel src/server/modules/project src/client/features/channel src/client/features/project src/client/features/seo` (and full `npm test` once; the known failure is `app.test.ts` SPA fallback only). Browser acceptance at 1920×1080 on a **disposable duplicate** project: create two channels, assign one, reload, persistence; delete-in-use → 409 message. If you cannot do it, list it as unverified.

## Report

Untracked `docs/superpowers/tasks/task-108-report.md`: commits, files, mapper list, rules as implemented, verification output with counts, unverified items, deviations. Post a short plan to me first (≤ 15 lines); wait for ACCEPTED before implementing.
