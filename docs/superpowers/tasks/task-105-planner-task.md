# Task 105 — Vietnamese cue matching in shot-plan.ts (planner task file)

Spec (read fully, do not edit): `Claude outputs/codex-prompt-task105-106-small-fixes.md`, section "Task 105". This file only adds the acceptance gates; the spec is the source of truth.

Branch rule override from the mission: work directly on `main`, no branch, no worktree, never push. Commit message exactly: `fix(script): match Vietnamese shot and light cues without accent collisions`.

## Scope
- `src/server/modules/script/shot-plan.ts`, `shot-plan.test.ts`, `src/server/modules/script/MODULE.md`, AGENTS.md Status line. Nothing else. Do not touch Task 103 asset-upload code.
- Only HOW cues are matched changes. Shot rules, light rules, rotation, first-scene `wide`, chapter-start rules, `LIGHT_ALTERNATIVE` stay as they are.

## Review gates (I will check these in the diff)
1. No `\b` left for Vietnamese cues; Unicode boundaries `(?<![\p{L}\p{M}])…(?![\p{L}\p{M}])` with `u` flag. Text is NFC-normalized + `toLowerCase()`; cue literals in the table are also NFC (watch for NFD literals typed from the spec — add a test that every cue string equals its own `.normalize('NFC')`).
2. One readable cue table; the accent-less fallback list is a separate, clearly named constant with the comment explaining the collision rule. Colliding words (`duoc dem toi trang phong ham hop lua chay mua may`) are absent from it as standalone cues.
3. Diacritic detection regex covers all Vietnamese accented letters including `đ`/`Đ`; test with a text that has one diacritic and otherwise accent-less colliding words (must use the accented path, so "toi" alone must NOT match there).
4. Multi-word cues match only as whole phrases (test a near-miss for at least 3 of them).
5. Test list from the spec is complete: every false-positive word asserted individually, every true-positive group, accent-less cases, English unchanged, the 10-sentence realistic paragraph (only the "đêm" scene gets `night`), existing tests still pass.
6. Report in `docs/superpowers/tasks/task-105-report.md` states: stored plans of existing projects are NOT recomputed.

## Verification to run and paste (real output)
`npm run typecheck`, `npm run lint`, `npx vitest run src/server/modules/script src/server/modules/asset src/client/features/asset` (Task 102 referenceTags tests are in asset), `npm run build`. Known pre-existing failure: `src/server/app.test.ts` SPA fallback — leave it.

## Process
Post a plan of ≤10 lines to @planner first and wait for ACCEPTED. Then implement test-first, commit only this task's hunks (never `git add -A`; check `git diff --cached --stat`), and report.
