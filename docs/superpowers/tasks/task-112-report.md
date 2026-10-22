# Task 112 — YouTube channel analytics report

This report is intentionally untracked. Work was done directly on `main`; nothing was pushed.

## Commits

| Commit | Scope |
|---|---|
| `8a0760f` — `feat(youtube): 112a read-only channel connect and sync` | Read-only OAuth, encrypted refresh-token store, channel selection/binding, quota accounting, uploads-playlist video sync, and existing job-queue integration. |
| `c06dd0f` — `feat(youtube): 112b analytics and reviews` | Analytics reports/cache, deterministic analysis, dated Partner Program references, project/video links, suggestions, and opt-in AI review. |
| `484453d` — `feat(youtube): 112c channel analytics UI` | Channel connection controls, Vietnamese analytics page, detail/retention view, linked YPP sources, OAuth popup origin matching, link review, client API/hooks, demo seed, and public response/metric-state fixes. |

<details>
<summary>Files changed by commit</summary>

**112a**

`AGENTS.md`, `.env.example`, `src/contracts/channel.ts`, `src/contracts/youtube.ts`, `src/contracts/youtube.test.ts`, `src/server/app.ts`, `src/server/config.ts`, `src/server/db/ensure-indexes.ts`, `src/server/main.ts`, `src/server/modules/channel/channel.test.ts`, `src/server/modules/channel/routes.ts`, `src/server/modules/youtube/MODULE.md`, `credentials-store.ts` and test, `docs.ts`, `index.ts`, `indexes.ts`, OAuth and OAuth-state modules/tests, `repo.ts`, `routes.ts`, `service.ts`, `sync.ts` and test, `youtube-service.test.ts`, and `src/worker/registry.ts`.

**112b**

`AGENTS.md`, project and SEO duplicate contracts/tests, `src/server/app.ts`, project docs/repo/service/index modules and tests, `src/server/modules/seo/index.ts`, YouTube AI review and tests, analysis and tests, Analytics service and tests, YouTube docs/indexes/link service and tests/project routes/repo/review service and tests/routes/sync.

**112c**

`AGENTS.md`, `scripts/seed-youtube-analytics-demo.ts`, `src/client/app/Layout.module.css`, `Layout.tsx`, `router.tsx`, `src/client/features/channel/components/ChannelManagerDialog.tsx`, `src/client/features/youtube/YoutubeAnalyticsPage.tsx` and CSS module, `api.ts` and test, `hooks.ts` and test, `youtube-view.ts` and test, `components/ChannelYoutubeControls.tsx` and CSS module, `src/client/shared/api-client.ts`, `src/contracts/youtube-analytics.ts` and test, and YouTube `analysis.ts`/test, `analytics-service.ts`/test, and `routes.ts`.

</details>

## OAuth, token handling, and write boundary

The app uses direct REST `fetch`; no Google client library was added. It requests exactly `youtube.readonly` and `yt-analytics.readonly`. Authorization uses the OAuth authorization-code flow with PKCE S256, a random state bound to the local channel profile, ten-minute expiry and single-use consumption, `access_type=offline`, and `prompt=consent`. The callback uses the configured server port and accepts `localhost` and `127.0.0.1`.

The user chooses which owned YouTube channel to bind after Google returns the account's channels. Duplicate local binding is rejected. The refresh token is encrypted in `youtubeCredentials` with AES-256-GCM using the base64 32-byte `YOUTUBE_TOKEN_ENCRYPTION_KEY`; access tokens are memory-only. OAuth provider errors redact `access_token`, `refresh_token`, `id_token`, `code`, and `client_secret`. A failed token refresh with `invalid_grant` marks the connection as needing reconnection. Disconnect revokes best-effort and removes local credentials; synced snapshots are removed only with the explicit delete-data option.

The OAuth completion message is accepted only from the tracked popup and from the local callback origin (`localhost:3000` or `127.0.0.1:3000`). This lets the Vite app on port 5173 refresh connection status after the API callback completes, while rejecting messages from other windows or origins.

No upload, edit, schedule, delete, comment, monetary-scope, or write-scope path was added. Tokens are excluded from client contracts, responses, job payloads and logs.

## Routes and YouTube API data

App routes include:

