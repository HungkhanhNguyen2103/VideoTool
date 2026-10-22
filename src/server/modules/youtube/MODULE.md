# Module: youtube

**Purpose:** Connect owned YouTube channels with read-only OAuth, import them as local profiles, refresh profile fields, and synchronize channel/video data for private analytics.
**Owns collections:** `youtubeCredentials`, `youtubeVideos`, `youtubeChannelDaily`, `youtubeQuota`, `youtubeRetention`, `youtubeReviews`.
**May import:** `channel`, `project`, `seo`, `job`, and shared AI via their public `index.ts` APIs.

## Security and write boundary

- OAuth requests exactly `youtube.readonly` and `yt-analytics.readonly`; no write scopes or write endpoints are used.
- Refresh tokens are stored only as AES-256-GCM ciphertext. Access tokens remain in process memory. OAuth state and PKCE verifier are single-use and expire after ten minutes. Never include credentials in responses, logs, job payloads, or client contracts.
- Import-mode OAuth stores the refresh token only as AES-256-GCM ciphertext in a pending credential document keyed by a random selection id. A TTL index expires the document after ten minutes, and selection atomically consumes it before creating profiles.
- All Google REST requests use an injectable `fetch`. Do not log request headers, token responses, or raw provider error bodies.
- This module never uploads, edits, schedules, deletes, comments on, or reads other creators' videos.

## API and quota rules

- Channel discovery uses `channels.list?mine=true`, then the channel's uploads playlist via `playlistItems.list`, followed by `videos.list` in batches of 50. **Never call `search.list`.**
- Verified YouTube Data API quota documentation says every `channels.list`, `playlistItems.list`, and `videos.list` list call costs 1 quota unit. The default quota allocation is 10,000 units/day; this module keeps an estimate and pauses manual sync above 8,000 estimated units/day. See https://developers.google.com/youtube/v3/determine_quota_cost.
- A full pass estimates `1 + max(1, ceil(videoCount / 50)) + ceil(videoCount / 50)` units: 5 units for 100 videos, 41 for 1,000. Actual API project usage remains authoritative.
- Manual profile refresh uses one `channels.list?id=…&part=snippet` call and records one quota unit. Sync includes `snippet` in its existing channel-list request, so best-effort empty-field profile fill adds no list call.
- The Data API does not expose a normal channel-owner aspect-ratio field in the selected video response. Shorts are classified by duration <= 180 seconds in this phase; verticality is not verified.
- Analytics API requests are separately recorded by report group. A failed/unavailable report does not invalidate Data API metadata.
- Analytics reports use `views`, `estimatedMinutesWatched`, `averageViewDuration`, `averageViewPercentage`, `subscribersGained`, and `subscribersLost`; daily rows use the day dimension and retention uses `audienceWatchRatio` by `elapsedVideoTimeRatio`. The report API returns only metrics available for that channel and date range.
- `impressions` and `impressionsClickThroughRate` are not used in this phase. CTR is available in Studio and through the YouTube Reporting API, which is not connected. `estimatedRevenue` is not requested because it requires a monetary scope, which is intentionally absent.

## Current official documentation checked on 2026-10-21

- OAuth web server and PKCE/redirect behavior: https://developers.google.com/identity/protocols/oauth2/web-server and https://developers.google.com/identity/protocols/oauth2/resources/best-practices.
- Owned channel discovery: https://developers.google.com/youtube/v3/docs/channels/list.
- Upload playlist and video listing: https://developers.google.com/youtube/v3/docs/playlistItems/list and https://developers.google.com/youtube/v3/docs/videos/list.
- Quota: https://developers.google.com/youtube/v3/determine_quota_cost.
- Analytics query and reports: https://developers.google.com/youtube/analytics/reference/reports/query and https://developers.google.com/youtube/analytics/metrics.
- Reporting API thumbnail impressions and CTR: https://developers.google.com/youtube/reporting/v1/reports/metrics. CTR is unavailable here; the Reporting API is not implemented.
- Targeted Analytics metric availability and dimensions: https://developers.google.com/youtube/analytics/metrics and https://developers.google.com/youtube/analytics/dimensions.

## Partner Program reference thresholds checked on 2026-10-21

| Tier | Current reference | From 2027-02-01 reference |
|---|---|---|
| Early access / fan funding | 500 subscribers and 3,000 public watch hours in 12 months OR 3,000,000 public Shorts views in 90 days | 500 subscribers and 3,000 public watch hours in 12 months OR 3,000,000 public Shorts views in 90 days |
| Advertising revenue eligibility | 1,000 subscribers and 4,000 public watch hours in 12 months OR 10,000,000 public Shorts views in 90 days | 1,000 subscribers and 8,000 public watch hours in 12 months OR 20,000,000 public Shorts views in 90 days |

Sources: https://support.google.com/youtube/answer/72851 and https://support.google.com/youtube/answer/12843009. These are reference thresholds only; the UI labels them “mốc tham khảo, kiểm tra lại trên YouTube Studio”. Studio is authoritative. Stored Analytics totals are an approximation of qualifying public watch hours/views; no revenue is calculated.

## Named follow-up

- **YouTube Reporting API CTR integration:** separately review and implement the Reporting API job/download lifecycle for `video_thumbnail_impressions` and `video_thumbnail_impressions_ctr`. Until then, the UI shows “Chưa có dữ liệu” and explains that CTR is in Studio and the unimplemented Reporting API.

## Google Cloud setup

1. Create a Google Cloud project and enable YouTube Data API v3 and YouTube Analytics API.
2. Configure OAuth consent as External, add Hung's Google account as the one test user while testing, and add exactly `https://www.googleapis.com/auth/youtube.readonly` and `https://www.googleapis.com/auth/yt-analytics.readonly`.
3. Create an OAuth client ID of type Web application with authorized redirect URIs `http://localhost:3000/api/youtube/oauth/callback` and `http://127.0.0.1:3000/api/youtube/oauth/callback`.
4. Put `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `YOUTUBE_TOKEN_ENCRYPTION_KEY` in `.env`. Generate the encryption key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
5. **Recommended for this personal app: In production.** In Testing, refresh tokens for these non-basic scopes expire after seven days. In production, users may see Google's unverified-app warning because the sensitive scopes are not verified; for personal use, continue only for Hung's own account. Google documents a lifetime cap of 100 new users for an unverified External app. Publishing status must be switched manually by Hung in Google Cloud. The current project is in Testing with one test user. Verify the current consent-screen rules at https://support.google.com/cloud/answer/15549945.

## Invariants and limitations

- A YouTube channel can bind to only one local profile. Disconnect revokes best-effort, always removes local credentials, and removes synchronized snapshots only when the caller explicitly requests data deletion.
- Profile imports and refreshes use the channel module public API. Default refresh fills only empty/default `name`, `handle`, `description`, and `language`; explicit overwrite refresh can change only those selected fields. Links, hashtags, footer, AI disclosure, thumbnail template, publishing schedule, and tagline are never changed by YouTube refresh.
- Google decides which channels `channels.list?mine=true` returns for a given consent. The picker shows already-bound channels as disabled and supports a repeated sign-in when another channel is not listed.
- Missing Data or Analytics metrics remain unavailable; never synthesize a value. `impressionsClickThroughRate` is not requested: CTR lives in Studio and in the YouTube Reporting API, which is not implemented here. Revenue is out of scope and no monetary scope is requested.
- Partner Program thresholds are dated reference values only; YouTube Studio always wins. Do not estimate or show revenue.
