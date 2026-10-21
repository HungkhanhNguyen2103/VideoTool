# Module: youtube

**Purpose:** Connect an owned YouTube channel with read-only OAuth and synchronize channel/video data for private analytics.
**Owns collections:** `youtubeCredentials`, `youtubeVideos`, `youtubeChannelDaily`, `youtubeQuota`.
**May import:** `channel`, `project`, `seo`, `job`, and shared AI via their public `index.ts` APIs.

## Security and write boundary

- OAuth requests exactly `youtube.readonly` and `yt-analytics.readonly`; no write scopes or write endpoints are used.
- Refresh tokens are stored only as AES-256-GCM ciphertext. Access tokens remain in process memory. OAuth state and PKCE verifier are single-use and expire after ten minutes. Never include credentials in responses, logs, job payloads, or client contracts.
- All Google REST requests use an injectable `fetch`. Do not log request headers, token responses, or raw provider error bodies.
- This module never uploads, edits, schedules, deletes, comments on, or reads other creators' videos.

## API and quota rules

- Channel discovery uses `channels.list?mine=true`, then the channel's uploads playlist via `playlistItems.list`, followed by `videos.list` in batches of 50. **Never call `search.list`.**
- Verified YouTube Data API quota documentation says every `channels.list`, `playlistItems.list`, and `videos.list` list call costs 1 quota unit. The default quota allocation is 10,000 units/day; this module keeps an estimate and pauses manual sync above 8,000 estimated units/day. See https://developers.google.com/youtube/v3/determine_quota_cost.
- A full pass estimates `1 + max(1, ceil(videoCount / 50)) + ceil(videoCount / 50)` units: 5 units for 100 videos, 41 for 1,000. Actual API project usage remains authoritative.
- The Data API does not expose a normal channel-owner aspect-ratio field in the selected video response. Shorts are classified by duration <= 180 seconds in this phase; verticality is not verified.
- Analytics API requests are separately recorded by report group. A failed/unavailable report does not invalidate Data API metadata.

## Current official documentation checked on 2026-10-21

- OAuth web server and PKCE/redirect behavior: https://developers.google.com/identity/protocols/oauth2/web-server and https://developers.google.com/identity/protocols/oauth2/resources/best-practices.
- Owned channel discovery: https://developers.google.com/youtube/v3/docs/channels/list.
- Upload playlist and video listing: https://developers.google.com/youtube/v3/docs/playlistItems/list and https://developers.google.com/youtube/v3/docs/videos/list.
- Quota: https://developers.google.com/youtube/v3/determine_quota_cost.
- Analytics query and reports: https://developers.google.com/youtube/analytics/reference/reports/query and https://developers.google.com/youtube/analytics/metrics.
- Reporting API thumbnail impressions and CTR: https://developers.google.com/youtube/reporting/v1/reports/metrics. CTR is unavailable here; the Reporting API is not implemented.

## Google Cloud setup

1. Create a Google Cloud project and enable YouTube Data API v3 and YouTube Analytics API.
2. Configure OAuth consent as External, add Hung's Google account as the one test user while testing, and add exactly `https://www.googleapis.com/auth/youtube.readonly` and `https://www.googleapis.com/auth/yt-analytics.readonly`.
3. Create an OAuth client ID of type Web application with authorized redirect URIs `http://localhost:3000/api/youtube/oauth/callback` and `http://127.0.0.1:3000/api/youtube/oauth/callback`.
4. Put `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `YOUTUBE_TOKEN_ENCRYPTION_KEY` in `.env`. Generate the encryption key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
5. **Recommended for this personal app: In production.** In Testing, refresh tokens for these non-basic scopes expire after seven days. In production, users may see Google's unverified-app warning because the sensitive scopes are not verified; for personal use, continue only for Hung's own account. Google documents a lifetime cap of 100 new users for an unverified External app. Publishing status must be switched manually by Hung in Google Cloud. The current project is in Testing with one test user. Verify the current consent-screen rules at https://support.google.com/cloud/answer/15549945.

## Invariants and limitations

- A YouTube channel can bind to only one local profile. Disconnect revokes best-effort, always removes local credentials, and removes synchronized snapshots only when the caller explicitly requests data deletion.
- Missing Data or Analytics metrics remain unavailable; never synthesize a value. `impressionsClickThroughRate` is not requested: CTR lives in Studio and in the YouTube Reporting API, which is not implemented here. Revenue is out of scope and no monetary scope is requested.
- Partner Program thresholds are dated reference values only; YouTube Studio always wins. Do not estimate or show revenue.
