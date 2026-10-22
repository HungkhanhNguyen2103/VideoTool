# Task 117 — Channel growth plan, milestones, forecast and decision engine (deterministic, no AI)

Work directly on `main` (no feature branch, no worktree). Never push. Do not stage temp files (`.env`, `.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`, `docs/superpowers/plans/*`, the stray `01M4W…` files in the repo root). Keep LF line endings in commits. Follow AGENTS.md (rule 11: Status line in the same commit; import through each module's `index.ts`; CSS Modules + design tokens only, no new colors). Code, comments and commit messages are English; user-facing text is Vietnamese. Primary viewport 1920×1080; also check 1366×768 and ~900 px. Three commits suggested: `feat(youtube): first-28-day snapshots and manual reach inputs`, `feat(youtube): growth plan, forecast and verdict engine`, `feat(youtube): growth plan panel and verdict UI`. Write a short untracked plan; no design-approval round (the design below is already agreed with Hung).

**This task contains no AI call.** Everything is computed by pure, tested functions from stored data. A follow-up task (Task 118) will add Claude-CLI explanations on top of the numbers computed here, so keep every computed value addressable by a stable **metric id** (see 3.6).

## Why (decisions agreed with Hung, 2026-10-22)

Hung runs a new history channel (new niche since 20/10/2026; older private videos belong to a previous niche and must not count). He publishes **3–4 long videos per week** and wants: (1) concrete milestones up to monetisation eligibility; (2) "how many videos until one reaches 500 / 1,000 views"; (3) a decisive recommendation — continue, change one variable, or consider stopping the niche — based on pre-set, checkable rules, never wishful; (4) no waiting a full year to decide: the decision points use early indicators and a forecast against a tolerance horizon. The tool must be honest about small samples, assumptions and what it cannot know.

Reference thresholds (official, checked 2026-10-22; keep them in the existing dated constants table `YOUTUBE_PARTNER_PROGRAM_THRESHOLDS`, add missing fields, label as "mốc tham khảo, kiểm tra lại trên YouTube Studio"): until 2027-01-31 full tier = 1,000 subs + 4,000 public watch hours in 365 days (or 10M Shorts views in 90 days); from **2027-02-01** new creators need 1,000 subs + **8,000** hours (or 20M Shorts views in 90 days); the 500-sub tier (3,000 hours or 3M Shorts views) only unlocks fan funding / creator partnerships / shopping, not ad revenue. Sources: https://support.google.com/youtube/answer/72851 and https://support.google.com/youtube/answer/12843009. Only **public long-form** watch hours count toward hours; Shorts do not add hours. Re-read both pages before coding and follow them if they differ.

## What exists (reuse, do not duplicate)

`src/server/modules/youtube` (Task 112/113/116): `sync.ts`, `analytics-service.ts`, `analysis.ts` (`getVideoRanking`, `getViewsPerDay`, `buildChannelTrend`, `buildChannelHealth`, `getRetentionDropSegments`, `YOUTUBE_PARTNER_PROGRAM_THRESHOLDS`, small-sample constants), `repo.ts`/`docs.ts` (collections `youtubeVideos`, daily series, reviews), routes (`/api/youtube/channels/:id/overview`, `/videos`, `/videos/:channelId/:videoId`, `/channels-overview`), contracts `src/contracts/youtube.ts`, client `features/youtube` (`YoutubeAnalyticsPage`, `ChannelsOverviewPage`, helpers), channel profiles (`src/server/modules/channel`). Project↔video links exist (`youtubeVideoId` on projects).

## 1. Data prerequisites

### 1.1 "First 28 days" snapshot per video (the milestone metric)
The existing per-video windows (28d/90d/365d/lifetime) are relative to the sync date, **not** to the publish date, so they cannot answer "did this video reach 500 views in its first 28 days". Add an immutable snapshot:
- For every synced **public** video whose age is ≥ **31 days** (28 days + Analytics latency; named constant) and that has no snapshot yet, run one YouTube Analytics `reports.query` with `startDate = publish date`, `endDate = publish date + 27 days`, filtered to that video, metrics `views, estimatedMinutesWatched, averageViewDuration, averageViewPercentage, subscribersGained, subscribersLost`. Store as `first28d` on the video document with `capturedAt`. Never overwrite an existing snapshot (YouTube may revise numbers later; the snapshot is a stable reference). **Verify in the current Analytics API documentation** that a per-video filter and a start date equal to the publish date are valid and what the data latency is; list what you verified in the report. Respect the existing quota/guard rules; Analytics quota is separate from the Data API estimate.
- Fallback if the per-video query is not possible for a video (API error): do not invent. Mark `first28d = null` with the reason in the sync report; the engine (section 3) then uses lifetime views **only** for videos aged 28–45 days and labels every figure derived from them `xấp xỉ`.

### 1.2 Traffic source mix (small, optional)
Per channel and per video (last 28 days and lifetime), store the `insightTrafficSourceType` breakdown (views, minutes watched). Verify the dimension/metrics in the docs; on any 400/403 mark the group unavailable like the other Analytics groups. This is context for the verdict (for example almost all views from external links vs from browse/suggested), not a pass/fail input.

### 1.3 Manual reach inputs (bridge until CTR is automated)
Impressions and CTR are not available from the Analytics API (the Reporting API CTR task is Task 119). Add an optional per-video manual record `manualReach: { impressions: int ≥ 0, ctrPercent: number 0–100, enteredAt }` that Hung can type from YouTube Studio's Reach tab: `PUT /api/youtube/videos/:channelId/:videoId/manual-reach` and `DELETE` (strict schema, Vietnamese errors). Show it in the video drawer as "Nhập tay từ Studio (chưa tự động)". The verdict engine treats CTR as known only for videos with ≥ **1,000 impressions** (named constant `MIN_IMPRESSIONS_FOR_CTR`); otherwise CTR is "unknown".

### 1.4 Eligibility of videos for the plan
Only videos that are **public, long-form (not Shorts), not removed, published on or after the plan's `nicheStartDate`** and not manually excluded are "plan videos". Private/unlisted/scheduled videos never count (Hung's older private videos must be ignored). Add `excludedFromPlan: boolean` on the video (default false) with `PUT /api/youtube/videos/:channelId/:videoId/plan-exclusion { excluded }` and a toggle in the video drawer ("Loại khỏi kế hoạch").