- `POST /api/youtube/connect/:channelId`, `GET /api/youtube/oauth/callback`, and `POST /api/youtube/oauth/select/:channelId` for authorization and channel selection.
- `GET /api/youtube/connection/:channelId`, `POST /api/youtube/disconnect/:channelId`, `POST /api/youtube/sync/:channelId`, and `GET /api/youtube/channels/:channelId/sync-job` for connection and job state.
- `GET /api/youtube/channels/:channelId/overview`, `GET /api/youtube/channels/:channelId/videos`, `GET /api/youtube/videos/:channelId/:videoId`, and `GET /api/youtube/channels/:channelId/suggested-links` for analytics and linking proposals.
- `POST /api/youtube/channels/:channelId/review` and `POST /api/youtube/videos/:channelId/:videoId/review` for opt-in reviews.
- `PUT /api/project/:id/youtube-video` and `DELETE /api/project/:id/youtube-video` to link or unlink a synced video from a project on the same channel profile.

Google requests actually used:

| API request | Fields/metrics used |
|---|---|
| YouTube Data API `channels.list` | Owned-channel discovery; channel's uploads playlist ID and subscriber count. |
| YouTube Data API `playlistItems.list` | Paginated upload video IDs. **`search.list` is never called.** |
| YouTube Data API `videos.list` in batches of 50 | Title, publish date, duration, privacy, view/like/comment counts, and available snippet metadata. The Data API response used here does not provide owner-facing aspect ratio, so Shorts uses the documented duration-only fallback (`duration <= 180 seconds`). |
| YouTube Analytics API `reports.query`, `dimensions=day` | `views`, `estimatedMinutesWatched`, `subscribersGained`, `subscribersLost` for the daily series. |
| YouTube Analytics API `reports.query`, `dimensions=video` | `views`, `estimatedMinutesWatched`, `averageViewDuration`, `averageViewPercentage`, `subscribersGained`, and `subscribersLost`, for 28d, 90d, 365d, and lifetime windows. |
| YouTube Analytics API `reports.query`, `dimensions=elapsedVideoTimeRatio` | `audienceWatchRatio` for retention curves, fetched for the recent long-video set and lazily for opened videos; cached for 24 hours. |

