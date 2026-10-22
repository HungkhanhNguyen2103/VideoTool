# Task 121 — “Ý tưởng video tiếp theo” quality upgrade

Date: 2026-10-22

## Commits

1. `ebc84c4 feat(youtube): trap-first staged idea pipeline and stricter validation`
2. `53d3b14 feat(youtube): idea cards show the trap sketch and quality signals`
3. `38738db fix(youtube): address Task 121 review findings`

Work was done directly on `main`, as requested. Nothing was pushed. This report, the plan, and eval artifacts are intentionally untracked.

## What changed

- Added v2 episode, trap, claim, stage-duration and prompt-version contracts while keeping v1 stored ideas and run summaries readable.
- Replaced generate-and-critique with seed → select → expand. Expansion batches contain at most four ideas; the service bounds repairs to one per stage, retains cancellation/heartbeat/full-result persistence, and deterministically trims by score and diversity.
- Added the trap sketch, trap/motif consistency, episode specificity, blind-spot, advantage-backfire, neutral-title, diversity, obscurity and claim-coverage checks. A deterministic normalizer handles safe mechanical output issues before repair.
- Made `claude-sonnet-5-5` the default for this panel/job only. The shared model default did not change.
- Updated idea cards with the trap sketch first, episode metadata and estimate labels, collapsible trap statements, confidence-labelled claims, stage duration and rejection reasons. Research requests now list low-confidence claims first.
- Added pure evaluation metrics and `npm run eval:youtube-ideas`. It requires an explicit localhost MongoDB URI and `youtube_demo_` database, checks that the isolated demo channel has two mature videos, records metrics/audit paths, and removes only the completed eval run's documents after recording them.

## Task 120 audit diagnosis

The Task 120 generate audit folder was `data/files/.verification/task-120/idea-cli-audit/youtube-ideas-youtube-demo-growth-2-20261022/cli-runs/`. Its log said that the initial ten rows were “not correct schema,” but inspection showed that the ten structured rows passed the draft shape. All ten instead failed the hubris-trap semantic floor: the four motif links were rated `thin`, so they did not demonstrate a trap. The repair prompt was therefore spending about 155 seconds repeating ideas that lacked the central evidence, rather than fixing malformed fields. The critique stage separately used its one repair; that event was not one of the ten generate rows.

Task 120's final six saved ideas all had `blindSpot: thin`, and the titles were person biographies with repeated moral framing. The saved briefs also contained unflagged concrete claims such as “5 days,” “200 years” and “1527.” These were unverified model assertions; this report does not claim whether any is true.

## Timing comparison

| Pipeline / run | Seeds or generate | Select or critique | Expand / repairs | Total | Saved ideas | Repair calls |
|---|---:|---:|---:|---:|---:|---|
| Task 120 baseline (Opus 4.5) | Generate 174.7s; repair 155.3s | Critique 83.9s; repair 43.7s | — | 457.939s | 6/6 | 1 generate + 1 critique |
| Task 121 Vietnamese run 1 (Sonnet 5.5) | 21.9s | 30.6s | 203.8s | 256.3s | 5/6 | seeds/select/expand 0/0/1 |
| Task 121 Vietnamese run 2 (Sonnet 5.5) | 52.6s | 29.2s | 142.4s | 224.2s | 3/6 | seeds/select/expand 0/0/1 |

Both measured Task 121 runs finished under the five-minute target and used four CLI calls each. Expansion and its repair remained the largest stage. Run 2 did not meet the expected four-idea survivor count, and neither run saved all six requested ideas. These runs predate the review fixes below; their titles, timing and logs remain historical evidence, but they are not a final evaluation of the corrected implementation.

## Quality metrics

| Metric | Task 120 baseline | Task 121 run 1 | Task 121 run 2 |
|---|---:|---:|---:|
| Ideas kept / dropped | 6 / 4 | 5 / 13 | 3 / 15 |
| `blindSpot` rated at least partial | 0/6 | 5/5 | 3/3 |
| Distinct hunter archetypes | Not measured; six person-led ideas | 5 | 2 |
| Distinct centuries parsed | Not measured | 1 | 0 |
| AI `famous` guesses | Field did not exist; the six outputs were familiar named figures from the original run | 0 | 0 |
| Claims / low-confidence claims | `unverifiedFacts`; coverage was incomplete | 27 / 9 (0.33) | 17 / 4 (0.24) |
| Unbacked numbers / names reported by evaluator | Several unflagged claims were present | 0 / 0* | 0 / 0* |
| Repairs (seeds / select / expand) | Generate 1, critique 1 | 0 / 0 / 1 | 0 / 0 / 1 |

