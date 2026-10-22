# Module: youtube

**Purpose:** Connect owned YouTube channels with read-only OAuth, import them as local profiles, refresh profile fields, and synchronize channel/video data for private analytics.
**Owns collections:** `youtubeCredentials`, `youtubeVideos`, `youtubeChannelDaily`, `youtubeChannelTraffic`, `youtubeQuota`, `youtubeRetention`, `youtubeReviews` (and `youtubeGrowthPlans` for the growth plan).
**May import:** `channel`, `project`, `seo`, `job`, and shared AI via their public `index.ts` APIs.

## Security and write boundary

- OAuth requests exactly `youtube.readonly` and `yt-analytics.readonly`; no write scopes or write endpoints are used.
- Refresh tokens are stored only as AES-256-GCM ciphertext. Access tokens remain in process memory. OAuth state and PKCE verifier are single-use and expire after ten minutes. Never include credentials in responses, logs, job payloads, or client contracts.
- Import-mode OAuth stores the refresh token only as AES-256-GCM ciphertext in a pending credential document keyed by a random selection id. A TTL index expires the document after ten minutes, and selection atomically consumes it before creating profiles.
- All Google REST requests use an injectable `fetch`. Do not log request headers, token responses, or raw provider error bodies.
- This module never uploads, edits, schedules, deletes, comments on, or reads other creators' videos.

## API and quota rules

- `GET /api/youtube/channels-overview` returns one safe summary per local channel profile. It reads stored channel credentials, daily analytics, and video documents only; it makes no Google request and consumes no quota. Totals include connected channels only, ignore unavailable values, and intentionally mix channel audiences.
- `POST /api/youtube/sync-all` checks Google setup once, then applies connection, reconnect, estimated-quota, and active-job checks per profile. A channel's skip or enqueue failure does not stop other channels. It reuses the existing `youtube-sync` job type and does not persist or return credentials.

- Channel discovery uses `channels.list?mine=true`, then the channel's uploads playlist via `playlistItems.list`, followed by `videos.list` in batches of 50. **Never call `search.list`.**
- Verified YouTube Data API quota documentation says every `channels.list`, `playlistItems.list`, and `videos.list` list call costs 1 quota unit. The default quota allocation is 10,000 units/day; this module keeps an estimate and pauses manual sync above 8,000 estimated units/day. See https://developers.google.com/youtube/v3/determine_quota_cost.
- A full pass estimates `1 + max(1, ceil(videoCount / 50)) + ceil(videoCount / 50)` units: 5 units for 100 videos, 41 for 1,000. Actual API project usage remains authoritative.
- Manual profile refresh uses one `channels.list?id=…&part=snippet` call and records one quota unit. Sync includes `snippet` in its existing channel-list request, so best-effort empty-field profile fill adds no list call.
- The Data API does not expose a normal channel-owner aspect-ratio field in the selected video response. Shorts are classified by duration <= 180 seconds in this phase; verticality is not verified.
- Analytics API requests are separately recorded by report group. A failed/unavailable report does not invalidate Data API metadata.
- Analytics reports use `views`, `estimatedMinutesWatched`, `averageViewDuration`, `averageViewPercentage`, `subscribersGained`, and `subscribersLost`; daily rows use the day dimension and retention uses `audienceWatchRatio` by `elapsedVideoTimeRatio`. The report API returns only metrics available for that channel and date range.
- Public long videos aged at least 31 days receive one publish-relative first-28-day report (`startDate` = publish date, `endDate` = publish date + 27 days). Stored snapshots are immutable. Failures stay unknown and are reported per video; the growth engine may use lifetime views as an explicitly approximate fallback only at ages 28–45 days. This targeted report is not part of the Data API quota estimate.
- Traffic source reports use `insightTrafficSourceType` with `views` and `estimatedMinutesWatched`, stored separately for channel and video across recent 28-day and lifetime windows. A 400/403 marks that report unavailable; other failures are reported as errors. These mixes are context for the verdict, never a pass/fail input.
- Studio impressions and CTR remain manual in this phase. Each entered record stores its timestamp; the verdict considers CTR known only at 1,000 or more impressions. Per-video exclusion from the growth plan is also user-owned and survives provider sync.
- `impressions` and `impressionsClickThroughRate` are not used in this phase. CTR is available in Studio and through the YouTube Reporting API, which is not connected. `estimatedRevenue` is not requested because it requires a monetary scope, which is intentionally absent.

