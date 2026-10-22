# Task 121c — Reliable idea yield

## Goal

Use the selected seeds efficiently, return honest partial results, and correct only validator false positives demonstrated by the four captured Task 121b runs.

## Required behavior

- Select up to `min(12, ceil(count * 2))` seeds and expand in batches of 3–4, at most three batches, until the requested count survives or the 240-second soft budget is reached. Later batches receive running diversity gaps.
- Make an expansion repair only when at least two rows have mechanical schema/format/claim errors, at most once per batch, and never after the soft budget. Judgment failures are dropped without repair.
- Return/save a partial run with one or more survivors and a Vietnamese status notice; zero survivors still fail with the run's leading drop reasons. Preserve dropped rows and legacy parsing.
- Exclude prior saved/rejected episode seeds from reruns. Version expand prompt revision 2; preserve untrusted-data boundaries and add a format-only abstract example and concise validator checklist.
- Improve only proven false positives: broad Vietnamese/English decision actions while rejecting the Swiss watch-industry trend and Nguyễn dynasty belief controls; ignore ordinary capitalized sentence openers while still requiring real names such as Đại Việt to be backed; recognize short acronyms and parent/child entities in trap links while retaining the Hạm đội Bắc Dương hunter-subject failure; allow evidence-backed period refinement and year/century equivalence.
- Print diagnostic replay/eval results below the survivor floor, including stages, per-rule drops, batches, repairs/rescues, elapsed time, and budget stop.
- Keep existing quality thresholds, trap evidence requirements, obscurity rules, and neutral-title checks unchanged.

## Acceptance

Run offline replay on the four captured Task 121b outputs before any new provider call. Correct the replay so v2 rows use the v2 validator and report actual repair rescues. Then run the requested four Sonnet 5.5 medium CLI evaluations, report all targets and misses, and run typecheck, lint, the touched and requested test sets, and build. Do not push. Keep prompts, reports, plans, and verification data unstaged.