The sources checked on **2026-10-21** are the [OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices), [channels.list](https://developers.google.com/youtube/v3/docs/channels/list), [playlistItems.list](https://developers.google.com/youtube/v3/docs/playlistItems/list), [videos.list](https://developers.google.com/youtube/v3/docs/videos/list), [Data API quota costs](https://developers.google.com/youtube/v3/determine_quota_cost), [Analytics reports.query](https://developers.google.com/youtube/analytics/reference/reports/query), [Analytics metrics](https://developers.google.com/youtube/analytics/metrics), [Analytics dimensions](https://developers.google.com/youtube/analytics/dimensions), and [Reporting API thumbnail metrics](https://developers.google.com/youtube/reporting/v1/reports/metrics).

`impressions` and `impressionsClickThroughRate` are unavailable in this phase. The table shows “Chưa có dữ liệu” with the tooltip that CTR is in Studio and the YouTube Reporting API, which is not implemented. `estimatedRevenue` is not requested because this app does not request a monetary scope. If an Analytics report group is unavailable, that group records its unavailable status; the page keeps available Data API counts and other successful groups and displays unavailable values as “Chưa có dữ liệu”. No metric is synthesized.

**Named follow-up:** implement YouTube Reporting API CTR ingestion for `video_thumbnail_impressions` and `video_thumbnail_impressions_ctr`, including its report job/download lifecycle. Do not add it to this phase.

## Quota estimate

Every Data API list call in the selected methods costs **1 unit**. A full metadata sync estimates:

`1 channels.list + max(1, ceil(videoCount / 50)) playlistItems.list pages + ceil(videoCount / 50) videos.list batches`

| Videos | Estimated Data API units |
|---:|---:|
| 100 | 5 |
| 1,000 | 41 |

The module never calls `search.list`. It tracks an estimate per Google Cloud project/day and refuses a manual sync if the estimate would exceed 8,000 of the documented 10,000 Data API daily units. Actual Google project usage is authoritative. These estimates cover the Data API list calls; Analytics API quota is separate.

## Partner Program reference table

Constants are kept in one dated table, with source URLs and a checked-on date of **2026-10-21**. UI columns are “Hiện tại” and “Từ 01/02/2027” and carry the label “mốc tham khảo, kiểm tra lại trên YouTube Studio”. The panel links directly to [YouTube Partner Program overview](https://support.google.com/youtube/answer/72851) and [expanded YPP availability and thresholds](https://support.google.com/youtube/answer/12843009).

| Tier | Current reference | From 2027-02-01 reference |
|---|---|---|
| Early fan funding | 500 subscribers and 3,000 public watch hours in 12 months **or** 3,000,000 public Shorts views in 90 days | 500 subscribers and 3,000 public watch hours in 12 months **or** 3,000,000 public Shorts views in 90 days |
| Advertising and Premium | 1,000 subscribers and 4,000 public watch hours in 12 months **or** 10,000,000 public Shorts views in 90 days | 1,000 subscribers and 8,000 public watch hours in 12 months **or** 20,000,000 public Shorts views in 90 days |

These are references only. Stored API totals approximate qualifying public watch hours/views, so YouTube Studio always wins. The app does not compute revenue.

## Analytics and review rules

- Views/day uses cumulative `viewCount` (or lifetime Analytics views when needed) divided by age since publication, with a one-day minimum. Other rankings are average view percentage and subscribers gained per 1,000 views. CTR has no ranking value while unavailable.
- Retention flags an early drop when the curve loses more than 30% within the first 30 seconds; the detail chart marks up to three steep drop segments.
- Cohorts compare title features, duration buckets (`<8`, `8–12`, `12–20`, `>20` minutes), publish weekday/hour in the channel timezone, and linked project script preset/visual style. Cohorts under five videos show “mẫu nhỏ — chưa kết luận”; comparisons are descriptive, not causal.
- Channel trends compare the latest 28 days with the preceding 28 days. A window under 100 views is marked “quá ít dữ liệu”; a zero baseline does not produce a percentage change.
- The AI review prompt is `youtube-review-v1`; it receives aggregated, already-computed metrics plus owned-channel video titles, not credentials or raw API payloads. Output is validated as `observations[]`, `hypotheses[]`, and `experiments[]`, with one parse/schema retry. It must distinguish observations from hypotheses, state uncertainty/sample size, tie experiments to supplied values, answer in Vietnamese, and avoid promising or predicting views/revenue. The AI review action was not run against a real provider during acceptance.

## Google Cloud setup Hung must finish

The app's current Google OAuth publishing status is **Testing** with one test user. The UI and module guide recommend switching to **In production** to avoid seven-day refresh-token expiry for these scopes. In production Google can show an unverified-app warning because the sensitive scopes are not verified; Google documents a lifetime cap of 100 new users for an unverified External app. Hung must change the publishing status manually in Google Cloud. For this personal app, authorize only his own account.

1. In Google Cloud, create/select the project and enable YouTube Data API v3 and YouTube Analytics API.
2. Configure the OAuth consent screen as External, add Hung's account as the test user while still in Testing, and list exactly the two read-only scopes above.
3. Create a Web application OAuth client with `http://localhost:3000/api/youtube/oauth/callback` and `http://127.0.0.1:3000/api/youtube/oauth/callback` as redirect URIs.
4. Put `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `YOUTUBE_TOKEN_ENCRYPTION_KEY` in the local server `.env`. Generate the key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. The app's committed `.env.example` includes this command; the working `.env` was not modified.
5. After setup, Hung should switch the app to In production manually, connect the intended channel (choose the right owned/brand channel if prompted), run one manual sync, open its analytics page, and link one synced video to its project.

## Verification and limitations

Expanded required suite, run with the locally installed MongoDB 8.0 system binary because the default `mongodb-memory-server` download previously failed its MD5 check:

```text
$env:MONGOMS_SYSTEM_BINARY='C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe'; npx vitest run src/contracts src/server/modules/youtube src/server/modules/channel src/server/modules/project src/client/features/youtube src/client/features/channel
Test Files  43 passed | 1 skipped (44)
Tests       204 passed (204)
Duration    13.61s
```

The successful run used an elevated local test process because sandboxed processes could not connect to MongoDB on `127.0.0.1:27017` (`EACCES`). `npm run typecheck`, `npm run lint`, and `npm run build` all exited 0. Build emitted the existing informational Vite warning that the client bundle is over 500 kB; tsup completed successfully. The earlier focused 112c run passed 20 tests across 7 files; review follow-up added regression coverage for cross-port OAuth completion and source-link labels.

Seeded UI checks covered the populated profile, empty connected profile, unavailable Analytics groups, disconnected and reconnect-required profiles, video detail and retention, CTR-unavailable tooltip, suggestions, and confirming a project/video link. A late route fix explicitly maps video documents into the public schema so Mongo-only fields do not leak; a tooltip fix keeps the unavailable explanation off valid average-duration values. All synthetic documents were removed afterward (5 demo channels, 2 projects, 4 credentials, 24 videos, 90 daily rows, 15 retention rows, and 2 review rows).

**1920×1080 acceptance is unverified.** The available in-app browser remained at 399×539 after requesting a 1920×1080 viewport and reloading. Headless Chrome could not reach the app's port-forwarded localhost and produced no screenshot. The UI state checks above were therefore performed in the available narrow viewport; no 1920×1080 screenshot is claimed.

Live Google OAuth, channel selection against Hung's account, live sync, and live Analytics availability were not exercised. No real AI-provider call was made. The demo seed uses synthetic channel/project/video data only; no real account data or token was used.