## 2. Plan configuration (per channel profile)

New collection `youtubeGrowthPlans`, one document per channel profile (`_id = channelProfileId`), strict schema in `src/contracts/youtube-plan.ts` with defaults:
- `nicheStartDate` (ISO date, default `null` → the engine shows "Đặt ngày bắt đầu ngách" and refuses date-based checkpoints until set; do **not** silently default it to the earliest synced video, because older private videos belong to another niche);
- `cadencePerWeek` (long videos per week, number 0.5–14, default **3.5**);
- `viewTargets`: `first` 500, `strong` 1000 (views in the first 28 days);
- `assumedAvgViewDurationMin` (default 4.0, used only until measured data exists; every figure that uses it is labelled `giả định`);
- `toleranceMonths` (default 18) — the longest Hung is willing to wait to reach eligibility;
- checkpoint settings: `warnAtMatureVideos` 15, `decideAtMatureVideos` 40, `decideMinMonths` 4, `hardReviewWeek` 26, `minExperimentsBeforeStop` 2;
- `submittedForReviewAt` (nullable date, Hung marks when he applied to YPP; label "Đã nộp xét duyệt YPP (tự đánh dấu)");
- `experiments`: log of `{ id, date, variable: 'topic'|'title'|'thumbnail'|'hook'|'length'|'cadence'|'other', note ≤ 300, videoIds?: string[] }`, max 100.
Routes: `GET/PUT /api/youtube/channels/:channelId/plan` (PUT replaces validated config; `409` if the channel profile does not exist), `POST /api/youtube/channels/:channelId/plan/experiments` and `DELETE …/experiments/:id`. Add the indexes through `indexes.ts`. Keep all numbers in one exported defaults constant with a comment "gợi ý của người dùng/Claude, chưa kiểm chứng".

## 3. Pure engine (`src/server/modules/youtube/growth-plan.ts` + contracts, fully unit-tested; no I/O)

