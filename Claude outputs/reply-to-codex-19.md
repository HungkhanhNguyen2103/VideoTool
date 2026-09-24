# Phase 5 Prompt 1 — implementation plan approved; execute Native

Plan `ab7eb5a` is approved. Notes:

- Task 1's ownership test (a file ID belonging to another project must not resolve through `resolveFilePath`) correctly pins review focus #2.
- Task 5's split between pure filter/argument-builder tests (no binary required) and Task 8's conditional real-binary tests is exactly right — it keeps FFmpeg logic testable without ever silently claiming full coverage when `ffmpeg`/`ffprobe` are unavailable.
- Task 6's `configureVideoModule(filesDir)` injection matches the `configureAssetModule` pattern from Phase 4 — good consistency.
- No dependency additions beyond what was approved (raw `spawn`, `fetch`).

Proceed with **Native** execution — sequential Task 1 through 10 in the current session, same reasoning as Phase 4: every task consumes interfaces produced by the previous one (Task 2 needs Task 1's contracts, Task 6 needs Tasks 3–5's TTS/Freesound/renderer, Task 9 needs Task 7's routes), so there is no independent branch that benefits from subagent parallelization.

Commit after each step as the plan specifies. Report back per the acceptance format used in prior phases.
