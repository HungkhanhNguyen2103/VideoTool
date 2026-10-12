# Mission: REAL verification of Task 89 (bulk "Áp dụng tất cả" QA)

Branch: codex/task-89-qa-bulk (commit 23dfb10). Stay on it. Verification only: NO production code edits, NO commits, NO merge/push.
Leave uncommitted Task 87 work (remotion.test.ts, plans/) untouched.
Spec: docs/superpowers/plans/2026-10-08-task-89-qa-bulk-apply.md

## Safety
- NEVER touch the original Rạch Gầm project. Use "Nhân bản dự án"; name every duplicate "[verify-task-89] ...". Delete nothing; leave duplicates.
- Do not open/print .env. Report only key PRESENCE.
- Paid AI: automatic regeneration allowed ONLY for the two chapters in check 4 (plus the one in check 5 if it is one of those runs' chapters; if it needs a third regen, ask me first). Everything else must be zero-cost: use manual QA import.
- API (3000), MongoDB, Vite (5173) unreachable -> say so in the feed and STOP. Never fabricate results/screenshots.
- Regen fails (missing key/provider error) -> record, mark regen parts UNVERIFIED.

## Evidence dir
data/files/.verification/task-89/  (screenshots named real-*.png, QA JSON used, a notes.md with raw numbers)

## Checks (report PASS / FAIL / UNVERIFIED each, with exact numbers, file paths, reasons)
0. Environment: API, MongoDB, Vite reachable; AI provider/key presence (not value). Create duplicate #1.
1. Hand-build realistic QA JSON from VERBATIM quotes of real chapters; import via manual QA import into duplicate #1. >=2 high, >=2 medium, >=2 low; >=3 patchable (quote+replacement) across 2 chapters, two in the same chapter; 2 needing AI regen in 2 different chapters; 1 REVIEW_FACT; 1 ambiguous/missing quote. Save JSON.
2. Counts: for each of the 3 menu options record menu count, confirmation-dialog numbers, and what the planner logic predicts; they must agree. Cancel in dialog changes nothing (verify project version + history unchanged).
3. Local patches only (option 1 on a duplicate where high issues are patchable, or dismiss AI-needed ones): paragraphs changed exactly per replacements, issues accepted, history +exactly 1 snapshot, QA marked stale.
4. Mixed run (option 2 or 3, fresh duplicate): patches + <=2 auto regens; ascending chapter order, progress "chương k/n", next chapter after a regenerated one flagged needs-review, REVIEW_FACT and ambiguous-quote skipped with reasons shown, history +exactly 1.
5. Cancel mid-stream during a regeneration: stream stops, applied changes stay, later chapters untouched, summary accurate.
6. Undo ("Hoàn tác tất cả" + confirm) after 3 or 4: every affected chapter text == original duplicate text; history sane after.
7. History cap: duplicate near 10-snapshot cap; dialog warns oldest snapshot evicted; after run other versions intact except evicted oldest.
8. Manual regen mode: only local patches run; AI-needed issues listed skipped with reason.
9. Screenshots (explicit viewport >=1280 and ~390): split control + open menu, confirm dialog (+eviction warning), progress dialog, result summary. Keyboard: open menu by keyboard, Escape closes, focus returns sensibly.
10. Run and report real counts: npm run typecheck, lint, test (expected only remotion.test.ts:688 fails), build.

## Report format (English, to @planner in the feed)
Per check: `N. PASS|FAIL|UNVERIFIED — numbers — evidence paths — reason`. For FAIL: exact repro steps, expected vs actual. Finish with a summary table.
