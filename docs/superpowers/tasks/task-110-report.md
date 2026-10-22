# Task 110 report: publishing schedule and upload workflow

## Implemented

- Added a strict `PublishScheduleSchema` with IANA timezone validation, up to 14 unique weekday/time/kind slots, and legacy-safe API and Mongo reads that turn missing or malformed stored schedules into `null`.
- Added pure timezone-aware slot calculation and Vietnamese labels. Slots must be strictly after the supplied time, searches stop at eight weeks, results cap at ten, spring-forward gaps are skipped, and fall-back folds choose only the first occurrence (the count-3 DST test also confirms the repeated wall time is not emitted again).
- Added the starter long/short schedule and the 2–4 hour upload lead suggestion as unverified hints. The channel editor only prefills these values in local form state until the user saves.
- Added a channel chosen-title query through the project module public API and an SEO route. It excludes the current project and projects assigned to other channels. SEO invalidates the cached titles when the channel assignment or chosen title changes.
- Added accent-insensitive duplicate-title guidance, a neutral schedule reminder, a three-slot publish panel with a testable clipboard helper and manual-copy fallback, and an optional schedule block in Markdown export.

## Verification

- Focused command: `npx vitest run src/contracts src/server/modules/seo src/server/modules/channel src/server/modules/project src/client/features/seo src/client/features/channel` — 36 test files passed, 1 skipped; 191 tests passed.
- Full command: `npm test` with `MONGOMS_SYSTEM_BINARY` set to the installed MongoDB 8.0 binary — 116 test files passed, 1 skipped; 1,367 tests passed, 1 skipped.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed. Vite emitted the existing informational warning for the 793.27 kB minified client bundle.
- Contract, Mongo-backed channel/project, SEO route, schedule helper, checklist/export, editor helper, clipboard helper, API, and query invalidation tests provide automated coverage. No AI provider request was made.

## Unverified

- Browser acceptance on a disposable duplicate at 1920×1080, including schedule editing/reload, clipboard permission behavior, and a duplicate-title warning across two same-channel projects. No browser-control surface was available in this environment, so no browser run was possible.
- Starter posting windows and 2–4 hour lead time are hypotheses, not verified YouTube performance guidance; UI and exports label the timing as unverified.