Inputs: plan config, eligible plan videos with `first28d`, channel daily series, subscriber count, traffic mix, manual reach, `now`. All functions deterministic; no `Math.random`, no `Date.now()` inside (pass `now`).

3.1 **Mature videos**: plan videos with a `first28d` snapshot (or the labelled 28–45-day lifetime fallback). Output `matureCount`, `pendingCount` (plan videos younger than 31 days, with the date each becomes mature).

3.2 **Distribution**: median, mean, max, p25/p75 of first-28-day views over mature videos; median over the **last 10** mature videos (trend-sensitive); weighted average view duration (minutes watched ÷ views over mature videos) with fallback to the assumption; subscribers per 1,000 views over mature videos; fraction of videos with early retention drop (reuse existing detection where a curve is stored; otherwise unknown).

3.3 **Hit rate** for each target T in {`first`, `strong`}: k = mature videos with first-28-day views ≥ T, n = mature count. Wilson 95% interval for p (implement carefully, test against known values), and "videos until the first hit": if k ≥ 1 report an interval `[1/p_high, 1/p_low]` (cap at a sane maximum and say so), if k = 0 report only the one-sided upper bound by the rule of three (`3/n`) and the text "chưa có video nào đạt mốc; ước lượng chưa có ý nghĩa" when n < 10. State the independence assumption in the assumptions list.

3.4 **Required views per video** to reach eligibility within a 365-day window at the configured cadence: `N = cadencePerWeek × 52`; hours target H from the dated thresholds table for the relevant tier and date; `requiredAvgViewsForHours = (H × 60 / N) / avgViewDurationMin`; `requiredAvgViewsForSubs = (1000 / N) / (subsPer1000Views / 1000)` (null while subs/1,000 views is unmeasurable); `binding = max(...)` and say which condition binds. Both with `assumed` flags when using the assumption. Compare with the current median and p75 → "khoảng cách": ratio and absolute.

3.5 **Forecast (three scenarios)**: only when `matureCount ≥ 10` and the daily series exists; otherwise `{ status: 'insufficient-data', reason }`.
- Trend: robust slope (Theil–Sen) of first-28-day views against publish order over the last up to 20 mature videos; the optimistic/pessimistic scenarios use the 80th/20th percentile of pairwise slopes (document the choice); views projected per future video = clamp(current level + slope × k, 0, cap = 10 × current p75) to avoid explosions.
- Tail factor: ratio of (views accrued by day 365 or lifetime) to first-28-day views measured on videos older than 90 days; if fewer than 3 such videos use 1.0 and mark `tailFactorAssumed`.
- Simulate week by week up to `toleranceMonths` + 6 months: videos per week = cadence; compute rolling-365-day watch hours (views × avg view duration, with the tail factor) and subscribers (views × subs per 1,000 views). Report for each scenario the **first week** both conditions hold, or `null` if not reached within the horizon, plus the date, and `beyondTolerance: boolean`.
- Output also `assumptions: string[]` (Vietnamese) listing every assumption used (independence, constant cadence, tail factor, AVD, subs rate) and a bold caveat "Dự báo từ ít video có sai số rất lớn".

3.6 **Metric registry**: every number the engine outputs gets a stable id (`median_first28_last10`, `max_first28`, `hit_rate_first_low/high`, `required_views_hours`, `forecast_central_week`, …) in a `metrics: Record<id, { value, unit, label, assumed?: boolean }>` map so Task 118 can cite them.

3.7 **Stage** (A–E) from one named constants table, evaluated on mature plan videos and channel figures: A = fewer than 10 mature videos; B = default; C = at least one video ≥ `strong` AND median of last 10 ≥ 300 AND subscribers ≥ 200 AND 365-day public watch hours ≥ 500; D = median of last 10 ≥ 700 AND subscribers ≥ 500 AND hours ≥ 3,000; E = subscribers and hours both at or above the current-date threshold from the dated table ("đủ số liệu theo mốc tham khảo"; never "được duyệt"). Subscriber count comes from the channel statistics already stored; hours from the stored 365-day analytics (public long-form only; state what is included).