*Pre-review evaluator output; the zero name counts and century counts are invalidated by the review findings below.*

The `blindSpot` values are the model's evidence ratings, not confirmation that the causal interpretation is historically accurate. The zero-unbacked counts are outputs of lexical validator/evaluator checks; they do not prove factual correctness. Review found that the old evaluator omitted single-word capitalized names at sentence starts, and the old century parser misread explicit numeric centuries as years. The reported zero name counts and distinct-century counts are therefore invalidated and must be recalculated after the CLI is available. The obscure-seed ordering fix may also change which candidates reach expansion. No minimum number of distinct centuries was an acceptance threshold.

Task 121 acceptance was mixed:

- Run 1 historically kept five ideas; run 2 kept three. Both were under five minutes and had zero saved `famous` guesses.
- Run 2 historically missed the four-idea survivor target and the three-archetype target.
- The old evaluator's name and century counts are not usable after the review findings. Rerun both steering cases on the corrected implementation before treating those quality metrics as acceptance evidence.
- No world-history evaluation was completed; it is not represented in these metrics.

## Code-review follow-up

The read-only review found six correctness defects, now fixed:

1. V2's 9–20 research claims no longer pass through the v1 schema's eight-item `unverifiedFacts` limit. V1 shape validation and the shared semantic safeguards are separate.
2. Selection accepts a fully classified shortlist of up to `count + 2`; when fewer seeds pass the trap test, the survivor floor decides whether the run can continue.
3. Numeric century labels are parsed before years (`thế kỷ 13`, `Late 13th century`); BCE/CE buckets remain separate for `BCE`, `B.C.`, `TCN`, and “trước Công nguyên”.
4. Under obscure steering, famous seeds are removed before diversity limits, obscure/unknown candidates precede known candidates, and the expansion buffer retains a known fallback slot when available.
5. Person/polity signatures join only adjacent capitalized words, so unrelated words later in the sentence cannot be joined into one signature.
6. Single-word capitalized names at sentence starts and standalone place fields are checked, while configured common sentence starters remain exempt.

Regression coverage includes a 9- and 20-claim full pipeline, a five-of-eighteen shortlist, over-limit selection repair, numeric and BCE century labels, sentence-start names/places, repeated named actors across prose, famous-seed ordering, and known fallback retention. At the time this first report was written, the corrected evaluator had not yet been run because the CLI session limit was active. Four post-fix runs completed later under Task 121b; see “Part B results” below.

## Real Vietnamese outputs and critical read

The two runs below used the isolated local database `youtube_demo_task121_eval_20261022` and channel `youtube-demo-growth-2-20261022` with two mature videos. Every title and sketch is unverified model output, shown as a research hypothesis only.

### Run 1 — 5 kept, 13 dropped; 256.3s

1. **Thành Vauban của triều Nguyễn: bức tường đứng yên trước đối thủ đi bằng đường nước**  
   Triều Nguyễn tin thành lũy kiểu Vauban sẽ giữ vững bờ cõi; nhưng đối phương đánh bằng pháo hạm và đường thủy, ngoài khung vây thành, và năng lực xây thành quy mô lớn lại gắn phòng thủ vào các điểm cố định.
2. **Đông du: khi hy vọng viện trợ Nhật Bản gặp tính toán ngoại giao**  
   Nhóm cải cách tin viện trợ nước ngoài qua Đông du sẽ cứu nước. Lợi ích ngoại giao của bên cho trú nằm ngoài khung đó; khi nó đổi thay, hỗ trợ không còn chắc chắn, và mạng lưới quốc tế thành chỗ phụ thuộc.
3. **Thống nhất bộ máy: khi cải cách tập quyền của triều Nguyễn chạm vùng xa**  
   Triều Nguyễn tin bộ máy tập quyền thống nhất sẽ làm vùng xa ổn định. Thực tế địa phương chưa khớp khung đó, bất mãn bộc lộ thành phản ứng ở vùng biên; thế mạnh tổ chức lại thành nguồn căng thẳng.
