# Task 108 report — Channel profiles

## Summary

Added reusable YouTube channel profiles with validated CRUD, project assignment, reference-count protection on channel deletion, and channel selection/management in New Project and SEO. The feature includes persistent channel defaults and the history-channel editor prefill; using the prefill only populates the editor and does not save it.

The task was committed directly on `main` as instructed by the planner's mission-specific override. No push or merge was performed.

## Files

- `src/contracts/channel.ts` and `channel.test.ts`: channel document and request/summary contracts, URL and handle validation, hashtag normalization and limits.
- `src/server/modules/channel/`: channel CRUD, unique-name normalization/indexes, `assertChannelExists`, project reference-count delete guard, route tests, and module docs.
- `src/server/modules/project/`: optional legacy-safe `channelId`, create/assignment validation via injected callback, assignment writes with one version increment, summary/detail mapping, duplicate retention, reference count API, tests, and module docs.
- `src/server/app.ts`, `src/server/db/ensure-indexes.ts`, `eslint.config.js`: route/index wiring and the one-way `channel -> project` module boundary.
- `src/client/features/channel/`: CRUD API/hooks, local-storage and prefill helpers, tests, and channel management dialog.
- `src/client/features/project/` and `src/client/features/seo/`: channel selection, last-used channel behavior, project assignment mutation, management/prefill UI, cache invalidation, and tests.
- `AGENTS.md`: module map, dependency graph, and Task 108 Status entry.

## Test changes

- New channel contract tests cover profile defaults, validation, and normalization.
- Existing `src/contracts/project.test.ts` now verifies legacy `channelId: null` defaults in project detail/summary contracts, create defaults, and rejection of an empty channel id.
- Existing `src/server/modules/project/docs.test.ts` now verifies a stored legacy project without `channelId` maps to `null`.
- New `src/server/modules/project/channel.test.ts` covers legacy document reads, assignment/clear, one version increment, reference counts, and channel retention on project duplication.
- New channel route integration tests cover CRUD, validation, duplicate normalized names, unknown channel refusal, and deletion refusal with the number of referencing projects.
- Existing `src/client/features/project/api.test.ts` now checks the project channel assignment request; new channel helper/API/hook tests cover remembered selection, prefill, requests, and query invalidation.

## Verification

- Focused: `npx vitest run src/contracts src/server/modules/channel src/server/modules/project src/client/features/channel src/client/features/project src/client/features/seo` — 30 files passed, 1 skipped; 138 tests passed.
- Full: `$env:MONGOMS_SYSTEM_BINARY='C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe'; npm test` — 108 files passed, 1 skipped; 1,312 tests passed, 1 skipped.
- `npm run typecheck` — passed (exit 0).
- `npm run lint` — passed (exit 0).
- `npm run build` — passed (exit 0); the existing Vite chunk-size warning remains.
- `git diff --check` — passed.

The first default `npm test` attempt failed because mongodb-memory-server's downloaded 8.2.6 binary failed its MD5 check and its local-Mongo fallback was shared across parallel suites. Rerunning with the installed MongoDB 8.0 system binary above passed.

## Real API acceptance

Used a disposable source project and its duplicate against the isolated Mongo database `video_tool_task108_verify_20261021`; no project database was used. Created channels, assigned one to the duplicate, confirmed a fresh GET retained its `channelId` and its version increased once, then confirmed deleting the assigned channel returned HTTP 409 `CHANNEL_IN_USE` with count 1. The dev server and Vite process were stopped afterward. The isolated verification database was left intact.

Browser UI acceptance at 1920×1080 is **unverified**: the CUA inventory exposed no apps or browser surfaces, and `createBrowserTab` reported the in-app browser unavailable. No screenshot or browser interaction is claimed.

## Legacy mapping and ZIP audit

`rg -n "toSummary|toDetail|createProject\\(|duplicateProject\\(|channelId" src/server/modules/project/service.ts src/server/modules/project/repo.ts` found the affected project mappers and persistence points:

- `service.ts:17-22` — `toSummary` returns `row.channelId ?? null`.
- `service.ts:29-34` — `toDetail` returns the parsed document's `channelId` (legacy `ProjectDocSchema` default is `null`).
- `repo.ts:65` — list aggregation projects `channelId` with `$ifNull` for legacy rows.
- `service.ts:98-117` — `createProject` persists the requested id or `null`.
- `service.ts:166-192` — `duplicateProject` spreads the source document, retaining its channel id.
- `service.ts:676-681` — project reference counting and the versioned assignment/clear operation.

ZIP import needs no Task 108 code change: `ProjectImportSeedSchema` picks project fields without `channelId`, and `src/server/modules/file-store/routes.ts:75-109` validates the project then calls `replaceProjectScenes`; it leaves project-level assignment untouched.

## Commit

Commit: `458730d` (`feat(channel): channel profiles and project assignment`), on `main`; not pushed. The planner-requested amend changed only the commit message; tree `b0ebec7` is identical to the prior commit.
