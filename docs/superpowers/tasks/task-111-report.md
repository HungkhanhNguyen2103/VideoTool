# Task 111 — Shorts package from a long video

## Implementation

- Added `pickShortsWindows(project)` as a pure shared contract helper. It validates chapter scene counts, compacts inactive scenes, uses per-scene FPS frame rounding, snaps every window to active scene boundaries, and selects up to three non-overlapping 30–55 second candidates. Ranking favors windows inside the active climax span, or the longest active chapter when no active climax exists, then distance from the target center and earliest start. `sceneStartIndex`/`sceneEndIndex` are zero-based indexes into the compacted active timeline; the end index is inclusive.
- Added legacy-safe `shorts: []` and `longVideoUrl: ''` SEO defaults, strict short-entry limits, HTTP(S)-only URLs, canonical hashtags with `#Shorts`, and a project-owned update path. PATCH rejects any Shorts ID, time, or chapter change unless the whole list matches both stored data and the current deterministic windows.
- Added the versioned `seo-shorts` preset, prompt builder, strict snake-case output parser, exact window-ID set checks, and one validation retry. Shorts generation uses its own AI call when windows exist; zero windows store an empty list without a Shorts call. Manual Shorts prompt/import is standalone-only and mixed manual requests return 422. When main SEO sections and Shorts are both requested, `generatedBy.promptVersion` records the main prompt version.
- Added display/export-only `{LONG_VIDEO_URL}` substitution, stale/unresolved checklist warnings, a Shorts Markdown block, panel view helpers, and a Shorts UI panel with title/caption/hashtag edits, counters, preview, and copy fallbacks. Cutting and vertical rendering remain manual.
- Review round 1 fixed a hashtag merge-order bug: `ensureShortsHashtag` now preserves an existing `#Shorts` at positions 0–4 and reserves slot five when it appears later or is absent. Coverage includes positions 0, 2, and 6, six inputs without `#Shorts`, case/accent variants, and a service-level channel-default merge that previously pushed it past slot five.

## Tests

- Added `src/contracts/seo-shorts.test.ts` for active-scene compaction, boundary-aligned IDs/indexes, duration bounds, non-overlap/count, short videos, target ranking, count mismatch, and determinism with legacy null roles.
- Added `src/client/features/seo/shorts-view.test.ts` for panel helper mapping, active narration excerpts, placeholder preview behavior, stale saved content, and clipboard fallback.
- Expanded SEO contract, checklist/export, prompt/parser/service, route, project storage, client API, and worker tests. Existing tests changed: `src/server/modules/project/docs.test.ts` now expects the two legacy SEO defaults; `src/server/modules/script/ai/presets/loader.test.ts` now expects the new Shorts preset to be copied into `dist/presets`. Review round 1 adds five hashtag-helper cases in `src/contracts/seo.test.ts` and one service-level channel-default regression case in `src/server/modules/seo/seo-ai.test.ts`.

## Verification

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; the existing Vite chunk-size warning remains.
- Required focused command (`src/contracts`, SEO/project/channel modules, SEO client, worker) — 36 passed files, 1 skipped file; 244 tests passed.
- Expanded focused command including the script preset packaging test — 37 passed files, 1 skipped file; 258 tests passed.
- `npm test` with `MONGOMS_SYSTEM_BINARY=C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe` — 118 passed files, 1 skipped file; 1,411 tests passed, 1 skipped test.
- `git diff --check` — no whitespace errors.

## Unverified

- Browser acceptance on a disposable duplicate: unverified because no browser/computer-use tool was available in this session.
- A real AI-provider run: unverified; no provider call was made.
- The panel, copy interaction, and reload persistence therefore have automated coverage but no live-browser acceptance evidence.