4. **Cố thủ Cao Bằng: nhà Mạc đặt cược vào địa thế và chỗ dựa phương Bắc**  
   Nhà Mạc tin địa thế Cao Bằng và sự bảo hộ phương Bắc là đủ. Sức ép từ đối thủ và ý muốn của bên bảo hộ nằm ngoài tính toán; đối thủ tiếp tục ép, thế mạnh ngoại giao thành sự phụ thuộc.
5. **Chia hai đường thủy bộ: quyết định của quân Tống khi tiến đánh Đại Cồ Việt**  
   Quân Tống tin quân đông và kinh nghiệm sẽ thắng nếu chia hai đường thủy bộ. Địa hình và cách đánh của Đại Cồ Việt nằm ngoài tính toán, lực lượng bị đánh riêng lẻ; thế mạnh thủy bộ thành điểm yếu phối hợp.

Critical read: the first idea has a visual mechanism but still lacks a named, bounded episode in the sketch; I would drop it before research unless a specific siege/action can be established. Đông du and the centralization idea describe broad policy arcs without a falsifiable decision or outcome; I would also hold/drop them before a project brief. The Cao Bằng idea leans on a broad “protection” relationship. The split-route idea is the most episode-shaped of this set, but its causal chain and dates still need sources. None is endorsed as history.

### Run 2 — 3 kept, 15 dropped; 224.2s

1. **Chi Lăng: quyết định tiến sâu của Liễu Thăng trước quân Lam Sơn**  
   Liễu Thăng tin viện binh mạnh cứ tiến sâu là áp đảo; biến số ngoài khung: địa hình hiểm ở Chi Lăng; Lam Sơn khai thác địa thế để phục kích; sở trường tiến quân quyết liệt quay lại thành bất lợi.
2. **Những lần đánh thẳng ra Thăng Long của Chế Bồng Nga**  
   Chế Bồng Nga tin đánh sâu ra Thăng Long giữ được thế chủ động; biến số ngoài khung: đường xa và nguy cơ lộ vị trí giữa trận; Đại Việt khai thác điều đó nên sở trường táo bạo thành điểm yếu.
3. **Người xoay các thế lực: ván cờ liên minh của Nguyễn Hữu Chỉnh ở Bắc Hà**  
   Chỉnh tin tài xoay liên minh sẽ giữ chỗ đứng ở Bắc Hà; biến số ngoài khung: các bên không chịu bị điều khiển mãi và nghi ngại người từng đổi phe; Tây Sơn đánh bại ông khi liên minh mong manh; sở trường mưu lược quay lại hại ông.

Critical read: Chi Lăng is compact, but its subject may not satisfy “ít người biết”; I would research whether this is differentiated enough before keeping it. The Chế Bồng Nga title is plural (“những lần”), so it remains too broad for an episode-level idea even though it survived the checks. The Nguyễn Hữu Chỉnh sketch has an understandable mechanism but risks reducing a complex political episode to a single personal trait. I would hold the first and third for sourcing and drop the second until it names one specific event. None is asserted as true.

## Heuristic rules and risks

All thresholds below are product heuristics from the Task 121 request, not historical truth checks.

| Rule | Threshold / behavior | Origin | False-positive / false-negative risk |
|---|---|---|---|
| Trap structure | Four short statements; non-thin blind spot; at least one non-thin `perfectPlan` or `selfDestruction`; hunter's own strength must backfire | Task 121 hubris-trap acceptance rule | A plausible-sounding but wrong causal chain may pass; subtle traps with sparse surviving evidence may be dropped |
| Neutral title | Moral-label list is disallowed as the main claim, except a quoted contemporary label with a claim flag | Task 121 examples and wording rule | New moral terms can slip through; a neutral title may still oversimplify |
| Episode shape | Needs an event/decision, a decision verb and a period | Task 121 “episode, not biography” rule | Short noun-led but valid events may be rejected; broad multi-event narratives may pass |
| Archetype/century diversity | No duplicate archetype + century pair; at most two per archetype; at most two normalized people/polities | Task 121 diversity caps | Name/period normalization can miss aliases or merge distinct actors; parsed centuries can undercount |
| Obscurity steering | Fixed phrase list; region avoid-list injected as data; drop `famous`; allow labelled `known` only when fewer than requested obscure ideas survive | Task 121; editable lists in `idea-quality.ts` | The model's familiarity guess can be wrong; obscure events can be incorrectly dropped or famous ones mislabeled |
| Claims coverage | Numbers, years, capitalized names and causal assertions in prose need a matching claim or packet support | Task 121 | Lexical matching misses paraphrases, spellings and transliterations; common names/capitalization can create false matches |
| Low-confidence share | Drop when more than half of claims are `low` | Task 121 | A single claim changes the ratio for short lists; confidence labels are model estimates |
| Output normalizer | Lowercase enums, drop unknown keys, wrap one object, and trim only `whyForThisChannel`, risks and claim text at word boundaries | Task 121 safe-normalization list | Trimming can remove useful nuance; malformed/unsafe fields still require repair |
| Survivor floor | Fail without saving below `max(2, ceil(count / 2))` | Existing Task 120 safeguard retained | Restrictive steering may produce too few usable suggestions even when some are valuable |

