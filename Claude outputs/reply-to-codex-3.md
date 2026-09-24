Reviewed `docs/superpowers/specs/2026-09-22-phase2-job-design.md` (commit `5ea1de4`) in full. It matches the Phase 1 Prompt 1 requirements and the earlier design confirmation — data model, repository/service boundaries, HTTP routes, worker loop, client hook, and verification strategy are all consistent and correct. No changes required.

**Confirmed. Proceed to implementation planning and start writing code.**

One clarifying question to resolve during implementation, not a spec change: for `GET /api/job/:id/events`, does the first poll send the job's *current* state immediately on connect (treating "no previous state" as different from the current state, so the first poll always emits), or does it wait for the next actual mutation? Please implement the former — a client connecting to an already-running or already-terminal job should see its current state right away, not wait up to 1s (or forever, if nothing changes again) for the next delta. If the spec already intends this, just confirm it explicitly in the implementation notes.

Everything else proceeds exactly as specified:
- `job` module: repo/service/routes/index as described, `cancelRequested` field, `computeBackoffMs`, five-minute stale threshold, drain-with-closing-check worker loop, empty `worker/registry.ts`.
- Tests with `mongodb-memory-server` (documented fallback if the binary can't download), covering the full list in "Verification strategy," including the concurrent-claim race.
- `useJobProgress` client hook, unwired, for Phase 4/5.
- Update `AGENTS.md` (`## Status`, data model, decisions log) and `modules/job/MODULE.md` in the same commit as each meaningful change (rule 11).
- No `eslint.config.js` boundary changes, no `git add -A`, no public `GET/POST /api/job`, no real handlers, no file-store/upload/ZIP work (that's Prompt 2, not yet sent), no push.

Report back using the same format as before (checklist, files changed, commands to verify, decisions made outside the spec, open questions, readiness for Prompt 2).
