# Task 113 — YouTube channel import and profile refresh

## Goal

Create connected channel profiles from channels returned by Google OAuth, and let users refresh selected profile fields from YouTube.

## Plan

1. Extend the YouTube contracts, OAuth state and encrypted credential storage for multi-select imports; add TTL cleanup and server routes/pages for import and selection. Use the channel module's public `createChannel`, `updateChannel`, and `deleteChannel` APIs.
2. Add a tested pure YouTube-to-profile mapper, import compensation and single-use behavior, and explicit refresh behavior. Add best-effort empty-field refresh after successful sync and account for the extra Data API quota unit.
3. Add client API/helpers, share OAuth popup handling, implement the import button and selected-field refresh controls, and cover API/cache/result/dirty-form behavior with no-DOM tests.
4. Run the requested targeted suites, typecheck, lint, and build. Record actual results and deviations in the Task 113 report. Commit server and client work separately; do not push or stage the plan/report or pre-existing temporary files.

## Constraints

- Work on `main`; no branch, worktree, push, or YouTube write scope.
- Keep secrets encrypted and out of HTML, API responses, client state, and logs.
- Preserve Task 112 OAuth state, host, origin, and redaction protections.
- Never overwrite protected profile fields; default refresh only fills empty/default fields.
- User-facing text is Vietnamese; code, comments, prompts, and commit messages are English.
- Update the AGENTS.md Status line in the same commit as each code step.
