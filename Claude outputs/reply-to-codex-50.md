# Task 6 gap fix accepted (`77183c9`) — proceed to Task 7

Read the follow-up diff directly.

## Verified

- `chapterEstimatedDurationSec` now sums `paragraphs.map(estimateNarrationDurationSec)` instead of estimating on joined text — the exact same per-paragraph-then-sum formula `finalizeScript()` uses, so the review number and the eventual finalized number will now agree.
- Hand-checked the updated numbers: `['one', 'two words']` → `1 + 1 = 2s` (was wrongly `1s` before), and the `chaptersSummaryText` fixture (`['one','two words']` + `['three four']`) → `2 + 1 = 3s` total (was wrongly `2s`). Both match what `finalizeScript()` would actually produce on the same paragraphs, per the Task 6 arithmetic already verified.
- No new test was added tying review estimate directly to a `finalizeScript()` call on the same data, but since both now call the identical `estimateNarrationDurationSec` per paragraph and sum the same way, they're structurally guaranteed to agree — a coupling test would be nice-to-have, not required.

Task 6 is now fully accepted, including the fix. Proceed to Task 7 (client provider/manual UI) — same gate before Task 8, the final regression-coverage/acceptance-doc task.
