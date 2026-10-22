# Task 121b — Claude CLI defaults and Task 121 evaluation

Date: 2026-10-22

## A1 — Installed CLI behavior

- `claude --version`: `2.1.306 (Claude Code)`.
- Installed `claude --help` documents `--model <model>` (alias or full model name), `--effort <level>`, and accepted effort values `low`, `medium`, `high`, `xhigh`, `max`.
- A tiny real smoke request used Haiku 5.5 at medium effort and returned `OK`, exit code 0, in 5,997ms with empty stderr. Exact metadata argv:

  ```text
  ["--print","--input-format","text","--output-format","text","--tools","","--safe-mode","--no-session-persistence","--model","claude-haiku-5-5","--effort","medium"]
  ```

- An initial ordinary sandbox call failed with API DNS `ENOTFOUND`; the approved runner retry succeeded. The four subsequent production-default evals completed 17 calls with model `claude-sonnet-5-5` and effort `medium`, confirming both IDs/flags were accepted by this installed CLI.

## Part A — Changes

Commit: `0bae088 feat(claude-cli): default to Sonnet 5.5 with medium effort` (34 files).

- Shared client/server contract exports `CLAUDE_CLI_DEFAULT_MODEL = 'claude-sonnet-5-5'` and `CLAUDE_CLI_DEFAULT_EFFORT = 'medium'`, separate from the unchanged API registry default. The comment identifies them as Hung’s product defaults, not Anthropic recommendations.
- Runner/chat APIs pass the resolved model and effort on every CLI invocation. Explicit model/effort overrides still work. CLI audit and job logs show the resolved model and effort without prompt content.
- Script generation/regeneration, popup analysis, SEO worker calls, YouTube review, and video-idea generation use the shared defaults when the request omits a CLI model. The video-ideas constant now aliases the shared default.
- Client model pickers default to Sonnet 5.5 and show read-only “Mức suy luận: medium”. The model registry gained `claude-haiku-5-5`; the API path’s Claude default was not changed.
- Updated shared contracts, runner/caller/client tests and relevant module docs and `AGENTS.md`.

Focused verification after Part A: 12 files / 128 tests passed; typecheck, lint and build passed. Build retains the existing Vite chunk warning.

## Part B — Post-fix real CLI evaluations

Four independent evaluations ran on isolated localhost MongoDB database `youtube_demo_task121b_eval_20261022`, demo channel `youtube-demo-growth-2-20261022`, seeded with two mature videos. The target was checked against the configured application database before each run. No prompt or validator iteration followed the measurements. Every call’s log printed `model=claude-sonnet-5-5; effort=medium`; CLI argv flags were `--model claude-sonnet-5-5 --effort medium` on every call.

| Steering / run | Kept before minimum / requested | Seeds / select / expand | CLI duration sum; approximate wall | Repairs (seed / select / expand) | Outcome |
|---|---:|---:|---:|---:|---|
| Vietnamese 1 | 0 / 6 | 77.298 / 35.569 / 122.968s | 235.835s; ~246.960s | 0 / 0 / 1 | Failed minimum 3; no result persisted |
| Vietnamese 2 | 2 / 6 | 78.047 / 30.017 / 181.176s | 289.240s; ~299.930s | 0 / 0 / 1 | Failed minimum 3; no result persisted |
| World history 1 | 0 / 6 | 40.751 / 26.701 / 196.043s | 263.495s; ~273.290s | 0 / 0 / 1 | Failed minimum 3; no result persisted |
| World history 2 | 2 / 6 | 18.327 / 24.645 / 214.167s | 257.139s; ~263.310s | 0 / 0 / 1 | Failed minimum 3; no result persisted |

Approximate wall duration is based on redirected log-file timestamps. CLI duration sums are from per-call metadata. Vietnamese run 2 is within 70ms of the 300s cutoff by the approximate wall estimate, so the time result is borderline; all call-duration sums are under 300s. World history run 1 had a second regular expand batch of 33.568s, not a second repair. No run hit a session limit or transport error.

The official harness rejects any run below three survivors before emitting final metrics or saving ideas. A diagnostic replay of captured outputs, without model calls or persistence, changed only the final diagnostic floor to two (request count remained six) to inspect the two-survivor cases:

| Diagnostic run | Blind spot ≥ partial | Distinct archetypes | `famous` guesses | Claims / low share | Unbacked numbers / names |
|---|---:|---:|---:|---:|---:|
| Vietnamese 2 | 2/2 | 2 (military 1, institutional 1) | 0 | 11 / 1 (9.1%) | 0 / 0 |
| World history 2 | 2/2 | 2 (military 1, technological 1) | 0 | 17 / 2 (11.8%) | 0 / 0 |

The four-run quality target was not met: every run missed the survivor floor; two pre-floor lists had only two ideas, below the goal of four with blind spot at least partial and below three distinct archetypes. Both diagnostic lists had zero `famous` guesses. Lexical number/name checks found no unbacked entries in those two lists, but do not certify factual accuracy. Runs with zero survivors have no final-list denominator.

### Titles and trap sketches (diagnostic pre-floor survivors)

Vietnamese history run 1 and world history run 1 had no final titles/sketches because zero ideas survived.

Vietnamese history run 2:

1. **Nguyễn Tri Phương và đại đồn Chí Hòa: khi phòng tuyến lớn thành một canh bạc** — Nguyễn Tri Phương tin đại đồn Chí Hòa đủ giữ Gia Định; hỏa lực và cách đánh của quân Pháp nằm ngoài khung tính toán công sự, và sở trường xây phòng tuyến lớn khiến ông dồn cược vào một điểm bị khắc chế.
2. **Nguyễn Nhạc xưng đế rồi chia quyền cho các em: niềm tin anh em có đủ làm khung thể chế?** — Nguyễn Nhạc tin chia quyền cho các em, dựa trên sự tin cậy, sẽ giữ vững nội bộ; tham vọng riêng của từng người nằm ngoài khung ấy, và quyền thực chất ông trao lại thành chỗ dựa cho lợi ích riêng, khoét rộng chia rẽ.

Critical read: Chí Hòa offers a visual mechanism, but the sketch is a broad one-point bet and needs sourcing for the decision and causal chain; “ít người biết” is unproven. The Nguyễn Nhạc idea is abstract and “tham vọng riêng” is a speculative causal explanation. Neither is treated as established history.

World history run 2:

1. **Charles XII tiến sâu vào Nga: khi đường tiếp tế không theo kịp mũi tấn công** — Charles XII tin tiến sâu sẽ ép Nga giao chiến sớm; ngoài khung là tiếp tế đường dài và tiêu thổ; Nga né trận lớn cho quân Thụy Điển hao mòn; thế mạnh tấn công quyết liệt kéo họ xa căn cứ.
2. **Kodak giữ mảng phim dù tự phát minh máy ảnh số** — Kodak tin bảo vệ mảng phim sinh lời là an toàn; ngoài khung là tốc độ người dùng chuyển sang ảnh số; đối thủ và thị trường ảnh số lớn nhanh; thế mạnh thống trị phim khiến hãng ngại tự làm suy yếu.

Critical read: Charles XII is a familiar broad campaign, not a bounded episode, and needs causal sourcing. Kodak is a generic failure trope with a broad title; the decision and time window need narrowing. Neither output is a verified historical claim.

### Audit paths

Full stdout/stderr logs: `data/files/.verification/task-121b/eval-vietnam-1.log`, `eval-vietnam-2.log`, `eval-world-1.log`, `eval-world-2.log`. Per-call `prompt.md`, `output.txt` and `meta.json` are under `data/files/youtube-ideas-youtube-demo-growth-2-20261022/cli-runs/<call-id>/`.

- Vietnamese 1: `01M5HWE73MP6VWSQEN985N1X24`, `01M5HWGJTRTVS8R92GRFB08G52`, `01M5HWHNSMRC96ANWMN0TM0RQA`, `01M5HWKRBPJJEJ3323Y4RDC4FZ`.
- Vietnamese 2: `01M5HWP94JQKWRFR2X27S37NRP`, `01M5HWRNM3ZDHP7PH6R0FBZKPM`, `01M5HWSK5YJV164JG7KG9ZK7R8`, `01M5HWVS31YY7W95VT4W5TDJ64`.
- World history 1: `01M5HWZRCM7M4Y35MJ2DFYF4EY`, `01M5HX10E92ZDAR21ZP03YW830`, `01M5HX1TR53GQAQQMEMGE7ARQ5`, `01M5HX42SAECSKP2DPYQDZX2V8`, `01M5HX6T072FVR0ZJXN8AFNZ5H`.
- World history 2: `01M5HX8NWQEA0D08TZ70FZ83SV`, `01M5HX9835GSTZ6ENYFDCD8AAE`, `01M5HXA0EGY4VJ4MBVRJC4MJ3A`, `01M5HXCKJ5N8W4Y706BH1HH8DQ`.

