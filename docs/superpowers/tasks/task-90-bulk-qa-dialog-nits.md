# Task 90 (draft, optional): Bulk QA confirmation dialog nits

Found during real verification of Task 89 (evidence: data/files/.verification/task-89/notes.md, real-check9-confirm-1280.png / -390-viewport.png).

## Problem 1 (UX nit)
The confirmation dialog always shows the warning "Tái tạo có thể diễn đạt lại chương và sẽ đánh dấu chương tiếp theo cần xem lại." even when 0 chapters will be regenerated (manual regen mode, or automatic mode with only local patches).
Expected: show it only when regeneration chapters > 0 in automatic mode. Note: local patches also mark the next chapter upstream-changed (script/service.ts:54-56), so consider whether a separate, accurate line is wanted ("Sửa cục bộ sẽ đánh dấu chương kế tiếp cần xem lại") - ask the user if unsure about wording.

## Problem 2 (coverage gap, not a bug)
Live checks could not click the literal "Hoàn tác tất cả" button after a mixed (real regeneration) run or a cancelled run (undo state is session-only; the browser context had closed). Revision-prediction for undo after regeneration is covered only by unit/integration tests. Add (or confirm existing) test: undo enabled after batch with regen + cancel, and disabled after an interleaved write.

## Constraints
Client-only text/condition change in the review dialog; no schema/contract change; update focused client tests and AGENTS.md Status in the same commit; run typecheck, lint, test, build.