The editable Vietnamese-history avoid list is in `src/server/modules/youtube/idea-quality.ts`. The new eval script refuses a non-local or non-`youtube_demo_` target and also refuses the configured application database. Successful eval records are deleted after metrics are written, so each sample starts from the same seeded two-video coverage.

## Verification

Fresh commands and outputs after the review fixes:

```text
npx vitest run src/server/modules/youtube/idea-engine.test.ts src/server/modules/youtube/idea-quality.test.ts --pool=threads --maxWorkers=1 --reporter=dot
Test Files  2 passed (2)
Tests       35 passed (35)

npx vitest run src/server/modules/youtube src/contracts src/client/features/youtube --pool=threads --maxWorkers=1 --reporter=dot
Test Files  65 passed (65)
Tests       339 passed (339)

npm run typecheck   passed
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --types node --esModuleInterop scripts/eval-video-ideas.ts src/server/modules/file-store/pdf-parse.d.ts   passed
npm run lint        passed
npm run build       passed (existing Vite warning: client JS chunk is 968.41 kB, above 500 kB)
```

Mongo-backed tests used the installed MongoDB 8.0.6 binary. In this sandbox, `mongodb-memory-server` first needed `TEMP`, `TMP` and `TMPDIR` pointed at the writable Task 121 verification folder; otherwise WiredTiger failed to rename a temp file with `Access denied`. The test suite also needed approved local-loopback access; without it Mongo client connections failed with `EACCES 127.0.0.1`. A direct binary download attempt hit an MD5 mismatch; the final broad run used the installed binary and passed 65 files / 339 tests.

The Vietnamese evaluation summary and provider audit folders are under `data/files/.verification/task-121/` and `data/files/youtube-ideas-youtube-demo-growth-2-20261022/cli-runs/`. The evaluator's report records the database guard, stage durations, drop reasons and all listed ideas. The first unsuccessful output before the final measured runs had zero survivors and led to two targeted prompt/validation iterations; later two final-prompt Vietnamese runs are listed above. Their now-invalidated name/century metrics should not be carried forward as final-code measurements.

At the time this section was first written, Claude Code had reported `You've hit your session limit · resets 6:10pm (Etc/GMT-7)`, so the post-fix runs were outstanding. They were completed later; the commands below are retained as the reproducible setup for the isolated database, and the measured results appear in “Part B results.”

```powershell
$env:YOUTUBE_SEED_MONGODB_URI = 'mongodb://127.0.0.1:27017'
$env:YOUTUBE_SEED_MONGODB_DB = 'youtube_demo_task121_eval_20261022'
$env:YOUTUBE_IDEA_EVAL_RUNS = '2'
$env:YOUTUBE_IDEA_EVAL_TARGET = 'vietnam'
npm run eval:youtube-ideas
$env:YOUTUBE_IDEA_EVAL_TARGET = 'world'
npm run eval:youtube-ideas
```

The harness will refuse if the demo channel/database is missing or if the explicit target equals the configured database. Start the local MongoDB 8.0.6 instance and seed the isolated database first if needed. No configured/production database was written by these evaluations.

Visual acceptance at 1920×1080, 1366×768 and 900px was not performed because Hung needed computer access. Component tests cover the card behavior, but visual layout remains unverified. The earlier Vietnamese output was under five minutes and had zero saved `famous` guesses, but the old evaluator's name/century counts are invalid. No historical claim was verified.

## Task 121b — Part A CLI defaults

