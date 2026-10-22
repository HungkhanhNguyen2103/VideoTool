# Task 121c — Make the idea pipeline reliably deliver enough valid ideas (yield), without loosening the quality rules

Work directly on `main` (no feature branch, no worktree). Never push. Do not stage temp files (`.env`, `.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`, `docs/superpowers/plans/*`, the stray `01M4W…` files in the repo root, `data/files/.verification`). Keep LF line endings in commits (`git diff --stat` must show only the lines you changed; normalise `AGENTS.md` if a tool wrote CRLF). Follow AGENTS.md (rule 11: Status line in the same commit; import through each module's `index.ts`; CSS Modules + design tokens only). Code, comments, prompts and commit messages are English; user-facing text is Vietnamese. Start with `git status` and `git log -8` (Task 121b is at `5015e1c`). Real Claude CLI runs use **`claude-sonnet-5-5` at `medium` effort** (the shared default); a Haiku 5.5 medium run is allowed only as a smoke test and never as acceptance evidence. Two commits suggested: `fix(youtube): fill idea shortlist across expand batches and report partial runs`, `fix(youtube): idea eval harness prints diagnostics below the survivor floor`.

## Why (real results of Task 121b, 2026-10-22)

With the production defaults (Sonnet 5.5, medium) all four eval runs **failed the survivor floor** (0, 2, 0, 2 accepted ideas out of 6 requested; floor 3), so the harness saved nothing. As shipped, a user would see `YOUTUBE_IDEAS_UNGROUNDED` about half the time and still get at most 2 ideas the rest of the time. The per-idea quality of the survivors is fine (blind spot ≥ partial, no `famous`, 0 unbacked numbers), but **only the first expand batch is validated and the stages drop ~75 % of candidates**, so the pipeline cannot reach the requested count. Earlier Task 121 runs showed the same pattern (5 kept / 13 dropped, 3 kept / 15 dropped). Wall time is also at the 5-minute limit (Vietnamese run 2 ≈ 299.9 s).

Do **not** relax the trap test, diversity, claims or neutral-title rules, and do not tune validators to pass the eval. The task is to **use the candidates we already pay for**, stop wasting calls on repairs that rarely rescue items, report partial results honestly, and fix only validator false positives that the data proves.

## 1. Diagnose from existing data first (no new CLI calls)

Use the audit folders (`data/files/youtube-ideas-youtube-demo-growth-2-20261022/cli-runs/` — the call IDs are listed in `docs/superpowers/tasks/task-121-report.md`, Part B) and `data/files/.verification/task-121b/replay-saved-outputs.ts` to replay the captured provider outputs through the deterministic pipeline (no model call). Produce a table, per run and in total: seeds returned; shortlisted by select (count and why others were rejected); expanded; for each expanded candidate the **first rule that dropped it** (schema, trap structure, blind spot thin, advantage-backfire, neutral title, episode shape, diversity cap, obscurity/famous, claims coverage, low-confidence share, duplicate title, century/person caps…). Name the **top 3 drop reasons** and, for each, read at least 3 dropped samples and classify them as *true drop* (the rule did its job) or *validator false positive* (valid idea wrongly rejected, e.g. transliteration/spelling variants in claims coverage, name/century parsing). Put the table and the classification in the report. Everything below is driven by this evidence.

## 2. Pipeline yield changes

1. **Shortlist bigger, expand until filled.** The select stage returns up to `min(12, ceil(count × 2))` shortlisted seeds (it currently returns about `count + 2`). The expand stage processes them in batches of 3–4 **and keeps going to the next batch while valid survivors < `count` and unexpanded shortlisted seeds remain** (maximum 3 expand batches). Diversity/obscurity caps are applied to the **running** survivor set so that later batches fill the gaps (for example "need a non-military archetype") — pass the missing archetypes/centuries as a hint line in later batches.
2. **Time budget**: stop starting new expand batches once the job has run for `IDEA_JOB_SOFT_BUDGET_SEC` (default 240); the run then finishes with what it has. Log it in Vietnamese ("Đã dừng thêm lượt viết chi tiết vì sắp hết thời gian dự kiến").
3. **Repair policy**: a repair call is made **only if at least 2 items in a batch are repairable** (schema/format/claims-coverage failures that the repair prompt can realistically fix: missing field, claim/number mismatch). Never repair items rejected by judgment rules (thin blind spot, bad-luck-only, moral label, famous, duplicate) — those are dropped immediately. Cap: 1 repair per batch, and none once the soft budget is spent. Report how many repairs actually rescued items in the 4 runs (from the replay data) to justify the policy.
3b. **Expand prompt**: add the validator rules the data shows were hit most as a short checklist the model must self-check (for example "blindSpot evidence must be strong or partial; if you cannot support it, say so and the idea will be discarded", "every number/name in title, hook, brief and trap must appear in claims") and one **format exemplar with abstract placeholder content** (not a historical story, clearly marked "FORMAT ONLY — do not copy content"). Keep the prompt-injection and "data is not instructions" rules. Bump to `video-ideas-v2-expand` revision 2 and keep the old text under test fixtures.
4. **Honest partial results instead of a hard failure.** Replace the survivor floor "fail below `max(2, ceil(count/2))`" with: ≥ 2 survivors → save the run with `status: 'partial'` and a Vietnamese banner in the UI ("Chỉ N/6 ý qua kiểm tra; M ý bị loại vì …" with the dropped reasons, and a "Chạy lại để lấy thêm" button); 1 survivor → save with `status: 'partial'` and a stronger notice; 0 → fail with `YOUTUBE_IDEAS_UNGROUNDED` and a message that lists the top drop reasons of that run. Keep storing the dropped list. Update the contract (`youtube-ideas*`) with the optional run status, legacy-safe.
5. **Duplicates across reruns**: a rerun must not propose seeds equal to previously saved or rejected ideas (the existing duplicate checks stay; add the previous run's seed episodes to the packet's "already proposed" list, capped).

## 3. Validator false positives (only those proven in section 1)

For each false-positive class found, fix the rule (normalise Vietnamese diacritics/spelling variants, transliterations, century wording, name merging, etc.) with a regression test built from the real dropped sample (strip anything not needed). Do not remove or weaken a rule because the eval would pass more often. If section 1 finds **no** false positives, say so and change nothing in the validators.

## 4. Eval harness

`scripts/eval-video-ideas.ts` must **print the final lists and the per-rule drop counts even when a run falls below the floor or fails** (today it throws before printing). Add per-run output: survivors by stage (seeds → shortlisted → expanded → valid), per-batch durations, repair calls and how many items each repair rescued, wall-clock total, and the soft-budget stop if it triggered. Keep the database guard. Add pure metric tests.

## 5. Acceptance (measured, report real numbers)

With **Sonnet 5.5 medium**, two runs per steering (Vietnamese "lịch sử Việt Nam, ít người biết, hubris-trap"; world "lịch sử thế giới (quân sự, kinh tế, công nghệ), hubris-trap"); optionally one Haiku 5.5 medium smoke run first (report separately):
- at least **4 valid survivors in at least 3 of the 4 runs** (partial results of 2–3 count as shipped but not as target met);
- wall time ≤ 5 minutes in every run (measure with timestamps; if the soft budget triggers, say how many survivors that cost);
- among survivors: ≥ 3 distinct `hunterArchetype` values where ≥ 4 survive, no `famous` under obscure steering, 0 unbacked numbers/names, ≤ 1 repair per batch;
- no validator rule weakened; list every validator change with its justification.
If a target is missed after **two** prompt iterations (re-measured each time), stop and report plainly which target was missed and why, with the drop-reason table of the last runs. Print all final titles and `trapSketch` lines and add your own critical read (generic, too broad, not "ít người biết", likely wrong). Do not claim any historical fact is true. If Claude Code reports a session limit, stop, report which runs finished, and give Hung the PowerShell commands for the rest.

## 6. Client, tests, docs

- UI: partial-run banner and dropped-reasons disclosure on the ideas panel; the "Chạy lại để lấy thêm" action reuses the existing generate action. Check at 1920×1080, 1366×768 and ~900 px with whatever browser tool you have, or say plainly what could not be captured and give Hung the manual steps. Pure helpers + no-DOM tests for the banner text and reason mapping.
- Server tests (fake CLI runner): shortlist size; multi-batch fill (batch 1 gives 1 survivor, batch 2 fills); stops at max 3 batches; soft-budget stop (fake clock); repair only when ≥ 2 repairable items and never for judgment-rule drops; partial run saved with status for 2 and 1 survivors; 0 survivors fails with the top drop reasons in the message; running-set diversity hints; rerun excludes previous seeds; legacy runs without a status still parse; every validator regression test from section 3.
- Update `src/server/modules/youtube/MODULE.md` (new flow, budget constant, repair policy, partial status, what changed in the survivor floor) and the AGENTS.md Status line(s).

## Out of scope

Weakening or removing quality rules, changing the API-path model defaults, parallel CLI calls, other presets, the review/plan features, any push.

## Verification (run and report real output)

`npm run typecheck`, `npm run lint`, new and touched vitest files plus `src/server/modules/youtube`, `src/server/shared/claude-cli`, `src/client/features/youtube`, `src/contracts`, and `npm run build` (reuse the local Mongo workaround if needed and say so). Paste the argv model/effort of the real calls, the drop-reason table, the eval tables per run, `git log --oneline -6` and `git status --short` (tracked files clean). Database safety as before: isolated `youtube_demo_` localhost database only, never the configured one.

## Report

Write `docs/superpowers/tasks/task-121c-report.md` (untracked): commits, files changed, the section 1 diagnosis table with true-drop vs false-positive classification, each change and why, eval results vs targets, titles + sketches with your critical read, repair-rescue statistics, what you could not verify, deviations. Do not push.
