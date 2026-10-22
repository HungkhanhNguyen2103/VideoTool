# Task 117 — Channel growth plan and verdict engine

## Commits

- `707512c` — `feat(youtube): first-28-day snapshots and manual reach inputs`
- `ad10b86` — `feat(youtube): growth plan, forecast and verdict engine`
- `01af57e` — `feat(youtube): growth plan panel and verdict UI`

No commits were pushed. This report and the short implementation plan are intentionally untracked.

## What changed

1. Each eligible public long-form video can retain an immutable first-28-day Analytics snapshot. The sync report records the first query result, including unavailable/error status; a guarded update never replaces a saved snapshot. The channel and video traffic-source reports store views and estimated watch minutes for last 28 days and lifetime. Studio impressions and CTR can be entered manually, and a video can be excluded from the growth cohort without changing its YouTube metadata.
2. Growth-plan configuration and up to 100 dated experiments are stored per channel profile. The pure engine filters plan videos by public status, long-form type, removal state, niche start date, and manual exclusion. It calculates distribution statistics, a last-10 median, Wilson hit-rate intervals, a 3/n no-hit bound, required views, stages, checkpoints, forecast scenarios, confidence, unknowns, and a deterministic verdict. Values are addressable through stable metric IDs. Reads make no AI or Google request.
3. The analytics page now contains the responsive Vietnamese “Kế hoạch & mục tiêu” panel, editable plan settings, stage ladder, YPP progress columns, date forecast and manual YPP-submission marker, first-28-day milestone table, reasons linked to metrics, assumptions, checkpoints, and experiment controls. The video drawer exposes snapshots, manual Reach and exclusion controls. Channel overview cards display stage and verdict badges. The demo seed adds cohorts with 2, 12, 20, and 45 mature videos.

Changed areas in commit 3: `AGENTS.md`, `scripts/seed-youtube-analytics-demo.ts`, and the YouTube client API/hooks, analytics and overview pages, styles, view helpers, and their focused tests. No client feature module document existed to update; server behavior and assumptions are documented in `src/server/modules/youtube/MODULE.md`.

## YouTube documentation checked (2026-10-22)

