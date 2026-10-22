# Task 101 report — Deterministic shot and light plan

Date: 2026-10-16

## Commit and changed files

- Commit: `cc34db1 feat(script): deterministic shot and light plan for scene visual prompts`. No push.
- Contracts: `src/contracts/project.ts`, `src/contracts/project.test.ts`, `src/contracts/seo-format.test.ts`.
- Project persistence: `src/server/modules/project/docs.ts`, `service.ts`, `MODULE.md`.
- Script generation: `src/server/modules/script/shot-plan.ts`, `shot-plan.test.ts`, `visual-prompts.ts`, `visual-prompts.test.ts`, `ai/build-prompt.ts`, `ai/prompt-boundary.test.ts`, `MODULE.md`.
- Project map: `AGENTS.md` Status.

## Planner rules

The job plans once over all active scenes in project order. Chapter starts use the first active scene of each nonempty chapter. The first shot is wide. Every later shot avoids its immediate predecessor and, where possible, the shot two scenes back. Chapter starts prefer wide or high angle, then normalized English/Vietnamese narration cues prefer detail, wide/high angle, medium/close, or low angle. Neutral scenes use a fixed seven-position rotation. Light cues favor firelight, night, interior, golden hour, and overcast in that order; neutral scenes alternate daylight and overcast. A third identical light switches to a fixed alternative. Vietnamese accents are optional for cue matching; accented `nổ` and contextual unaccented `no` are distinguished from English “no.”

Visual prompt v3 includes explicit English shot/light phrases per scene. The scene fields default to null on legacy reads. The project writer stores both fields under the same active-and-empty-visual-prompt array filter as the new prompt. It does not overwrite the fields of prefilled, inactive, or concurrently edited scenes. A loose wording check logs warnings only; it does not retry or change result counts.

## Verification

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npx vitest run src/contracts src/server/modules/script src/server/modules/project --no-file-parallelism --maxWorkers=1` with installed MongoDB 8.0 binary: 30 files passed, 1 skipped; 411 tests passed (before the final cue edge-case additions).
- `npx vitest run src/server/modules/script/shot-plan.test.ts --no-file-parallelism --maxWorkers=1`: 37 passed after cue fixes.
- `npm run build`: passed; Vite retains its informational >500 kB chunk warning.
- Final `npx vitest run --no-file-parallelism --maxWorkers=1` with installed MongoDB 8.0 binary: 99 files passed, 1 skipped; 1153 tests passed. An earlier full run overlapped cue edits and loaded stale planner code; it was superseded by this final run.

## Gaps and deviation

The existing visual-prompt job includes filled visual scenes in chapter AI batches whenever their SFX or motion prompt needs backfilling. Their visual prompt and shot/light fields remain unchanged. The brief describes filled scenes as absent from AI calls; enforcing that literally would remove the existing SFX/motion backfill behavior, so this implementation preserves that behavior and treats “only empty scenes are written” as the visual prompt and plan-field write rule.

No real provider call was made. The optional live call was omitted because provider usage and cost were not verified; the mocked two-chapter job covers one inactive scene, one prefilled scene, plan persistence, and compliant/noncompliant wording logs.
