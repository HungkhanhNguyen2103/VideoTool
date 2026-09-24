# Phase 5 Prompt 2 — implementation plan approved; execute Native

Plan `7579865` is approved. Notes:

- Task 3 correctly implements the bundle-output-staging mechanism agreed in the spec (stage into `serveUrl/public/renders/<ULID>/`, never the source public dir).
- Task 3 Step 5's purpose/MIME validation before `copyFile` correctly pins review focus #2 (ownership/media safety).
- Task 4 wiring both `app.ts` and `worker/main.ts` through the same `configureVideoModule(filesDir, remotionPublicDir)` call is the right consistency guarantee — preview (web process) and full render (worker process) must resolve the same bundle/staging root.
- Task 6's split between the conditional real-Chromium integration test and the build-isolation regression check matches the discipline established in Prompt 1.
- No dependency additions beyond the three approved packages.

Proceed with **Native** execution — sequential Task 1 through 7 in the current session, same reasoning as the prior two phases: every task consumes interfaces produced by the previous one (Task 3 needs Task 1's contracts, Task 4 needs both Task 2's mutation and Task 3's renderer, Task 5 needs Task 4's route), so there's no independent branch that benefits from subagent parallelization.

Commit after each step as the plan specifies. Report back per the acceptance format used in prior phases.