## Search-term reports and evidence packets (Task 118)

- Search terms use `reports.query` with `dimensions=insightTrafficSourceDetail`, `filters=insightTrafficSourceType==YT_SEARCH`, `metrics=views,estimatedMinutesWatched`, `sort=-views`, and `maxResults=25`. Per-video reports add `;video==VIDEO_ID`; channel reports omit the video filter. Each report request consumes one YouTube Analytics API quota unit, separate from the YouTube Data API's daily unit budget. Analytics data is typically delayed 48–72 hours.
- The official Analytics data model says search terms and external URLs with very small traffic may be omitted. The actual privacy thresholds are not published and may change. An empty successful report therefore means no returned terms, not proof that no searches occurred. A 400/403 is stored as unavailable; other request failures are stored as errors. Stored search-term rows contain only term, views, and estimated minutes watched, alongside capture time and status.
- Sync always requests the channel's last-28-day and lifetime reports. It requests both windows for up to nine newest mature plan videos, for a maximum of 20 search-detail queries per sync (two channel reports plus at most 18 video reports). The 25-row limit and 20-query cap are product safeguards; 25 is documented by Google and 20 is a heuristic. Video review may refresh both windows for one video when they are absent. Channel review never calls Google.
- `review-evidence.ts` builds the only data sent to a review model. It uses Task 117 metric IDs verbatim, adds per-video `v:<videoId>:...` IDs and rank-scoped search IDs, strips control characters, caps user text, and creates a SHA-256 input fingerprint without persisting packet text. Channel packets include at most the newest 20 mature plan videos; when the named 60,000-character packet limit is exceeded, oldest video rows are removed first. Video packets include no images; the prompt states the thumbnail was not visible.
- Retention-drop mapping uses active scenes in their original project order and stored `durationSec` values, the same resolved per-scene duration used by the renderer after voiceover-tail application. The 5% approximate and 20% no-mapping thresholds are heuristics for this feature. At more than 20% mismatch, or with no scenes, only time ranges are sent; no scene indexes or narration are attached.
- Review packets include no access/refresh tokens, credentials, email, provider raw responses, or filesystem paths. Project data is read only through the project module's public API. Titles, descriptions, tags, narration, visual prompts, experiment notes, and search terms are treated as data; never concatenate them into system instructions.

## Growth plan and deterministic verdict (Task 117)

- `youtubeGrowthPlans` stores one strict, channel-profile-scoped plan document. GET returns virtual defaults without writing; PUT replaces only configuration fields and preserves the user's experiment log. Experiments are capped at 100. Plan-status reads only MongoDB and local deterministic analysis; it makes no Google request and no AI call.
- Plan videos must be public, long-form, not removed, published on or after the explicitly entered niche start date, and not manually excluded. A missing niche date keeps all plan video counts and date checkpoints empty; it never infers a date from the upload history. Private and unlisted uploads, Shorts, removed videos, and excluded videos are omitted.
- Mature views use the immutable first-28-day snapshot when available. An Analytics failure remains unknown. Only videos aged 28–45 days may use lifetime views as an explicitly approximate fallback. Eligible videos younger than 31 days are pending with a publish-relative maturity date; videos older than 45 days without a snapshot count as unknown mature data.
- Distribution uses median, mean, max, p25/p75, and the most recent ten mature uploads. Average view duration and subscriber conversion are weighted from available snapshots; the configured duration is used only when no measured duration exists and is marked assumed. Retention is unknown without a stored curve. Wilson 95% intervals apply when there is at least one target hit; zero-hit samples use the one-sided 3/n bound and are called meaningless below ten observations. Hit-rate estimates assume independent uploads.
- Required views per planned upload use the dated advertising tier, annual cadence, average view duration and measured subscriber conversion. Both hours and subscribers are compared with current median and p75. The registry exposes stable snake-case metric IDs, plus a stable first-28-day metric ID for each eligible video, so later explanations can cite exact inputs and outputs.
- Forecasts require at least ten mature uploads, a stored daily Analytics series, current subscriber count, measured subscriber conversion, and complete stored 365-day public-long-form watch minutes. The engine applies a Theil–Sen median slope to up to 20 recent videos; the optimistic and pessimistic slopes use the 80th and 20th percentile of pairwise slopes. Projected views are clamped at ten times current p75. For videos older than 90 days, the tail factor is the median 365-day/lifetime-to-first-28-day view ratio; fewer than three observations uses an assumed factor of 1.0. The baseline watch-hours series is linearly decayed over 52 weeks, and future video watch time and subscriber gains accrue linearly over 365 days. Forecasts are heuristic, not probabilities; the UI says “Dự báo từ ít video có sai số rất lớn”.
- Stages A–E, checkpoint dates, warning/decision rules, and the stop guard use named constants in `growth-plan.ts` and `youtube-plan.ts`. The low-view warning can recommend one next variable from retention, sufficiently covered manual CTR, or dominant traffic-source context. Traffic mix does not decide whether the niche passes. A stop consideration requires the optimistic scenario to miss tolerance, fewer than two first-target hits (or a hit-rate upper bound below 5%), and the configured experiment minimum. Missing experiments change the action to `change_one_variable`. The wording never claims a niche is certainly bad or that YPP approved the channel.
- Confidence is low below 15 mature uploads or when CTR is unknown for most; medium from 15–39; high only at 40+ with a forecast. A manually entered YPP submission date is returned separately and does not affect the verdict.
- `stage` and compact `verdict` are included in `/channels-overview`; full plan, status, and experiment routes are under `/channels/:channelId/plan`.