- [Analytics API `reports.query`](https://developers.google.com/youtube/analytics/reference/reports/query) requires `startDate` and `endDate` as `YYYY-MM-DD` values and supports filters for a specific video. The query schema therefore supports `startDate = publish date`, `endDate = publish date + 27 days`, and `filters=video==VIDEO_ID`. The API description says results end at the last day for which every requested metric is processed; it does not require the start date to be after publication.
- [Analytics API data model](https://developers.google.com/youtube/analytics/data_model) was updated with a typical 48–72 hour processing delay and end-date truncation to the last fully processed day. The named 31-day maturity age is the 28-day window plus three days of latency allowance. This is a conservative application rule, not an API guarantee that every metric is ready at day 31.
- [Channel traffic-source report](https://developers.google.com/youtube/analytics/channel_reports) supports the `insightTrafficSourceType` dimension with `views` and `estimatedMinutesWatched`, including an optional video filter for the video report. Traffic-source detail reports have additional unsupported-source and query-shape constraints. The application treats 400/403 for a traffic group as unavailable and keeps the mix contextual; it is not a verdict pass/fail condition.
- [Current YPP overview](https://support.google.com/youtube/answer/72851) lists 1,000 subscribers plus 4,000 qualified public watch hours in 12 months or 10 million qualified Shorts views in 90 days. Qualified hours from public long-form videos count; private, unlisted, deleted videos and Shorts do not, and Shorts-feed viewing time does not count toward long-form hours.
- [YPP changes effective 2027-02-01](https://support.google.com/youtube/answer/12843009) list 1,000 subscribers plus 8,000 qualified watch hours in 365 days or 20 million Shorts views in 90 days for new creators. The 500-subscriber / 3,000-hour / 3-million-Shorts tier concerns earlier fan funding, Creator Partnerships, and Shopping eligibility, not ad-revenue eligibility. All displayed thresholds are dated references and direct users back to YouTube Studio.

The API documentation verifies valid request parameters and reported latency, but no live OAuth or Analytics API call was made during this task.

## Constants and origins

| Constant or rule | Value | Origin / interpretation |
| --- | ---: | --- |
| Current full YPP ad/Premium route | 1,000 subscribers and 4,000 public watch hours / 365 days, or 10M qualified Shorts views / 90 days | Official YouTube Help, checked 2026-10-22 |
| Full YPP route from 2027-02-01 | 1,000 subscribers and 8,000 public watch hours / 365 days, or 20M qualified Shorts views / 90 days | Official YouTube Help, checked 2026-10-22 |
| Early-access tier | 500 subscribers and 3,000 public watch hours / 365 days, or 3M Shorts views / 90 days | Official YouTube Help; fan funding/partnerships/shopping, not ad revenue |
| Qualified hours | Public long-form only; Shorts-feed time excluded | Official YouTube Help |
| Analytics processing delay | Typically 48–72 hours | Official Analytics API data-model documentation |
| Snapshot maturity age | 31 days | Product rule: first 28 days plus a 3-day allowance for the documented latency |
| Lifetime fallback window | 28–45 days of video age | User specification; fallback is labeled approximate and never used outside this age range |
| Manual CTR eligibility | At least 1,000 impressions | User specification; app rule, not a YouTube benchmark |
| Plan defaults | Cadence 3.5/week (0.5–14); first/strong views 500/1,000; assumed average view duration 4 minutes (0.1–720); tolerance 18 months (1–60); warn/decision at 15/40 mature videos; minimum decision age 4 months; hard review week 26; 2 experiments before stop; max 100 experiments; note max 300 chars; max 500 video IDs per experiment | Defaults explicitly labeled “gợi ý của người dùng/Claude, chưa kiểm chứng”; bounds are contract validation limits |
| Wilson interval and no-hit estimate | z = 1.96 (95% interval); zero hits use 3/n; no-hit wording is marked meaningless below n = 10 | Standard statistical method plus user-requested small-sample rule; not a YouTube benchmark |
| Expected videos-to-hit cap | 1,000 videos | Defensive display cap, application heuristic |
| Mature-video forecast sample | Latest 20 mature videos for slopes; 80th/20th pairwise Theil–Sen slope percentiles for optimistic/pessimistic scenarios | Application heuristics; not validated against channel populations |
| Projected views cap and tail factor | P75 × 10; tail factor estimated only after 3 videos older than 90 days, otherwise assumed 1 | Application heuristics; tail uses annual/lifetime views divided by first-28-day views |
| Forecast mechanics | 52 weeks/year, 7 days/week, 52/12 weeks/month; forecast horizon tolerance + 6 months | Calendar approximations and a buffer chosen for this engine |
| Stop signal | Fewer than 2 first-target hits, or Wilson upper bound below 5%; no more than 2 hits is the configured first-target hit ceiling | Application heuristic, combined with configured decision age/maturity and optimistic forecast condition |
| Confidence thresholds | Low at 14 or fewer mature videos or when CTR is unknown for most; high at 40+ mature videos only if forecast is ready; otherwise medium | Application heuristic |
| Change-one-variable signals | Early-retention-drop fraction ≥ 0.5; CTR median < 2% only when manual CTR covers > half of mature videos and each has ≥ 1,000 impressions; dominant source ≥ 0.7 share | Application heuristics, not official performance standards or causal evidence |
| Warning signal | At configured warning count, last-10 median < 100 views, Theil–Sen slope ≤ 0, and maximum below the first target | Application heuristic; all conditions must hold |
| Stage C | At least one strong-target hit, last-10 median ≥ 300, 200 subscribers, 500 public long-form hours | Application stage heuristic |
| Stage D | Last-10 median ≥ 700, 500 subscribers, 3,000 public long-form hours | Application stage heuristic |
| Stage E | 1,000 subscribers and the applicable public long-form watch-hour target | Eligibility progress stage; Shorts routes are shown as references but are outside the growth engine |
| Stage A/B split | Fewer than 10 mature videos is A; B begins at 10 until a higher stage qualifies | Application stage heuristic |
| Threshold transition date | 2027-02-01 | Official YouTube Help, checked 2026-10-22 |

The engine’s numeric heuristic source is `YOUTUBE_GROWTH_PLAN_HEURISTICS` in `growth-plan.ts`; editable defaults and the manual CTR minimum live in `youtube-plan.ts`. Stage C/D and warning/CTR/source thresholds are product heuristics, not externally validated benchmarks.

## Verdict and stage rules implemented

Verdict branches are evaluated in this order:

| Verdict | Rule |
| --- | --- |
| `insufficient_data` | Fewer than 10 measured/approximate mature plan videos, or no niche start date. No stop recommendation is made. |
| `change_one_variable` before a stop review | At or beyond both configured decision maturity and minimum elapsed months; the optimistic scenario is missing, does not hit eligibility, or is beyond tolerance; first-target signal is weak; and fewer than the configured minimum experiments are logged. |
| `consider_stop` | Same decision checkpoint, forecast, and weak-hit conditions as above, with the configured minimum number of experiments logged. The text explicitly says current evidence does not prove that the niche lacks demand, and distinguishes a possible execution issue from an unknown niche fit. |
| `change_one_variable` warning | At/above configured warning maturity, last-10 median below 100, Theil–Sen trend non-positive, and the best video remains below the first view target. The recommendation prefers hook for broad early-retention drops, thumbnail for sufficiently covered low CTR, topic for a dominant traffic source, otherwise topic by default. |
| `continue` | All other cases; continue to the next configured checkpoint and reassess. |

Stage A requires fewer than 10 mature videos. Stage C requires a strong-target hit plus the C view/subscriber/watch-hour heuristics. D requires its higher median/subscriber/watch-hour values. E requires 1,000 subscribers and the effective public-long-form hour threshold. For each next stage, the API returns the unmet numeric conditions. Stages C and D are progress heuristics, not YouTube eligibility tiers.

Hit-rate intervals use the standard Wilson score interval with z=1.96. With no hits, the engine shows only the 3/n upper bound and the requested “chưa có video nào đạt mốc; ước lượng chưa có ý nghĩa” message for fewer than 10 samples. With one or more hits, it converts the interval to reciprocal videos-to-hit bounds and caps the displayed values at 1,000. The assumptions list states that the sample treats videos as independent, which may not hold for a channel with changing packaging or distribution.

## Forecast method and weaknesses

The engine returns `insufficient-data` until it has at least 10 mature videos, daily Analytics, a subscriber count, a measured subscriber gain per 1,000 first-28-day views, and complete public-video watch-time data for the current 365-day window. It computes all pairwise slopes over up to the latest 20 mature first-28-day view counts and uses their 20th percentile, median, and 80th percentile for the three scenarios. Starting from the latest 10-video median, each projected upload adds the scenario slope; projected views are clamped at zero and P75 × 10, then multiplied by the historical tail factor when enough old videos exist. Cadence determines arrivals. Watch minutes use measured average duration when present, otherwise the plan assumption; subscriber gains use the measured first-28-day conversion rate. The current 365-day watch-hour total decays linearly as older activity exits the window, while each projected upload’s contribution ramps linearly during its first year. The simulation stops when both the current dated subscriber/hour path is met, or after tolerance plus six months.

This is a planning scenario, not a calibrated predictive model. It assumes recent video-level slopes continue, treats uploads as independent, approximates view tails and the 365-day rolling window, uses one average conversion rate and average view duration, and does not model seasonality, topic shifts, distribution changes, policy review, or future Shorts performance. The Theil–Sen percentiles are scenario bounds, not confidence intervals. A daily series is a readiness gate but does not drive the per-video slope. If the 2027 threshold date falls inside a scenario, the hour requirement changes at that date. The engine never estimates revenue.

## Verification

- `MONGOMS_SYSTEM_BINARY='C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe' npx vitest run src/server/modules/youtube src/client/features/youtube src/contracts` — **45 files passed, 214 tests passed**. MongoDB-backed tests used the installed MongoDB 8.0 system binary. Vitest reported that reusing workers with `isolate: false` could be ~956 ms faster; this is informational.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed. Vite retained the existing informational warning that the main JS chunk is above 500 kB (917.72 kB minified in this build).
- The updated seed completed against `mongodb://127.0.0.1:27017`, database `youtube_demo_task117_20261022`, guarded by localhost and the `youtube_demo_` prefix. Direct read-only verification found four seeded growth-cohort channel documents. No OAuth token or real channel record was seeded.
- No Google OAuth/Analytics call, AI call, configured-database write, or mutating API request was made.

### Visual acceptance status

Visual acceptance at 1920×1080, 1366×768, and 900 px is **unverified**. The default application database name from `.env` was `video_tool`; preview variables were explicitly set to `youtube_demo_task117_20261022`. However, the API request at port 3000 returned local channel records that did not match the isolated seed, so I stopped the API and Vite preview after GET-only requests. The cause of the mismatch was not established, and I did not proceed with page interaction. Standalone headless Chrome exited with `-2147483645`; Edge exited with `-1073741819` and reported Windows app-bound encryption access errors. No screenshot was captured. The isolated MongoDB process and preview servers are stopped.

Manual check after restarting server, worker, and Vite: open **Phân Tích Kênh**, choose the history channel, open **Kế hoạch & mục tiêu**, set niche start date to **20/10/2026** and cadence to **3.5**, then confirm it remains `insufficient_data` with the two current new-niche videos and ignores the old private videos. For layout, check 1920×1080, 1366×768, and a ~900 px browser width.

## Deviations and limitations

- No client feature module doc existed, so none was added; the server module doc and this task report cover the data and rules.
- API/worker/browser acceptance could not be completed safely after the port-3000 response failed to match the isolated demo DB. The seed itself completed and remains limited to the isolated demo target.
- Google Analytics group availability, real per-video first-28-day retrieval, and current live OAuth behavior remain unverified. Documentation and mocked/integration tests verify request construction and error handling only.
- This report and `docs/superpowers/plans/2026-10-22-task-117-growth-plan.md` remain untracked per the task instructions.
