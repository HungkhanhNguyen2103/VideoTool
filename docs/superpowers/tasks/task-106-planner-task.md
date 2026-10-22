# Task 106 — Video scenes must end up with a motion prompt (planner task file)

Spec (source of truth, do not edit): `Claude outputs/codex-prompt-task105-106-small-fixes.md`, section "Task 106". This file adds acceptance gates only.

Rules: work on `main` (no branch, no worktree), never push, stage only this task's hunks (never `git add -A`; check `git diff --cached --stat`), LF endings. Commit message exactly: `fix(script): require motion prompts for video scenes`. Do not touch Task 103 asset-upload code or Task 105 `shot-plan.ts`.

## Files likely touched
`src/server/modules/script/visual-prompts.ts`, `src/server/modules/script/ai/build-prompt.ts`, `ai/prompt-boundary.test.ts` and every test expecting `visual-prompt-v3`, `visual-prompts.test.ts` / `script.test.ts`, a new pure helper + test in `src/client/features/asset/` (style of `scene-activity-ui.ts`), `StudioPage.tsx` (notice before "Copy JSON" / "Export JSON"), `src/server/modules/script/MODULE.md`, asset/Studio doc if it describes the export control, AGENTS.md Status.

## Review gates
1. Prompt: system message says motionPrompt is REQUIRED non-empty for asset type video, empty for image; each scene block carries `Motion prompt required: yes|no`; `promptVersion` is `visual-prompt-v4/...`; grep proves no stale `visual-prompt-v3` remains in src or module docs (Status history lines in AGENTS.md may keep v3 as history).
2. Validation uses `AppError(..., 422, 'SCRIPT_PARSE_ERROR')` naming scene indexes so the EXISTING single retry path handles it (no second retry loop). It only checks video scenes whose STORED motionPrompt is empty (trim). Image scenes and already-filled video scenes are never required.
3. Fallback after the retry: named constant table keyed by `shotType` (all six shot types covered, test asserts each), fills only scenes whose stored motionPrompt is still empty, chapter is NOT added to `failedChapters`, other scenes in the chapter still saved, log `Scene N: motion prompt missing after retry; default used.`, final log contains `defaultMotionPrompts: n`. `VisualPromptJobResult` shape unchanged or only an optional field.
4. Existing stored motion prompts never overwritten; non-empty motionPrompt for image scene still ignored (stored empty).
5. Both the "retry fixes it" and "retry still empty" paths tested through `generateVisualPrompts` with mocked AI (assert call count 2 and logs). The mocked end-to-end run (2 chapters, 1 inactive scene, 1 prefilled scene, 2 video scenes with one missing motion prompt on the first answer) is run and the REAL log lines pasted in the report.
6. Studio: helper returns scene numbers (original numbering, 1-based) of ACTIVE video scenes with empty/whitespace motionPrompt; notice in Vietnamese ("Scene 136 là video nhưng chưa có motion prompt; Runner sẽ từ chối." — plural form for several scenes), shown before the copy/export buttons, export NOT disabled; existing notice component, no new tokens. Helper tests: active only, video only, whitespace, inactive ignored, none -> no notice.
7. Flow export JSON shape and Runner untouched.

## Verification to run and paste (real output)
`npm run typecheck`, `npm run lint`, `npx vitest run src/server/modules/script src/server/modules/asset src/client/features/asset` plus any other touched test files, `npm run build`, and full `npm test`. Use the installed MongoDB: `MONGOMS_SYSTEM_BINARY="C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe"` (the default download fails its MD5 check). Known pre-existing failure: `src/server/app.test.ts` SPA fallback — leave it. Browser check of the Studio notice: do it if feasible on a DISPOSABLE duplicate project only, otherwise mark "unverified".

## Report
`docs/superpowers/tasks/task-106-report.md` (untracked): commit, files, final rules, fallback table, verification with real counts, unverified items, deviations.

## Process
Post a plan of <=10 lines to @planner and wait for ACCEPTED before implementing; test-first.