## Current official documentation checked on 2026-10-22

- OAuth web server and PKCE/redirect behavior: https://developers.google.com/identity/protocols/oauth2/web-server and https://developers.google.com/identity/protocols/oauth2/resources/best-practices.
- Owned channel discovery: https://developers.google.com/youtube/v3/docs/channels/list.
- Upload playlist and video listing: https://developers.google.com/youtube/v3/docs/playlistItems/list and https://developers.google.com/youtube/v3/docs/videos/list.
- Quota: https://developers.google.com/youtube/v3/determine_quota_cost.
- Analytics query and reports: https://developers.google.com/youtube/analytics/reference/reports/query and https://developers.google.com/youtube/analytics/metrics.
- The `reports.query` reference accepts `startDate` and `endDate` in `YYYY-MM-DD` form and documents the `video==...` filter. The data model says analytics latency is typically 48–72 hours. Channel video reports support the six user-activity metrics above; traffic source reports support `insightTrafficSourceType`, `views`, and `estimatedMinutesWatched`, with `video` as a filter. Verified 2026-10-22: https://developers.google.com/youtube/analytics/data_model and https://developers.google.com/youtube/analytics/channel_reports.
- Reporting API thumbnail impressions and CTR: https://developers.google.com/youtube/reporting/v1/reports/metrics. CTR is unavailable here; the Reporting API is not implemented.
- Targeted Analytics metric availability and dimensions: https://developers.google.com/youtube/analytics/metrics and https://developers.google.com/youtube/analytics/dimensions.
- Traffic-source detail support, 25-row cap, required sort, and video filter: https://developers.google.com/youtube/analytics/channel_reports and https://developers.google.com/youtube/analytics/reference/reports/query.
- Search-term anonymization and the unpublished, changeable traffic thresholds: https://developers.google.com/youtube/analytics/data_model.

## Partner Program reference thresholds checked on 2026-10-22

| Tier | Current reference | From 2027-02-01 reference |
|---|---|---|
| Early access / fan funding | 500 subscribers and 3,000 public watch hours in 12 months OR 3,000,000 public Shorts views in 90 days | 500 subscribers and 3,000 public watch hours in 12 months OR 3,000,000 public Shorts views in 90 days |
| Advertising revenue eligibility | 1,000 subscribers and 4,000 public watch hours in 12 months OR 10,000,000 public Shorts views in 90 days | 1,000 subscribers and 8,000 public watch hours in 12 months OR 20,000,000 public Shorts views in 90 days |

Sources: https://support.google.com/youtube/answer/72851 and https://support.google.com/youtube/answer/12843009. These are reference thresholds only; the UI labels them “mốc tham khảo, kiểm tra lại trên YouTube Studio”. The 500-subscriber tier opens fan funding, Creator Partnerships, and Shopping; it is not the advertising revenue tier. Only qualifying public long-form watch hours count; Shorts feed watch hours do not count toward the hours path. Studio is authoritative. Stored Analytics totals are an approximation of qualifying public watch hours/views; no revenue is calculated.

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
- Video sync updates provider-owned metadata and Analytics windows while preserving the first-28-day snapshot, manual reach, plan exclusion, and traffic source data. First-28-day values can be revised by YouTube after capture; this app intentionally keeps the first captured response as its stable comparison point.
