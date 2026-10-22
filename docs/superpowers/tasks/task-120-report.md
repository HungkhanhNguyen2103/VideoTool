# Task 120 — Video ideas by channel

Date: 2026-10-22

## Commits

1. `d1c0ec4 feat(youtube): video idea packet, storage and routes`
2. `456e8d7 feat(youtube): Claude CLI video idea job with validation` (amended before push to include independent-review fixes and the matching `AGENTS.md` status)
3. `9056fa6 feat(youtube): video ideas panel and project hand-off`

All work was done on `main`. Nothing was pushed. This report and the task plan are intentionally untracked.

## What changed

- Added channel-scoped idea and run records, strict contracts, status/manual-demand routes, retention limits, current-coverage fingerprints, and safe project hand-off.
- Added the two-stage generation/critique pipeline with Claude CLI by default and API as an option. The CLI has no web or file tools. Prompts label packet, candidate, and repair text as untrusted data.
- Added evidence-tier messaging, 5–8 sentence briefs, one `testVariable` enum, deterministic duplicate, duration, number, promise, demand, rarity, tier, preset, and motif checks, one repair per stage, and the minimum-survivor failure.
- Added per-channel concurrent-job uniqueness, progress heartbeats, cancellation, rollback for partial/cancelled persistence, and caps of 200 ideas and 200 run summaries per channel.
- Added the channel analytics panel with stale/running/failed/unavailable states, cards, manual demand notes, status changes, research-request copy, confirmed experiment logging, and hand-off to New Project. The project form stays empty in `referencesText`; creating a project marks the idea used only after the project exists.
- Sanitized metric labels/units and experiment text before packet construction. No prompts, raw provider output, credentials, or evidence packet are stored in run documents.

## Evidence tiers and product constants

| Rule | Value | Origin |
|---|---:|---|
| `no-performance-data` | 0–2 mature plan videos | Product honesty rule for the current channel state |
| `weak-signal` | 3–9 mature plan videos | Product label; only own-video ranking hints are included |
| `data-informed` | 10+ mature plan videos | Shared `NEXT_VIDEO_IDEAS_MIN_MATURE` from Task 118 |
| Candidate buffer | requested count + 4 | Product diversity heuristic for critique rejections |
| Requested ideas | 4–8, default 6 | UI and contract bounds |
| Target duration | latest channel project or 600 sec | User spec / safe default |
| Minimum survivors | `max(2, ceil(count / 2))` | Product safeguard against a thin list |
| Hubris-trap fit | all 4 links; at least 2 non-thin | User preset requirement |
| Brief | 5–8 sentences | User spec |
| Repair | at most 1 per stage | Bounded provider-call rule |
| Heartbeat | 30 sec, at most 20 per provider step | Task 115 bounded-job pattern |
| Idea retention | 200 per channel | Product limit; oldest rejected then oldest new rows are pruned, chosen/used are protected |
| Run retention | 200 per channel | Product limit; oldest summaries are pruned |

Only the 10+ tier includes Task 117 metrics, top/bottom performers, search terms, traffic mix, verdict, and active experiment. The 3–9 tier includes own-video rankings with a small-sample warning. Below 3, generation uses the channel profile, saved coverage, and craft rules only.

## Prompts and validation

Prompt versions: `video-ideas-v1-generate` and `video-ideas-v1-critique`. The first call requests `count + 4` candidates; the second critiques by ID and selects the requested count. Each may use one repair call for malformed or invalid rows. The prompt says recalled historical material is unverified, must be listed in `unverifiedFacts`, must not be presented as sourced, and must be checked by the separate research step. It forbids demand/popularity/rareness claims and predicted views/revenue, hindsight framing, invented numbers/names/dates/quotes, and force-fitting hubris-trap.

| Check | Implementation | Limits |
|---|---|---|
| Strict idea shape | Zod schema, including exact test-variable enum and 5–8 sentence brief | Sentence splitting uses punctuation and whitespace; abbreviations may count as extra sentences |
| Evidence tier and preset | Must equal packet values | Does not establish that a historical interpretation is true |
| Duplicate title | Shared diacritic-insensitive title helper against coverage and saved ideas | Similarity may reject a legitimate related title or miss a novel rewrite |
| Channel rationale numbers | Digits must occur in the packet | A matching number does not prove its interpretation |
| Narrative numbers | Digits must occur in packet or `unverifiedFacts` | Token matching is heuristic; spelled-out numbers are not detected, and packet digits may support an unrelated statement |
| Promise and demand claims | Fixed normalized Vietnamese/English phrase lists | Unfamiliar phrasing can slip through; broad phrases may produce false positives |
| Rarity claim | Fixed phrase list in title/brief; `rarityGuess` is separate | Novel rarity language can slip through |
| Requested duration | Suggested duration cannot exceed the target | A shorter duration may still be impractical for a specific subject |
| Hubris-trap motif | All four links and at least two `strong`/`partial` links | The model can overstate links; `thin` links need research |
| Survivor floor | Fail with `YOUTUBE_IDEAS_UNGROUNDED` below the configured minimum | May return no ideas for a difficult niche or restrictive steering |