## Verification and remaining limits

- Full requested module suite after the evals: `npm run test -- --no-file-parallelism --hookTimeout=30000 --reporter=dot src/server/shared/claude-cli src/server/modules/youtube src/server/modules/seo src/server/modules/script src/server/modules/video src/client/features/youtube src/client/features/seo src/contracts` → 112 test files passed; 1,115 tests passed (MongoDB 8.0.6).
- `npm run typecheck` → pass.
- `npm run lint` → pass.
- `npm run build` → pass; existing Vite chunk-size warning (client bundle 968.87 kB > 500 kB).
- The earlier Part A focused run passed 12 files / 128 tests.
- Visual acceptance at 1920×1080, 1366×768 and about 900px was not performed because Hung needed computer access. Manual viewport inspection remains outstanding. Historical sources were not checked; generated ideas remain hypotheses.
- Initial API DNS failure was resolved by the approved runner retry. No push was made. The isolated MongoDB process started for evals has been stopped; ignored verification and audit artifacts remain available under `data/files/`.

## Follow-up commit

The tracked `AGENTS.md` Status entry and shared CLI module documentation were corrected after the successful smoke/evals so they no longer describe the first DNS failure as a final failed smoke. The documentation-only follow-up is recorded separately as `fix(youtube): Task 121 eval findings`. This report and `task-121-report.md` remain untracked by design.

## Final verification snapshot

Fresh verification after the documentation commit:

```text
npm run test -- --no-file-parallelism --hookTimeout=30000 --reporter=dot src/server/shared/claude-cli src/server/modules/youtube src/server/modules/seo src/server/modules/script src/server/modules/video src/client/features/youtube src/client/features/seo src/contracts
Test Files  112 passed (112)
Tests       1115 passed (1115)
Duration    198.75s

npm run typecheck  exit 0
npm run lint       exit 0
npm run build      exit 0; Vite warns that index JS is 968.87 kB (>500 kB)
```

Mongo-backed tests used the installed MongoDB 8.0.6 system binary and the Task 121b temp directory. `mongodb-memory-server` requested 8.2.6, warned of the version difference, and explicitly selected the installed system binary. The `AGENTS.md` working file and committed blob both contain LF (520 LF, 0 CRLF).

```text
git log --oneline -8
5015e1c fix(youtube): Task 121 eval findings
0bae088 feat(claude-cli): default to Sonnet 5.5 with medium effort
38738db fix(youtube): address Task 121 review findings
53d3b14 feat(youtube): idea cards show the trap sketch and quality signals
ebc84c4 feat(youtube): trap-first staged idea pipeline and stricter validation
9056fa6 feat(youtube): video ideas panel and project hand-off
456e8d7 feat(youtube): Claude CLI video idea job with validation
d1c0ec4 feat(youtube): video idea packet, storage and routes

git status --short
?? "Claude outputs/codex-prompt-task118-claude-cli-channel-review.md"
?? "Claude outputs/codex-prompt-task120-next-video-ideas.md"
?? "Claude outputs/codex-prompt-task121-idea-quality-upgrade.md"
?? "Claude outputs/codex-prompt-task121b-cli-defaults-and-eval-finish.md"
?? docs/superpowers/plans/2026-10-22-task-118-review.md
?? docs/superpowers/plans/2026-10-22-task-120-video-ideas.md
?? docs/superpowers/plans/2026-10-22-task-121-idea-quality.md
?? docs/superpowers/tasks/task-118-report.md
?? docs/superpowers/tasks/task-120-report.md
?? docs/superpowers/tasks/task-121-report.md
?? docs/superpowers/tasks/task-121b-report.md
```

Only untracked task prompts, plans and reports remain. No report or plan was staged, and no push was performed.
