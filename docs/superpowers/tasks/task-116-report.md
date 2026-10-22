# Task 116 — Channel analytics overview

## Commits

- `f853867 feat(youtube): channels overview and sync-all endpoints`
- `ebe9e2f feat(youtube): analytics menu and channels overview page`
- Both commits are on `main`; no push was made.
- The report and Task 116 plan are untracked. Existing untracked files were left alone.

## What changed

- Added strict `YoutubeChannelsOverviewSchema` and `YoutubeSyncAllResultSchema` contracts in `src/contracts/youtube-overview.ts`.
- Added stored-data-only `GET /api/youtube/channels-overview` and per-profile `POST /api/youtube/sync-all` in the YouTube routes. Overview responses map public fields explicitly and do not include credentials. Bulk sync reuses `youtube-sync`, checking setup, connection, reconnect status, quota, and active jobs per profile; one profile's skip or enqueue error does not stop other profiles.
- Added the `Phân Tích Kênh` sidebar link and `/analytics` overview page. The existing `/channels/:channelId/analytics` route remains available and now has a `← Tất cả kênh` link.
- The overview includes connected-channel totals, sortable responsive cards, connection states, 28-day metrics and comparisons, reference-only monetisation progress, top video, sync status, import, connection, and channel management actions. It handles loading, error, empty, unconfigured, and all-disconnected states.
- Added `docs/app-navigation.md`, updated the YouTube module notes, and updated the Task 116 `AGENTS.md` Status entry.
- Also corrected a pre-existing false positive in `source-encoding.test.ts`: valid uppercase Vietnamese `ĐÃ` had matched the mojibake detector.

## Routes and response shapes

| Route | Behavior |
|---|---|
| `/analytics` | All-channel overview page. |
| `/channels/:channelId/analytics` | Existing per-channel analytics page, with a link back to `/analytics`. |
| `GET /api/youtube/channels-overview` | `{ channels: YoutubeChannelOverviewRow[], totals: ... }`. Each channel row carries profile/connection summary, nullable 28-day and previous-28-day metrics, trend rule, health reference progress, active sync job ID, and best age-normalised video. Totals include connected channels only and label the mixed-channel aggregate. |
| `POST /api/youtube/sync-all` | `{ results: [{ channelId, jobId, skipped?, message? }] }`. Skip reasons are `not-connected`, `needs-reconnect`, `already-running`, and `quota`; Google setup failure uses the existing Vietnamese setup response. |

## Reused helpers and navigation rules

- Server aggregation reuses stored daily rows, `buildChannelTrend`, `buildChannelHealth`, `getVideoRanking`, connection summaries, the existing quota guard, and active `youtube-sync` job lookup.
- The page reuses the Task 113 OAuth popup hook and import flow, `ChannelManagerDialog`, existing per-channel sync/progress support, query keys, and query invalidation helpers.
- Sidebar state is route-based: `/production/*` activates “Sản Xuất & Kịch Bản”; `/analytics` and `/channels/*` activate “Phân Tích Kênh”. Both analytics route families hide the project header and production tabs. The disabled sidebar placeholders remain untouched.

## Layout notes

- CSS defines 3 channel-card columns above 1500px, 2 columns from 901px through 1500px, and 1 column at 900px or below. Totals use 4 columns until 900px, then 2; the page header stacks at 900px or below.
- These breakpoints correspond to the requested 1920px, 1366px, and 900px widths, but visual browser acceptance at those sizes was not completed and no screenshots were captured.

## Verification

- Focused command: `npm test -- --maxWorkers=4 --hookTimeout=30000 src/server/modules/youtube src/client/features/youtube src/client/app src/contracts src/server/modules/video/source-encoding.test.ts` — 43 files passed; 190 tests passed. Mongo-backed tests used the installed MongoDB 8.0 binary through `MONGOMS_SYSTEM_BINARY` and a workspace-local temporary directory.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed. Vite reports the existing large-client-chunk warning (879.67 kB minified).
- Full command: `npm test -- --maxWorkers=4 --hookTimeout=30000` — 143 files passed, 1 skipped; 1,524 tests passed, 1 skipped, 4 failed. Failures: the known `src/server/app.test.ts` SPA fallback assertion (expected 200, received 404); Remotion Chromium preview timed out at 120s; FFmpeg integration timed out at 30s; and a subsequent Remotion render timed out waiting 120s for the render-resource lock. The focused Task 116 set passes.
- The dev seed script ran against an isolated demo database and reported five demo profiles. During a local preview attempt, the API process selected the configured database instead of that demo database because its `.env` loading overrode the intended preview configuration. The preview process was stopped; the overview page was not opened, no write actions were taken, and no screenshots were produced. Live OAuth and YouTube sync were not exercised.

## Manual UI check

After starting the server, worker, and Vite with the intended development configuration:

1. Click “Phân Tích Kênh” in the left menu and inspect populated, disconnected, reconnect-required, and empty states.
2. Check the cards and sort control at 1920×1080, 1366×768, and about 900px.
3. Open “Xem phân tích”, then use “← Tất cả kênh”.
4. Check “Đồng bộ tất cả”, “Thêm kênh từ YouTube”, and “Quản lý kênh” with an authorized test setup.
5. Open a production project and confirm its project header and production tabs remain present.