3.8 **Checkpoints** (dates from `nicheStartDate` and cadence, and from video maturity): A-review at 10 mature videos; **warning checkpoint** at `warnAtMatureVideos`; **decision checkpoint** at `decideAtMatureVideos` and `decideMinMonths` both satisfied; **hard review** at `hardReviewWeek` weeks since niche start. Each checkpoint has `status: 'upcoming'|'reached'|'passed'`, an estimated date (from cadence and the 31-day maturity lag) and what it will evaluate.

3.9 **Verdict** (one of `insufficient_data | continue | change_one_variable | consider_stop`), with `reasons[]` (each `{ text, metricIds[] }`), `unknowns[]`, `confidence: 'low'|'medium'|'high'` (low when mature < 15 or CTR unknown for most videos; medium 15–39; high only ≥ 40 mature and forecast available) and `nextCheckpoint`. Rules, all thresholds from named constants and the plan config:
- `insufficient_data`: fewer than 10 mature videos, or `nicheStartDate` unset.
- At or after the warning checkpoint (≥ `warnAtMatureVideos`): `change_one_variable` when median of last 10 < 100 AND robust slope ≤ 0 AND max < `first` target; the reasons must name which **one** variable to change next, chosen deterministically from evidence: low early retention → `hook`; low CTR known (< 2% with ≥ 1,000 impressions on most videos; label the 2% as a heuristic, not a YouTube benchmark) → `thumbnail`/`title`; views concentrated in one traffic source → `topic`; otherwise `topic` subgroup. If experiments are logged, say which variables were already tried (the verdict must not recommend a variable changed in the last 5 videos without saying so).
- At the decision checkpoint (mature ≥ `decideAtMatureVideos` AND months ≥ `decideMinMonths`): `consider_stop` only when ALL hold: the optimistic forecast is `null` or beyond tolerance; fewer than 2 mature videos reached the `first` target (or the hit-rate upper bound is below 5%); `experiments.length ≥ minExperimentsBeforeStop` (otherwise verdict is `change_one_variable` with the reason "chưa thử đủ thay đổi trước khi dừng"). Otherwise `continue`/`change_one_variable` as above. `consider_stop` is phrased as "Cân nhắc dừng ngách theo tiêu chí đã đặt" with the reasons and the unknowns (CTR unknown, small sample); it never claims certainty and it distinguishes "ngách có vấn đề" from "cách làm có vấn đề" using the available signals (retention, CTR when known, traffic mix) or states that it cannot.
- After the hard review week: always attach the forecast review text even if the verdict is `continue`.
- Otherwise `continue`.
- Provide `submittedForReview` handling: if `submittedForReviewAt` is set, show it separately and do not alter the verdict.

3.11 Tests: every function with hand-built fixtures — Wilson interval values, rule of three, k = 0 and k = n edge cases, n < 10, required-views arithmetic against hand-calculated cases (3 and 4 videos/week, 3 and 4 minutes: about 770/1,030 and 580/770 views for 8,000 hours), forecast monotonicity, forecast with flat/declining slope, clamp, tail factor fallback, scenario ordering (optimistic ≤ central ≤ pessimistic weeks), stage boundaries, each verdict path including the "experiments missing" guard, private/short/excluded videos never counted, videos younger than 31 days pending, the 28–45-day lifetime fallback flagged, determinism (same input → same output).

## 4. Routes and contracts

- `GET /api/youtube/channels/:channelId/plan-status` → `{ plan, eligibleVideoCount, matureCount, pending: [...], distribution, hitRates, requiredViews, forecast, stage, checkpoints, verdict, metrics, assumptions, thresholds (dated table), submittedForReviewAt }`. Computed on request from stored data (no Google call).
- Plan/experiment/manual-reach/plan-exclusion routes from sections 1–2. Strict Zod schemas in contracts; no token or credential fields anywhere; Vietnamese error messages with stable codes.
- Extend `/channels-overview` (Task 116) rows with `stage` and `verdict` (compact) so the hub cards can show them.
- Tests (fake Google fetch, temp DB): snapshot capture only for mature public videos, never overwritten, fallback flagged on API failure; manual-reach validation; exclusion toggle; plan CRUD validation and defaults; plan-status for: no plan, plan without niche date, 5 videos, 12 videos, 20 videos, 45 videos with and without logged experiments; hub rows carry stage/verdict.

## 5. Client (`features/youtube`)

