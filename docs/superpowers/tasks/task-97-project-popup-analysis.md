# Task 97 — Project-wide AI popup analysis (planner notes for @coder)

Source of truth: `Claude outputs/mission-task97-project-popup-analysis.md` (read it fully; this file only adds planner decisions, a plan checklist and the report format). Do not stage `Claude outputs/`.

## Facts I verified at HEAD (use them, do not re-derive)
- Rule selection lives in `src/server/modules/video/keywords.ts`: `selectKeywordsWithSource` (digit tokens, `dateCandidate`, capitalised-name runs, `NAME_PREFIX_PHRASES`/`ROLE_PHRASES` heuristics, `orderedNameCandidates` = AI then rules). `selectProjectSceneKeywords` is consumed by `remotion-props.ts:88` and by `routes.ts` (`GET /:id/name-keywords/previews`) + Studio (`client/features/asset/name-keyword-ui.ts`, `StudioPage.tsx`).
- `resolveFilmLookByScene` takes keywords with `year`; today it is fed popup keywords (`remotion-props.ts:91`). A6 must give it its own year source.
- Current AI analysis: `name-keyword-service.ts` (`analyzeProjectNameKeywords`, `autoAnalyzeProjectNameKeywordsIfStale`), storage `scene.nameCandidates` (`contracts/project.ts:192`, `project/docs.ts:19`, freshness helper `contracts/name-keywords.ts`), writer `project.setProjectSceneNameCandidates`.
- **Boundary problem:** `eslint.config.js` ALLOWED has `video: [project, asset, job]` and `script: [project]`. `runClaudeCli`/`getClaudeCliStatus` live in `modules/script/cli-runner.ts`; video must NOT import script. That file imports only `config`, `shared/ids` and node builtins, so the clean fix is to move it (and its test + `fixtures/fake-claude-cli.mjs` if needed) to `src/server/shared/claude-cli/` and re-point script imports. No new ESLint exception. Say in the plan which files move; keep script behavior byte-identical (Tasks 93/94 tests must stay green).
- Schema changes are pre-approved by Hung through the mission spec: `projects.popupDensity` (default `low`, additive) and the per-scene popup plan record next to `nameCandidates`. Anything beyond that (e.g. a migration, deleting `nameCandidates`, new collection) → ask me first.

## Planner decisions (so the plan does not stall on them)
1. Popup plan is stored per scene (`scene.popupPlan`, zod in `contracts/project.ts` + `project/docs.ts`, defaulted `null` for legacy reads). Writes only through a project-owned function (one version increment, narration/audio snapshot guard like `setProjectSceneNameCandidates`). Pinned/suppressed flags live inside the same record and are carried over on re-analysis by `(sceneId, normalised anchor)`.
2. AI-shape schema (snake_case allowed) lives in `modules/video/ai/`-style files per AGENTS.md section 9 (`output-schema.ts`, `build-prompt.ts`, `parse-output.ts`); prompt text is data in `presets/*.md` with `id`+`version`, built dist copy handled like the SEO preset. Density wording is in the prompt only.
3. Number-word parser ("ba nghìn" → 3000, "hai triệu rưỡi" optional) is a small pure tested module; do not over-engineer: support units đơn vị/chục/trăm/nghìn/ngàn/triệu/tỷ, "rưỡi" optional.
4. Conversion AI popup → existing `Keyword`: `person|place` → `kind:'name'` + `nameRole` + `subtitle`; `event` → `kind:'name'` without role; `number|year|date` → their kinds through `enrichKeyword`. Remotion/`KeywordOverlay.tsx` must need no changes.
5. Dedupe: keep first-mention dedupe for names (`annotateNameKeywords`). Make sure the AI popup that gets dedup-dropped is shown in Studio as dropped with reason "đã hiện ở cảnh trước" (it is a safety-net-style drop and must be visible, not silent).
6. Auto-analysis after alignment: API backend only, only when no valid plan for eligible scenes. Never overwrite a plan produced explicitly by CLI with an automatic run if that plan is still fresh.
7. Chunking: pick a conservative scenes-per-call number from measured prompt size; chunks overlap by a few scenes for context only (a scene's verdict comes from the chunk where it is primary); the A4 safety net runs once over the merged project.
8. CLI model list: reuse the Task 93/94 Claude model registry/selector; Haiku first for real verification, then Sonnet if available.

## Plan checklist (what @reviewer and I will check before ACCEPTED)
The plan you post must list, concisely:
1. Files to add/move/change per part (A, B, C) and the shared/claude-cli move decision.
2. The zod shapes: AI output, stored `popupPlan`, `popupDensity`, API request/response contracts.
3. How verdicts for scenes with no popup are stored (needed=false + reason) so Studio can show them.
4. How A5 rule removal is done: list of functions/constants deleted vs kept (`parseNumberPhrase`, `enrichKeyword`, `annotateYearKeywords`, `nameKeywordDedupeKey`, `annotateNameKeywords`, timing constants). Confirm nothing in `selectProjectSceneKeywords` can emit a popup without a validated plan entry.
5. The A6 year detector: where it lives, what it reads (word timings only), how it feeds `resolveFilmLookByScene`.
6. Preview fingerprint change (find the render-time fingerprint code from Task 78; plan must include popup plan hash + `keywordPopupsEnabled`).
7. How the job is cancellable, how a failed run leaves the previous plan untouched, and the render guard against a running analysis job.
8. Test list mapped to the spec's Tests section (name test files).
9. Real-verification procedure, including how the duplicate project gets audio + word timings. Duplicates clear file references (decision 2026-09-22) — if the duplicate has no voiceover, you must run local VieNeu TTS + alignment on the duplicate (free, local, no paid API); tell me the scene count and expected time before starting. The original project is never modified.
10. Open questions, if any, as numbered items (I will route design trade-offs to Hung).

## Per-part acceptance (applies to A, B, C each)
- Commit only that part's hunks. `git diff --cached --stat` checked; staged state typechecks and focused tests pass. LF check: `git diff --stat` == `git diff --ignore-cr-at-eol --stat` before commit.
- AGENTS.md Status updated in the same commit (real counts only), plus `video/MODULE.md` (and `script/MODULE.md` if the CLI runner moved, `project/MODULE.md` for new fields). Nothing marked done unless a command verified it.
- Part A done = schema/validation/safety net/rule removal/film look/storage + tests; Part B = backends + job + routes + auto-analysis wiring + tests; Part C = Studio UI + tests, then the full real verification block of the spec (screenshots at exact sizes, PNG dimensions printed).
- Full gate at the end of each part: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` with real pass/fail counts. Known pre-existing noise: Vite chunk-size warning. Use the installed MongoDB 8.0 binary env (`MONGOMS_SYSTEM_BINARY`) if the default download fails its checksum, and say so.
- Max 3 fix rounds per part, then stop and tell me.

## Report format (after each part)
```
PART <A|B|C> REPORT
Commit: <sha> <subject>
Files: <count> changed (list grouped by module)
Gates: typecheck <pass/fail>; lint <pass/fail>; build <pass/fail>; tests <N passed / N failed / N skipped, files>
Focused tests: <names + counts>
LF check: <both stat outputs equal? yes/no>
Real verification done: <list with artifact paths>
Unverified: <list + reason>
Deviations from plan: <list or none>
```
For Part C add: popups/min before vs after (low/medium/high, API vs CLI), the three Hung cases ("3000 người"-like, "ngày xuất binh"-like, places) with before/after output, backend wall time and token/cost if available, and the PNG dimension printout.
