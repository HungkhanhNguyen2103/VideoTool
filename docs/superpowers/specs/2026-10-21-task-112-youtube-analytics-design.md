# Task 112 — YouTube analytics design

Date: 2026-10-21
Status: Approved for implementation.

## Goal and boundaries

Connect existing channel profiles to their own YouTube channels with the exact read-only scopes, then synchronize API-backed channel/video data for deterministic analysis. Never upload, schedule, edit, delete, or inspect another creator's data. Keep monetization as progress references only; do not compute revenue. Never call search.list; discover owned uploads through the uploads playlist.

## Architecture

Add a youtube server module with OAuth authorization-code + PKCE and one-use, ten-minute channel-bound state. Persist refresh credentials only as AES-256-GCM ciphertext in a private collection; keep access tokens in memory and redact OAuth secrets before logs/errors. Use injectable REST fetch calls. Resolve a channel choice before binding, enforce one YouTube channel per local profile, and send manual sync through the existing job queue. Store API snapshots, quota estimates, partial per-report failures, and removed-video markers.

Expose a token-free connection summary on channel APIs. Add project-owned video linking through the project public API and normalized-title/date suggestions through the SEO public API. Put pure analytics calculations in a deterministic service: trends, monetization progress, age-normalized rankings, retention drop segments, and control-variable cohorts. AI review is opt-in, uses existing provider plumbing, and receives only validated aggregates and owned video titles/metrics.

Add a Vietnamese channel analytics page and channel-manager controls using current CSS modules and tokens, with no new chart dependency. Provide empty/loading/error/unavailable states. CTR stays unavailable with an explanation that it is in Studio and the Reporting API, which this phase does not implement.

## Decisions pinned by approval

- Scopes are exactly youtube.readonly and yt-analytics.readonly.
- OAuth remains REST/fetch based; no googleapis dependency.
- Google Cloud setup recommends In production because Testing refresh tokens expire after seven days; Hung must change the status manually. Explain the unverified-app warning and documented lifetime cap of 100 new users.
- Quota estimates count list calls at one unit each; search.list is never called. Use uploads playlist pagination and videos.list batches of 50; refuse estimated usage above 8,000 daily units.
- One dated constants table records current Partner Program thresholds and the announced 2027-02-01 thresholds, sources, and checked date. UI shows both reference columns and tells users to verify in Studio; Studio wins.
- CTR and revenue are not calculated. The Reporting API follow-up is explicitly named in the report.
- Implement directly on main in commits 112a (connect/sync), 112b (analysis/AI/link), and 112c (client/docs/report). Keep design and plan untracked; preserve all pre-existing untracked files and staging exclusions.