Commit: `0bae088 feat(claude-cli): default to Sonnet 5.5 with medium effort` (34 files). Claude Code 2.1.306 supports per-invocation `--model <model>` and `--effort <level>`; effort values are `low`, `medium`, `high`, `xhigh`, and `max`. The shared CLI default is `claude-sonnet-5-5` / `medium`, owned by `src/contracts/claude-cli.ts`; `AI_MODEL_REGISTRY.claude.defaultModelId` remains unchanged. Runner-backed script, popup, SEO worker, YouTube review and video-idea callers, plus client pickers, use the shared defaults when no CLI model is specified. Model and effort appear in call audit/job logs. The Haiku smoke invocation used exact argv `--print --input-format text --output-format text --tools "" --safe-mode --no-session-persistence --model claude-haiku-5-5 --effort medium`; it returned `OK`, exit code 0, in 5.997s. An initial sandbox call failed with DNS `ENOTFOUND`; the approved runner retry succeeded. Focused Part A verification passed 12 files / 128 tests; typecheck, lint and build passed with the existing Vite warning. See the untracked Task 121b report for file groups and output details.

## Part B results — Task 121b post-fix evaluation

Four fresh evals ran against isolated localhost MongoDB database `youtube_demo_task121b_eval_20261022`, channel `youtube-demo-growth-2-20261022` (two mature videos). The eval harness checked the target database against the configured application database before each run. Every Claude request used the production CLI defaults `--model claude-sonnet-5-5 --effort medium`; 17 total requests completed, with no session-limit or API error. No prompt or validator iteration was made after these measurements.

All four runs failed the retained survivor floor of at least three ideas, so the harness saved no idea result. The counts below are accepted survivors before that floor, not successful final results. Stage durations are sums of the call durations recorded in CLI metadata. Approximate end-to-end wall estimates come from redirected log-file timestamps; the Vietnamese run 2 estimate is within 70 ms of the five-minute cutoff and is too close to call a reliable wall-time pass.

| Steering / run | Survivors / requested 6 | Seed / select / expand seconds | CLI sum / approximate wall | Repair calls (seed / select / expand) | Diagnostic quality before survivor floor |
|---|---:|---:|---:|---:|---|
| Vietnamese 1 | 0 / 6 | 77.298 / 35.569 / 122.968 | 235.835s / ~246.960s | 0 / 0 / 1 | No accepted ideas to score |
| Vietnamese 2 | 2 / 6 | 78.047 / 30.017 / 181.176 | 289.240s / ~299.930s | 0 / 0 / 1 | Blind spot ≥ partial: 2/2; 2 archetypes (1 military, 1 institutional); famous: 0; 11 claims, 1 low (9.1%); unbacked numbers/names: 0/0 |
| World history 1 | 0 / 6 | 40.751 / 26.701 / 196.043 | 263.495s / ~273.290s | 0 / 0 / 1 | No accepted ideas to score |
| World history 2 | 2 / 6 | 18.327 / 24.645 / 214.167 | 257.139s / ~263.310s | 0 / 0 / 1 | Blind spot ≥ partial: 2/2; 2 archetypes (1 military, 1 technological); famous: 0; 17 claims, 2 low (11.8%); unbacked numbers/names: 0/0 |

The world-history run 1 expand total includes a second normal expand batch lasting 33.568s; it was not a second repair. Thus all four runs used one expand repair and no more than one repair in any stage. CLI-duration sums stayed below five minutes. The timestamp-based wall estimates also fall below five minutes, but run 2 for Vietnamese steering is effectively on the boundary, so total-time acceptance is borderline rather than robust. The 4-of-6 blind-spot goal and 3-archetype goal were missed; the all-runs survivor floor also failed. The two diagnostic lists had no `famous` guesses and zero lexical unbacked-name/number findings, but those checks do not verify historical truth. Runs with zero survivors have no final quality denominator.

The official harness threw before printing final lists when a run fell below the survivor floor. For the two runs with two survivors, `data/files/.verification/task-121b/replay-saved-outputs.ts` replayed captured provider outputs through the deterministic pipeline without another model call or persistence. It kept the requested count at six and lowered only the final diagnostic floor to two to inspect those otherwise rejected survivors. These are diagnostic pre-floor survivors, not ideas saved by a successful eval.

### Diagnostic pre-floor titles and sketches

Vietnamese history, run 1: no accepted title or sketch (0 survivors).

Vietnamese history, run 2 (2 survivors):