On the per-channel analytics page add a top section **"Kế hoạch & mục tiêu"** (new component files, CSS Module, existing tokens):
- **Plan settings** (collapsible form): ngày bắt đầu ngách, nhịp đăng (video/tuần), mốc view (500/1.000), giới hạn chịu đựng (tháng), điểm kiểm tra; save with the existing toast pattern; show the Vietnamese label next to every "giả định".
- **Stage ladder A–E** with the current stage highlighted and, for the next stage, the unmet conditions with numbers.
- **Progress** toward eligibility: subscribers and 365-day public watch hours against the dated reference thresholds (both "hiện tại" and "từ 01/02/2027" columns), labelled "mốc tham khảo, kiểm tra lại trên YouTube Studio"; a separate line "Ngày dự kiến đạt đủ số liệu" (forecast, three scenarios as a range) distinct from "Đã nộp xét duyệt" (manual date). Never show a revenue figure.
- **Mốc view**: table of the plan videos with first-28-day views, an indicator against 500/1,000, pending videos with the date each becomes measurable, hit-rate estimates with the interval text ("Cần khoảng a–b video nữa để có 1 video đạt mốc", or the insufficient-data message), required views per video vs current median/p75 and which condition binds.
- **Kết luận hiện tại**: verdict badge, confidence, reasons (each linking to the metric it cites), unknowns, next checkpoint with date, and an "assumptions" disclosure. Use neutral/warning styles from existing tokens; `consider_stop` uses the warning style and the exact cautious wording above.
- **Checkpoints timeline** (list with upcoming/reached/passed) and the **experiment log** (add/delete entries: date, variable, note, optional videos).
- Video drawer additions: first-28-day snapshot values, manual reach inputs (impressions, CTR; clear message about the 1,000-impression minimum), "Loại khỏi kế hoạch" toggle.
- Hub (`ChannelsOverviewPage`) cards: small stage chip and verdict badge from the extended overview.
- Empty/loading/error states for every block; the whole section must handle `insufficient_data` gracefully (it is the expected state for Hung's channel right now: 2 new videos).
- Pure helpers with no-DOM tests: number/date formatting (`vi-VN`), interval text, verdict/stage label mapping, progress-bar math, checkpoint status text, form validation matching the contract.

## 6. Docs and Status

Update `src/server/modules/youtube/MODULE.md` (snapshots, plan, engine rules and constants, assumptions, what is and is not known), the client feature doc if any, and add the AGENTS.md Status line in each commit that changes behavior.

## Out of scope

Any AI call or Claude CLI use (Task 118), automatic CTR/impressions via the Reporting API (Task 119), comparing against other channels, revenue estimates, Shorts monetisation planning beyond showing the reference thresholds, sending notifications, and changing the Task 112/116 pages beyond what is listed.

## Verification (run and report real output)

`npm run typecheck`, `npm run lint`, new and touched vitest files plus `src/server/modules/youtube`, `src/client/features/youtube`, `src/contracts`, and `npm run build` (reuse the local Mongo workaround if needed and say so). Note from Task 116: the dev preview once picked the configured database instead of the demo database because `.env` loading overrode the preview configuration — **do not repeat that**: before starting any preview, verify which database name the API will use and refuse to seed or write unless it is the isolated demo database; never write demo data into the configured database. Extend the dev seed script (demo database only) with a channel at 2, 12, 20 and 45 mature videos to exercise each verdict path, and check the page at 1920×1080, 1366×768 and 900 px; describe what you saw, or say plainly what you could not capture and give Hung manual steps (restart server + worker + Vite, open Phân Tích Kênh → a channel → "Kế hoạch & mục tiêu", set the niche start date to 20/10/2026 and cadence 3.5, confirm it shows the insufficient-data state for the 2 current videos and that the old private videos are ignored).

## Report

Write `docs/superpowers/tasks/task-117-report.md` (untracked): commits, files changed, what you verified in the YouTube API documentation (per-video date-range queries, latency, traffic-source dimension) and what failed or degraded, the constants table (every threshold with its origin: official vs heuristic), the verdict rule table as implemented, forecast method and its known weaknesses, tests, verification output, what you could not verify, deviations. Do not push.