The live run below exposed that the model can leave non-numeric historical claims out of `unverifiedFacts`. A number guard was added afterward and verified in tests, but no validator can exhaustively identify every factual assertion in natural language. The UI labels the listed facts as “Từ trí nhớ của AI, chưa có nguồn”; users must source-check the idea before scripting.

## Storage, job, and hand-off

| Step | Behavior | Real-run evidence |
|---|---|---|
| Enqueue | `video-ideas`, `maxAttempts: 1`; CLI availability/model checked first; unique partial Mongo index allows one queued/running job per channel | Concurrent route test returns one 202 and one 409 with the active job ID |
| `Sinh ý tưởng` | Generate `count + 4`; one schema repair allowed | Two calls: 174.684s and 155.318s |
| `Phản biện và chọn lọc` | Critique by candidate ID; one repair allowed | Two calls: 83.872s and 43.725s |
| Persist | Write the summary and complete idea set only after the survivor floor; rollback partial insert errors or cancellation during writes | 6 ideas saved together; repository tests cover write failure and cancellation rollback |
| Hand-off | Prefill title, brief, preset, duration, chapter count, and channel; references stay empty with research reminder; then mark `used` after project creation | API and project-form tests cover prefill and used status |
| Optional experiment | User confirms before logging `{variable, note, videoIds: []}` | Panel invalidates plan/status queries after success |

Run documents retain tier, backend/model, prompt version, time, request count, coverage counts/fingerprint, dropped reasons, and durations. They omit serialized packet, prompt, raw provider output, historical narration, and credentials. Cancellation during persistence rolls back the run and ideas; a cancellation arriving after the complete result is committed cannot label the job cancelled.

## Synthetic seed and real Claude CLI run

The configured database name was `video_tool`. The synthetic seed used the isolated local database `youtube_demo_task120_20261022` and localhost only; it did not use the configured database. The seed included 2-video and 12-video channels (also 20 and 45 for tier checks). The real run targeted only `youtube-demo-growth-2-20261022`, verified `matureCount=2`, and produced `no-performance-data`. Request: `lịch sử Việt Nam, ít người biết, hubris-trap`; backend `cli`; model `claude-opus-4-5`; requested count 6; target 600 seconds.

The call-level logs (prompt byte counts from the CLI runner; step byte counts from the job logger) were:

```text
[log] Bắt đầu gợi ý bằng Claude CLI; Claude CLI không có web hoặc tệp, sự kiện lịch sử đều cần kiểm chứng; gói 818 ký tự.
[log] Bước 1/2 — Sinh ý tưởng: gửi yêu cầu (4012 byte).
[log] Claude CLI Ý tưởng video tiếp theo call 1: video-ideas-generate; prompt 4087 bytes; 174684 ms; audit folder data/files/.verification/task-120/idea-cli-audit/youtube-ideas-youtube-demo-growth-2-20261022/cli-runs/01M5HEA1K48R8JR30YJN3TN83J.
[log] Bước 1/2 — Sinh ý tưởng: nhận phản hồi sau 174 giây (21275 byte).
[log] Sinh ý tưởng: có 10 mục chưa đúng schema; thử một lần sửa.
[log] Bước 1/2 — Sinh ý tưởng: gửi yêu cầu (48239 byte).
[log] Claude CLI Ý tưởng video tiếp theo call 2: video-ideas-generate-repair; prompt 48314 bytes; 155318 ms; audit folder data/files/.verification/task-120/idea-cli-audit/youtube-ideas-youtube-demo-growth-2-20261022/cli-runs/01M5HEFC9AZ84WRV29P3RK6A4H.
[log] Bước 1/2 — Sinh ý tưởng: nhận phản hồi sau 155 giây (12901 byte).
[progress] 45% {"step":"Phản biện và chọn lọc"}
[log] Bước 2/2 — Phản biện và chọn lọc: gửi yêu cầu (17133 byte).
[log] Claude CLI Ý tưởng video tiếp theo call 3: video-ideas-critique; prompt 17208 bytes; 83872 ms; audit folder data/files/.verification/task-120/idea-cli-audit/youtube-ideas-youtube-demo-growth-2-20261022/cli-runs/01M5HEM424EX3EKEM7W2ZRNG8B.
[log] Bước 2/2 — Phản biện và chọn lọc: nhận phản hồi sau 83 giây (1003 byte).
[log] Phản biện: có 1 mục chưa đúng schema; thử một lần sửa.
[log] Bước 2/2 — Phản biện và chọn lọc: gửi yêu cầu (19048 byte).
[log] Claude CLI Ý tưởng video tiếp theo call 4: video-ideas-critique-repair; prompt 19123 bytes; 43725 ms; audit folder data/files/.verification/task-120/idea-cli-audit/youtube-ideas-youtube-demo-growth-2-20261022/cli-runs/01M5HEPP169DFHV46VN62SSQ0C.
[log] Bước 2/2 — Phản biện và chọn lọc: nhận phản hồi sau 43 giây (546 byte).
[log] Đã chọn 6/6 ý tưởng; bỏ 4 mục.
[progress] 95% {"step":"Đã hoàn tất chọn lọc","accepted":6,"dropped":4}
[log] Đã lưu 6 ý tưởng và tóm tắt lượt chạy; không lưu prompt, gói coverage, token hoặc nội dung phản hồi thô.
```