1. **Nguyễn Tri Phương và đại đồn Chí Hòa: khi phòng tuyến lớn thành một canh bạc** — “Nguyễn Tri Phương tin đại đồn Chí Hòa đủ giữ Gia Định; hỏa lực và cách đánh của quân Pháp nằm ngoài khung tính toán công sự, và sở trường xây phòng tuyến lớn khiến ông dồn cược vào một điểm bị khắc chế.”
2. **Nguyễn Nhạc xưng đế rồi chia quyền cho các em: niềm tin anh em có đủ làm khung thể chế?** — “Nguyễn Nhạc tin chia quyền cho các em, dựa trên sự tin cậy, sẽ giữ vững nội bộ; tham vọng riêng của từng người nằm ngoài khung ấy, và quyền thực chất ông trao lại thành chỗ dựa cho lợi ích riêng, khoét rộng chia rẽ.”

Critical read: the Chí Hòa sketch has a visible defensive mechanism but frames the episode as a broad one-point bet; the decision and causal sequence need sourcing, and the subject may not meet “ít người biết.” The Nguyễn Nhạc idea is more abstract and relies on “tham vọng riêng” as a causal explanation, which risks hindsight speculation. Neither should be treated as established history.

World history, run 1: no accepted title or sketch (0 survivors).

World history, run 2 (2 survivors):

1. **Charles XII tiến sâu vào Nga: khi đường tiếp tế không theo kịp mũi tấn công** — “Charles XII tin tiến sâu sẽ ép Nga giao chiến sớm; ngoài khung là tiếp tế đường dài và tiêu thổ; Nga né trận lớn cho quân Thụy Điển hao mòn; thế mạnh tấn công quyết liệt kéo họ xa căn cứ.”
2. **Kodak giữ mảng phim dù tự phát minh máy ảnh số** — “Kodak tin bảo vệ mảng phim sinh lời là an toàn; ngoài khung là tốc độ người dùng chuyển sang ảnh số; đối thủ và thị trường ảnh số lớn nhanh; thế mạnh thống trị phim khiến hãng ngại tự làm suy yếu.”

Critical read: the Charles XII idea is a familiar, broad campaign rather than a bounded episode, and its causal chain needs sources. Kodak is a generic business-failure trope with a broad title; it needs a specific decision and time window. Neither is endorsed as fact.

### Timing, logs and audit paths

The four complete command logs are `data/files/.verification/task-121b/eval-vietnam-1.log`, `eval-vietnam-2.log`, `eval-world-1.log`, and `eval-world-2.log`. Provider audit calls are under `data/files/youtube-ideas-youtube-demo-growth-2-20261022/cli-runs/`. Call IDs, in order, are:

- Vietnamese 1: `01M5HWE73MP6VWSQEN985N1X24` (77.298s), `01M5HWGJTRTVS8R92GRFB08G52` (35.569s), `01M5HWHNSMRC96ANWMN0TM0RQA` (67.911s), `01M5HWKRBPJJEJ3323Y4RDC4FZ` (55.057s).
- Vietnamese 2: `01M5HWP94JQKWRFR2X27S37NRP` (78.047s), `01M5HWRNM3ZDHP7PH6R0FBZKPM` (30.017s), `01M5HWSK5YJV164JG7KG9ZK7R8` (71.240s), `01M5HWVS31YY7W95VT4W5TDJ64` (109.936s).
- World history 1: `01M5HWZRCM7M4Y35MJ2DFYF4EY` (40.751s), `01M5HX10E92ZDAR21ZP03YW830` (26.701s), `01M5HX1TR53GQAQQMEMGE7ARQ5` (73.400s), `01M5HX42SAECSKP2DPYQDZX2V8` (89.075s), `01M5HX6T072FVR0ZJXN8AFNZ5H` (33.568s; normal expand batch).
- World history 2: `01M5HX8NWQEA0D08TZ70FZ83SV` (18.327s), `01M5HX9835GSTZ6ENYFDCD8AAE` (24.645s), `01M5HXA0EGY4VJ4MBVRJC4MJ3A` (84.847s), `01M5HXCKJ5N8W4Y706BH1HH8DQ` (129.320s).

### UI and remaining limit

The ideas panel was not opened in a browser because Hung needed computer access; no viewport capture was made. Manual acceptance remains: open the channel ideas panel and inspect cards, wrapping, action alignment and panel overflow at 1920×1080, 1366×768 and about 900px. No historical claims in generated ideas were checked against sources. The isolated MongoDB process started for these evaluations was stopped; ignored eval logs, audit data and diagnostic replay remain in `data/files/.verification/` and `data/files/youtube-ideas-.../` for review.
