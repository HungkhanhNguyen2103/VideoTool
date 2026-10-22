# Task 121 — Raise the quality of "Ý tưởng video tiếp theo" (trap-first, episode-level, diverse, faster, measured)

Work directly on `main` (no feature branch, no worktree). Never push. Do not stage temp files (`.env`, `.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`, `docs/superpowers/plans/*`, the stray `01M4W…` files in the repo root, `data/files/.verification`). Keep LF line endings in commits. Follow AGENTS.md (rule 11: Status line in the same commit; import through each module's `index.ts`; CSS Modules + design tokens only, no new colors). Code, comments, AI prompts and commit messages are English; user-facing text is Vietnamese. Small/medium task: short untracked plan, no design-approval round. Two commits suggested: `feat(youtube): trap-first staged idea pipeline and stricter validation`, `feat(youtube): idea cards show the trap sketch and quality signals`.

## Why (real result of the Task 120 run, 2026-10-22)

Task 120 works mechanically but the ideas it produced for Hung's Vietnamese-history channel were weak (see `docs/superpowers/tasks/task-120-report.md`, run `01M5HER0SP1YN90F4N70WYKQP0`):

1. **All 6 saved ideas had `blindSpot: thin`.** The blind spot is the load-bearing element of the hubris-trap preset (the variable outside the hunter's frame, exploited by the other side). The current rule ("≥ 2 of 4 links non-thin") lets an idea through that has no demonstrated trap — it is just a tragic figure.
2. **Person biographies instead of trap episodes**: Lê Chiêu Thống, Trịnh Tùng, Phan Thanh Giản, Mạc Đăng Dung, Trần Ích Tắc, Hồ Quý Ly. They are famous names (Hung asked for "ít người biết") and the framing repeated ("tự đào mồ chôn mình"). Two titles were sensational labels ("Hoàng tử bán nước", "Ông vua cõng rắn cắn gà nhà").
3. **Unflagged concrete claims** in briefs ("5 ngày", "200 năm", "1527"); a numeric guard was added at the end of Task 120 but not re-measured.
4. **Slow and repair-heavy**: 4 CLI calls, 7m38s on `claude-opus-4-5` (the registry default); the first call returned 10 items that failed the schema and needed a 155 s repair call.

Goal: ideas that each contain a **checkable trap sketch**, are about a **specific episode** (event + decision), differ from each other, are honest about being memory-only, and arrive faster. Success is **measured** (section 6), not asserted.

## What exists (reuse, do not duplicate)

`src/server/modules/youtube/idea-prompts.ts`, `idea-engine.ts` (validation, merge, duplicate checks), `idea-service.ts` (job, steps, repair), `idea-packet.ts`, `idea-repo.ts`, contracts `src/contracts/youtube-ideas.ts`, client idea panel/cards in `features/youtube`, the shared CLI wrapper and progress panel, `AI_MODEL_REGISTRY` (`src/contracts/ai-models.ts`; `claude-sonnet-5-5` exists, default is `claude-opus-4-5`). Keep stored v1 ideas readable (mapper test); new documents get `promptVersion` v2.

## 1. Pipeline: from 2 big calls to 3 small staged calls

Replace "generate `count+4` full ideas → critique" with:
1. **Seeds** (`video-ideas-v2-seeds`): ask for `count × 3` (cap 24) **one-line episode seeds**: `{ id, episode (event + decision, ≤ 160 chars), year or period (string), place, hunterArchetype, domain, famousnessGuess }`. Short output, cheap, low schema risk.
2. **Select** (`video-ideas-v2-select`): the model judges every seed against the packet and the *trap test* below and returns the best `count + 2` ids with a one-line trap sketch each and rejection reasons for the rest. Server enforces diversity (section 3) on this list before expansion.
3. **Expand** (`video-ideas-v2-expand`): full idea objects only for the selected seeds, in **batches of at most 4** per call (smaller JSON, fewer schema failures). Final trimming to `count` is deterministic (score order, then diversity).
Keep: one repair call per stage maximum, the minimum-survivor failure (`YOUTUBE_IDEAS_UNGROUNDED`), cancellation, logs/heartbeat, step progress (update the step list: `Ý tưởng sơ bộ`, `Chọn lọc`, `Viết chi tiết`). Run records store per-stage durations.

## 2. The trap test (replaces the loose "≥ 2 non-thin")

For `hubris-trap`, an expanded idea must contain a structured **trap sketch** and pass:
- `trap: { hunterBelief, outsideVariable, exploitedBy, advantageThatBackfired }` — four short statements (≤ 200 chars each) that answer: what the stronger side assumed; which variable was outside that frame; how the other side or circumstances used it; which of the hunter's *own* strengths produced the collapse. The existing four motif fields stay (they are what the script generator consumes); `trap` is the compact test form and must be consistent with them (the critic checks).
- **`blindSpot` evidence must be `strong` or `partial`; `thin` drops the idea.** Also at least one of `perfectPlan`/`selfDestruction` non-thin. (Task 120's "any two non-thin" rule is removed for hubris-trap.)
- `advantageThatBackfired` must name a strength of the hunter, not bad luck or betrayal by a third party; if the model can only describe bad luck, the seed is rejected ("không phải bẫy tự giăng").
- Neutral phrasing: titles may not use pure moral labels ("phản bội", "bán nước", "hèn nhát", "thiên tài", "kẻ tội đồ") as the main claim; keep the list in one constant with tests, allow them only inside a quoted contemporary label that is flagged in `unverifiedFacts`.
- No hindsight framing (existing); the trap sketch must be expressed in terms of what the hunter believed *at the time*.
- A **"sketch line"** `trapSketch` (≤ 280 chars) is generated in plain Vietnamese: "X tin rằng …, nên …; nhưng … nằm ngoài khung nhìn; kết quả … vì chính …". It is what the UI shows first.

## 3. Specific, diverse, less famous

- The unit of an idea is an **episode** (an event/decision with a period), not a person. Reject seeds/ideas whose `episode` is just a name or a general biography (heuristic: no verb/decision and no period).
- Add to the expanded idea: `period`, `place`, `hunterArchetype` (enum: `military`, `political`, `economic`, `technological`, `diplomatic`, `institutional`, `other`), `famousnessGuess` (`famous`|`known`|`obscure`|`unknown`, **explicitly a guess**, never shown as fact).
- **Diversity enforced by code** on the selected list: no two ideas share the same `hunterArchetype` *and* century (at most 2 per archetype overall); no more than 2 ideas about the same person/polity (normalised name match on the `episode`); `testVariable` is `topic` for all (single variable) but `angle` must differ.
- **Obscurity steering**: when the steering text asks for little-known topics (keywords such as "ít người biết", "ít ai biết", "hiếm", "chưa nhiều người"; keep the list in a constant), the pipeline (a) puts a soft *avoid list* of the most commonly told episodes/figures of the requested region into the seed prompt (a small, editable constant per region — for Vietnamese history start with the obvious ones such as Trần Hưng Đạo, Ngô Quyền, Lê Lợi, Quang Trung, Hồ Quý Ly, Mạc Đăng Dung, Lê Chiêu Thống, Phan Thanh Giản, Hai Bà Trưng, Bạch Đằng — Hung can edit it; make it a documented array in one file, not in the prompt text), and (b) drops `famousnessGuess: 'famous'` ideas, keeping `known` only if fewer than `count` obscure ones survive (and labels them). Because the model cannot know real fame, the UI says "ước đoán của AI" and the research step is where it gets confirmed.
- **Anti-pattern list** in the prompt (tested for presence): "a tragic or hated figure is not a trap"; "a loss by bad luck, disease or betrayal is not a trap unless the hunter's own strength caused it"; "do not reuse the same closing metaphor across ideas"; "no two ideas may end with the same moral".

## 4. Honest facts, without noise

- Each factual claim in an idea goes into `claims[]` = `{ text ≤ 160, confidence: 'high'|'medium'|'low' }` (replace the free-form `unverifiedFacts[]` for v2; keep reading v1). Rule: **every number, year, named person/place/polity, and causal statement in `title`, `hook`, `brief`, `trap*`, `motif*` must be backed by a claim with the same number/name**; the validator extracts numbers and capitalised names from those fields and checks them against `claims` and the packet. Mismatch → repair once, then drop the idea.
- Claims with `low` confidence are shown in the UI as "dễ sai — phải kiểm chứng trước". If more than half of an idea's claims are `low`, the idea is dropped as "quá dựa vào trí nhớ".
- The `brief` should **avoid exact numbers and dates unless they are in `claims`** (prompt rule) — the point is a brief Hung can paste into the project form without smuggling unverified numbers into the script.
- Keep every Task 120 rule (promises, demand, rarity claims, duplicates vs coverage and saved ideas, single `testVariable`).

## 5. Speed and cost

- **Default model for the idea job = `claude-sonnet-5-5`** (the CLI model picker still allows others). Do not change the global registry default; add an `IDEA_DEFAULT_CLI_MODEL` constant used by this job and the UI and say so in the docs.
- Fewer repair calls: before spending a repair call, apply a **deterministic normaliser** to the parsed JSON that fixes safe, mechanical problems — trim over-long strings to their limits at a word boundary for fields where truncation is harmless (`whyForThisChannel`, `risks`, `claims[].text`; never for `title`, `brief`, `trap*`), coerce enum case, drop unknown extra keys, wrap a single object into an array. First, **read the Task 120 audit folders** (`data/files/.verification/task-120/idea-cli-audit/…/cli-runs/`, including the failing 10-item output) and list which fields caused the 10 schema failures; fix the prompt/schema/normaliser for exactly those causes, and report them.
- Target (measured in section 6): total time on Sonnet 5.5 with the 2-video demo channel ≤ 5 minutes; ≤ 1 repair call per stage, ideally 0.

## 6. Quality gate: an offline eval harness (the main acceptance test)

Add `scripts/eval-video-ideas.ts` (dev only, refuses to run unless the DB is the isolated demo database, same guard as the seed script) that:
- runs the real pipeline through the Claude CLI `N` times (default 3) for the demo 2-video channel with the steering "lịch sử Việt Nam, ít người biết, hubris-trap" and a second steering "lịch sử thế giới (quân sự, kinh tế, công nghệ), hubris-trap";
- computes and prints per run: ideas kept/dropped and reasons; share with `blindSpot` ≥ partial; number of distinct `hunterArchetype` and centuries; ideas whose `famousnessGuess` is `famous`; number of claims and `low` share; numbers/names in prose not backed by claims (must be 0 by construction); repair calls per stage; per-stage and total duration; titles (so a human can read them);
- writes a markdown summary under `data/files/.verification/task-121/` (never committed).
Pure metric functions are unit-tested without the CLI. **Acceptance for this task** (report real numbers, compare to the Task 120 run): at least 4 of 6 final ideas have `blindSpot` ≥ partial **by the model's own evidence rating** (a rating, not truth — say so); at least 3 distinct `hunterArchetype` values and no more than 2 ideas per archetype; no `famous` guess when the steering asked for obscure; total time ≤ 5 min on Sonnet 5.5 or an honest explanation; zero unbacked numbers. If the eval fails the targets after two prompt iterations, ship what is best, say plainly which target was missed and why — do not tune the validators to pass the eval.
- In the report include the full list of titles + `trapSketch` lines from at least two real runs and **your own critical read**: which ideas still look generic or likely wrong, and which would you drop before researching. Do not claim any historical fact is true.

## 7. Client

- Idea card shows first: **title**, the **`trapSketch` line**, chips for `hunterArchetype`, `period`/`place`, "ước đoán độ nổi tiếng" (labelled guess), then the existing sections. Add the compact `trap` four-line block (collapsible) and the `claims` list with confidence chips (`low` highlighted "dễ sai"). Run summary shows per-stage durations and dropped reasons including the new ones ("blind spot mỏng", "không phải bẫy tự giăng", "quá dựa vào trí nhớ", "trùng loại bẫy").
- The research-request text (Task 120) now lists the `trap` statements as hypotheses to verify and the `claims` as the checklist, ordered `low` first.
- The CLI model picker defaults to the idea default (Sonnet 5.5) for this panel only.
- Pure helpers + no-DOM tests: sketch/claim formatting, chip labels, reason mapping, research-request builder, default-model selection.

## 8. Tests

Seeds → select → expand flow with a fake CLI (batching of 4, diversity trimming, deterministic final trim); trap-test rejects: blindSpot thin, bad-luck-only advantage, moral-label title, person-only episode; archetype/century/person caps; obscurity steering drops `famous`, keeps `known` only as labelled fallback; avoid-list is injected from the constant (not hard-coded in prompt text); claims validator (number/name in `brief` missing from claims, `low`-majority drop, numbers also present in packet allowed); normaliser cases (over-long optional field trimmed, title not trimmed, enum case, extra key dropped, single object wrapped) and that it happens before any repair call; one repair per stage max; minimum-survivor failure; v1 documents still parse and render; default model constant used; eval metric functions; prompt-rule presence for v2 (anti-patterns, claims rule, no-numbers-in-brief rule).

## 9. Docs and Status

Update `src/server/modules/youtube/MODULE.md` (pipeline stages, trap test, diversity/obscurity rules and editable avoid-list location, claims rules, normaliser, default model, eval harness and how to run it; mark every threshold as a heuristic). Add the AGENTS.md Status line in each behaviour-changing commit (keep the file LF — if your tool writes CRLF, convert before committing).

## Out of scope

Web research by the tool, deciding which historical claim is true, changing the hubris-trap script preset, changing the Task 117 engine or Task 118 review, auto-creating projects, and any new design tokens.

## Verification (run and report real output)

`npm run typecheck`, `npm run lint`, new and touched vitest files plus `src/server/modules/youtube`, `src/client/features/youtube`, `src/contracts`, and `npm run build` (reuse the local Mongo workaround if needed and say so). **Database safety**: verify the database name before any seed or eval; refuse unless it is an isolated `youtube_demo_` database on localhost; never write to the configured database. Run the eval harness with the real Claude CLI (Sonnet 5.5) at least 2 times per steering, paste the real log lines, per-stage durations, audit folder paths and the metrics table; if the CLI is unavailable say so and give Hung the manual steps. Check the idea cards at 1920×1080, 1366×768 and 900 px or say plainly what could not be captured.

## Report

Write `docs/superpowers/tasks/task-121-report.md` (untracked): commits, files changed, the Task 120 schema-failure causes you found in the audit folders, stage table with durations (before vs after), the trap-test/diversity/obscurity/claims rule tables with origins (all heuristics) and known false-positive/negative risks, eval metrics before vs after, the titles + `trapSketch` lines of the real runs with your critical read, what you could not verify, deviations. Do not push.