Pipeline duration was `generateMs=330207`, `critiqueMs=127728`, `totalMs=457939` (7m37.939s). The four CLI calls took 457.599s in total. Run ID: `01M5HER0SP1YN90F4N70WYKQP0`.

Final titles and motif evidence:

| Title | hunter | perfectPlan | blindSpot | selfDestruction |
|---|---|---|---|---|
| Lê Chiêu Thống: Ông vua cõng rắn cắn gà nhà | partial | partial | thin | partial |
| Trịnh Tùng: Quyền thần giết vua, mở ra 200 năm hỗn loạn | partial | partial | thin | thin |
| Phan Thanh Giản: Bi kịch người trung thần ký hiệp ước nhượng đất | partial | partial | thin | partial |
| Mạc Đăng Dung: Từ ngư phủ lên ngôi vua, rồi mất tất cả | partial | partial | thin | partial |
| Trần Ích Tắc: Hoàng tử bán nước, kết cục nào chờ đợi? | partial | partial | thin | partial |
| Hồ Quý Ly: Nhà cải cách thiên tài tự đào mồ chôn triều đại | partial | partial | thin | partial |

Dropped candidates:

- `idea-007`, `idea-008`: did not have at least two non-thin motif links.
- `idea-009`, `idea-010`: used forbidden “đảm bảo” promise language and did not have enough non-thin motif links.

The ideas were specific by person and proposed decision arcs, but the recurring hubris-trap framing was formulaic. All six had a `thin` blind-spot link. Some concrete claims were missing from `unverifiedFacts`; examples visible in the saved briefs include the five-day Ngọc Hồi–Đống Đa claim, “200 years” for the Lê/Trịnh system, and 1527 for Mạc Đăng Dung. The run was performed before the final narrative-number guard; these numbers were not in the packet or `unverifiedFacts` and would now be rejected. I did not verify whether these claims are false. Without sources, I can only report that they were unverified claims that slipped through unflagged. Non-numeric historical assertions can still slip through and require human source checking.

## Shared Task 118/117 infrastructure

- Reuses `NEXT_VIDEO_IDEAS_MIN_MATURE` for the shared ten-mature-video gate.
- Reuses `normalizeSeoTitleForComparison` / `findDuplicateTitle` for title normalization and similarity.
- Reuses `sanitizeReviewText` for prompt-safe text filtering, with idea-specific email/token/path sanitization.
- Uses Task 117 `getYoutubeGrowthPlanStatus` and metric IDs for data-informed ideas, plus the existing Claude CLI runner, job progress hooks, and project creation form.

## Verification and limits

```text
npx vitest run src/server/modules/youtube src/server/shared/claude-cli src/client/features/youtube src/client/features/project src/contracts src/server/modules/job --pool=threads --maxWorkers=1 --reporter=dot
Test Files  70 passed (70)
Tests       367 passed (367)

npm run typecheck   passed
npm run lint        passed
npm run build       passed
```

Mongo-backed tests used the installed MongoDB 8.0.6 binary (`MONGOMS_SYSTEM_BINARY=C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe`, `MONGOMS_VERSION=8.0.6`). The build retains the existing Vite warning for the 962.66 kB client JavaScript chunk.

UI screenshots and live viewport checks at 1920×1080, 1366×768, and 900px were not captured because Hung needed computer access. Component and pure-helper tests cover the client behavior; visual acceptance remains unverified. No live Google Analytics, API-provider, or YouTube write was used.
