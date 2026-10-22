# Task 116 — "Phân Tích Kênh" menu with an all-channels overview page

Work directly on `main` (no feature branch, no worktree). Never push. Do not stage temp files (`.env`, `.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`, `docs/superpowers/plans/*`, the stray `01M4W…` files in the repo root). Keep LF line endings in commits. Follow AGENTS.md (rule 11: Status line in the same commit; import through each module's `index.ts`; CSS Modules + design tokens only, no new colors). Code, comments and commit messages are English; user-facing text is Vietnamese. Primary viewport 1920×1080; also check 1366×768 and ~900 px. Small/medium task: short untracked plan, no design-approval round. Two commits: `feat(youtube): channels overview and sync-all endpoints` and `feat(youtube): analytics menu and channels overview page`.

## Why

Task 112 added per-channel analytics at `/channels/:channelId/analytics` (`YoutubeAnalyticsPage`), reachable only through a small link in the project header when the open project has a channel (`Layout.tsx`). Hung wants it to be a first-class menu: a **new item in the left "Menu tổng" sidebar**, opening an **overview of all channels** (cards), from which he drills into one channel's existing analytics page. Decisions already made with Hung: the new item goes below "Sản Xuất & Kịch Bản" and above "Menu 2"/"Menu 3" (those two disabled placeholders stay exactly as they are); the landing page is the overview of every channel, not a redirect into one channel.

## 1. Sidebar and routing (`src/client/app/Layout.tsx`, `router.tsx`, `Layout.module.css`, `IconSprite.tsx`)

- New sidebar item **"Phân Tích Kênh"** (link, same style as "Sản Xuất & Kịch Bản") → `/analytics`. Add a small `chart` icon symbol (`i-chart`, simple bar-chart glyph, same stroke style as the existing symbols) to `IconSprite.tsx`; no icon library.
- Make the active state **route-based for both menu items** (today the first item is hard-coded active): "Sản Xuất & Kịch Bản" is active on `/production/*`, "Phân Tích Kênh" on `/analytics` and `/channels/*`. Use `aria-current="page"` accordingly. Do not touch the disabled "Menu 2"/"Menu 3".
- Routes: add `analytics` → `ChannelsOverviewPage`. Keep `channels/:channelId/analytics` working unchanged (existing links and the project-header link must not break).
- On `/analytics` and `/channels/*` hide the project header ("Dự án đang mở") and the production tabs row, since they are project-specific; these pages render their own page header. On `/production/*` behavior is unchanged. Keep the project-header "Phân tích kênh" link as is.
- On the per-channel page add a back link "← Tất cả kênh" to `/analytics` in its header, and keep its existing channel selector.

## 2. Server: overview and sync-all (`src/server/modules/youtube`)

All values come from **stored data only** (no Google call, no quota cost) and reuse existing helpers (`buildChannelTrend`, `buildChannelHealth`, stored daily series, credentials/connection summary, video docs). Do not duplicate analytics math.

- `GET /api/youtube/channels-overview` → array, one row per channel profile (connected or not), each with:
  - `channelId`, `name`, `handle?`, `language`;
  - `connection`: the existing `YoutubeConnectionSummary` (state, title, avatar URL, `lastSyncAt`, `lastSyncError`, `needsReconnect`);
  - `subscriberCount|null`, `videoCount` (non-removed synced videos), `longCount`, `shortCount`;
  - `last28` and `previous28`: `{ views, estimatedMinutesWatched, subscribersGained, subscribersLost }` (null fields when the daily series is missing) plus the percent change helpers the trend builder already produces, with the same "too little data" rule for tiny channels;
  - `health`: the compact monetisation progress from `buildChannelHealth` (current tier numbers, labelled as reference thresholds, same shape as the per-channel overview uses);
  - `activeSyncJobId|null` (existing `getActiveJob` for `youtube-sync`);
  - `topVideo`: id/title/views-per-day of the best age-normalised video (reuse `getVideoRanking`), or null.
- Response also includes `totals` across **connected** channels: `subscriberCount`, `views28`, `watchHours28`, `subscribersGained28`, `channelsConnected`, `channelsNeedReconnect` (sums ignore nulls; document that totals mix channels).
- `POST /api/youtube/sync-all` → for each connected channel (not `needsReconnect`) apply the same checks as `POST /sync/:channelId` (configured, connected, quota estimate guard, no active sync) and enqueue; return `{ results: [{ channelId, jobId|null, skipped?: 'not-connected'|'needs-reconnect'|'already-running'|'quota' , message? }] }`. One skipped channel never fails the whole call; refuse with the existing Vietnamese setup message only when Google is not configured at all. No new queue type: reuse `youtube-sync` jobs.
- Tests (temp DB + fake Google fetch like existing youtube tests): overview with 0 channels, with one unconnected profile, with a connected channel having daily data, with missing daily data (nulls, no divide-by-zero), totals ignore unconnected channels, active job id surfaced; sync-all enqueues only eligible channels, reports skip reasons, quota-blocked channel does not block others, no duplicate job when one is already running, Google-not-configured refusal; no token or credential field appears in any response (scan the serialized responses).

## 3. Client: `ChannelsOverviewPage` (`src/client/features/youtube/`, plus API/hooks/helpers/tests)

Page header: title "Phân tích kênh", subtitle one line; actions on the right: **"Đồng bộ tất cả"** (disabled when nothing is eligible or Google is not configured; shows per-channel result summary after the call, e.g. "Đã xếp hàng 2 kênh, bỏ qua 1: cần kết nối lại"), **"Thêm kênh từ YouTube"** (reuse the Task 113 import flow through the shared OAuth popup hook, do not duplicate it), **"Quản lý kênh"** (opens the existing `ChannelManagerDialog`).

- **Totals strip** (4 compact tiles): tổng subscriber, lượt xem 28 ngày, giờ xem 28 ngày, subscriber mới 28 ngày; small caption "Chỉ tính kênh đã kết nối".
- **Channel cards** in a responsive grid (3 columns at 1920, 2 at ~1366, 1 below ~900), sorted by 28-day views desc by default with a small sort select (28-day views, subscribers, name, last sync). Each card: avatar (the connection's thumbnail URL; fallback initial), name + handle, connection badge (Chưa kết nối / Đã kết nối / Cần kết nối lại / Chưa cấu hình Google), subscribers and video counts (video dài / Shorts), 28-day views / watch hours / subscribers gained each with a change arrow versus the previous 28 days (neutral "quá ít dữ liệu" when the rule says so; never a fake percentage), a compact monetisation progress mini-bar pair labelled "mốc tham khảo", best video line when present, last sync time and last sync error, a spinner state while `activeSyncJobId` is set (reuse the job progress hook for the running card only, do not open an SSE per card when idle).
- Card actions: **"Xem phân tích"** (primary) → `/channels/:channelId/analytics`; **"Đồng bộ"** (when connected, disabled while syncing); **"Kết nối YouTube"** / **"Kết nối lại YouTube"** when not connected / needs reconnect (reuse `ChannelYoutubeControls` logic or the shared popup hook; do not fork it).
- States: loading skeleton, error with retry, empty ("Chưa có hồ sơ kênh. Bấm Thêm kênh từ YouTube hoặc Quản lý kênh để tạo."), Google-not-configured banner with the existing setup text, all-disconnected state.
- Data refresh: refetch after sync-all, after any card sync finishes, after the import popup finishes and when the channel dialog closes; use the existing query-key conventions and invalidate the per-channel queries too.
- Pure helpers with no-DOM tests (`channels-overview-view.ts`): sort, change-arrow text with the small-sample rule, badge state from the connection, totals caption, sync-all result summary text, grid-independent formatting (numbers `vi-VN`, hours with one decimal).
- API helpers/hooks tests: URLs, methods, response schema validation (add the shared Zod schemas in `src/contracts/youtube.ts` or a new `youtube-overview.ts`, strict, no token fields), error mapping.

## 4. Docs and Status

Update `src/server/modules/youtube/MODULE.md` (new endpoints, stored-data-only rule), the client feature notes if there is a doc for `features/youtube`, and any doc that lists app routes or the sidebar. Add the AGENTS.md Status line in the same commit.

## Out of scope

Cross-channel video comparison, new metrics, charts beyond the mini progress bars, scheduled/background sync, changes to the per-channel page other than the back link, the 3D "Menu 2" work, touching the disabled placeholders, and any write scope or YouTube upload feature.

## Verification (run and report real output)

`npm run typecheck`, `npm run lint`, new and touched vitest files plus `src/server/modules/youtube`, `src/client/features/youtube`, `src/client/app`, `src/contracts`, and `npm run build` (reuse the local Mongo workaround from earlier tasks if needed and say so). Use the existing dev-only seed script (`scripts/seed-youtube-analytics-demo.ts`) to populate two or three demo channels (one connected with data, one needing reconnect, one unconnected) and check the page at 1920×1080, 1366×768 and 900 px, plus the zero-channel state; describe what you saw and save screenshots under the scratchpad/outputs if your tool allows it, otherwise say plainly what could not be captured and give Hung the manual steps (restart server + worker + Vite, click "Phân Tích Kênh" in the left menu, check cards, "Xem phân tích", back link, "Đồng bộ tất cả", "Thêm kênh từ YouTube", then open a production project and confirm the old tabs and header are unchanged).

## Report

Write `docs/superpowers/tasks/task-116-report.md` (untracked): commits, files changed, route table, endpoint shapes, which helpers were reused, sidebar active-state rule, layout notes at the three widths, verification output, what you could not verify, deviations. Do not push.
