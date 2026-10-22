# Task 121b — Claude CLI defaults (Sonnet 5.5, medium effort) for every CLI caller, then finish Task 121 (evals, report, UI check)

Work directly on `main` (no feature branch, no worktree). Never push. Do not stage temp files (`.env`, `.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`, `docs/superpowers/plans/*`, the stray `01M4W…` files in the repo root, `data/files/.verification`). Keep LF line endings in commits (`git diff --stat` must show only the lines you changed; normalise `AGENTS.md` if a tool wrote CRLF). Follow AGENTS.md (rule 11: Status line in the same commit; import through each module's `index.ts`; CSS Modules + design tokens only). Code, comments and commit messages are English; user-facing text is Vietnamese. First check `git status` and `git log -8`: Task 121 already has commits `ebc84c4`, `53d3b14`, `38738db`; do not redo them, build on them. Small/medium task. Two commits: `feat(claude-cli): default to Sonnet 5.5 with medium effort` and, if anything changes after the evals, `fix(youtube): Task 121 eval findings` (skip the second commit if there is nothing to change).

## Why

Hung wants **every Claude CLI call in the tool** to default to **Sonnet 5.5 at medium effort** (the earlier runs used `claude-opus-4-5`, the registry default, and were slow: Task 118 channel review ~9 min, Task 120 ideas 7m38s). Real CLI **test runs** must use **Sonnet 5.5 medium**, or **Haiku 5.5 medium** when only a cheap smoke test is needed (quota is limited: Claude Code hit its session limit during Task 121). After that, finish the outstanding Task 121 work: the post-fix evals, the final report, and the UI check.

## Part A — CLI defaults (do this first)

### A1. Verify before coding (report what you found)
Run `claude --help` (and `claude --version`) on this machine and read how the installed CLI selects **model** and **effort/thinking level**: the exact flag or setting name and accepted values for "medium" effort (for example an `--effort` flag, an environment variable such as `CLAUDE_CODE_EFFORT_LEVEL`, or a settings key), and the exact model ids it accepts for Sonnet 5.5 and Haiku 5.5. Do not guess: if the installed CLI has no way to set effort per invocation, say so and implement the best supported mechanism (env var or `--settings` JSON) or, if none exists, record the limitation and keep model-only defaults. Also verify with one tiny real call (`"Reply with the single word OK."`, Haiku 5.5, medium) that the chosen args are accepted, and show the exact argv you used (no secrets).

### A2. One place for the defaults
In `src/server/shared/claude-cli/` (the code that builds `cliArgs(model?)` in `cli-runner.ts`):
- Export constants `CLAUDE_CLI_DEFAULT_MODEL = 'claude-sonnet-5-5'` and `CLAUDE_CLI_DEFAULT_EFFORT = 'medium'` (types: effort is a union of the values the CLI accepts, as verified in A1), with a comment that these are product defaults requested by Hung, not Anthropic recommendations.
- `runClaudeCli` / `createClaudeCliChat` take optional `model` and `effort`; when omitted they use the defaults. An explicit `model` still wins; `effort` is always passed (default `medium`) when the CLI supports it.
- Do **not** change `AI_MODEL_REGISTRY.claude.defaultModelId` (that is the API path's default and affects stored project settings); the CLI default is a separate constant. If `claude-haiku-5-5` is missing from `AI_MODEL_REGISTRY.claude.models`, add it (label "Claude Haiku 5.5", hint "rẻ", capabilities consistent with the other entries and the verified id) so `isAiModelForProvider('claude', 'claude-haiku-5-5')` accepts it; keep existing entries untouched.

### A3. Apply to every CLI caller (no stragglers)
Find all callers with `grep` for `runClaudeCli`, `createClaudeCliChat`, `createClaudeCliScriptBackend`, `getClaudeCliStatus` consumers: script chapter regeneration (`script/cli-script-backend.ts`, `cli-regenerate-handler.ts`), popup analysis (`video/popup-analysis-service.ts`), SEO generation (`seo/service.ts`), YouTube review (Task 118) and video ideas (Task 120/121 — `IDEA_DEFAULT_CLI_MODEL` now points at `CLAUDE_CLI_DEFAULT_MODEL`, remove duplication). Each must fall back to the shared defaults when the request has no `cliModel`. Client side: every CLI model picker (`PopupAnalysisCard`, SEO toolbar, review panel, ideas panel, script regenerate if it has one) must preselect `CLAUDE_CLI_DEFAULT_MODEL` rather than the registry default; share one exported constant/helper from `src/contracts` so the client does not import server code. The picker shows the effort as a muted label "Mức suy luận: medium" (read-only; no new setting UI in this task).
- The audit log line for each call must include the resolved model and effort (no prompt text) so a reader can see which one ran; the existing job logs already print the call line, extend it.
- `getClaudeCliStatus` output is unchanged except it may expose `defaultModel`/`defaultEffort` for the UI to show.

### A4. Tests (fake runner, no real CLI)
Args builder: default model + effort when none given; explicit model overrides, effort still medium; Haiku 5.5 accepted by the registry guard; unknown model still rejected (422 paths in routes unchanged); every caller listed in A3 resolves to the default when `cliModel` is absent (table-driven test per caller); client default-selection helper returns the CLI default, not the registry default; log line includes model and effort; if A1 found no effort mechanism, a test documents the fallback. Existing tests must keep passing.

### A5. Docs and Status
Update `src/server/shared/claude-cli/MODULE.md` (defaults, effort mechanism and how it was verified, how to override), the SEO / script / youtube MODULE.md lines that mention the CLI model default, and the AGENTS.md Status line.

## Part B — Finish Task 121 (after Part A is committed)

Read `docs/superpowers/tasks/task-121-report.md` and the plan `docs/superpowers/plans/2026-10-22-task-121-idea-quality.md` for what is done. Then:

1. **Real evals on the corrected code** with the new defaults. Use `npm run eval:youtube-ideas` against a fresh isolated demo database (`youtube_demo_` prefix, localhost only; verify the database name before running, never touch the configured database). Do **two runs for each steering** (Vietnamese history "lịch sử Việt Nam, ít người biết, hubris-trap" and world history "lịch sử thế giới (quân sự, kinh tế, công nghệ), hubris-trap"). Model: **Sonnet 5.5 medium** for the acceptance runs (the quality numbers must come from the production default). If quota is tight you may run one Haiku 5.5 medium smoke run first to catch crashes, but report it separately and never use Haiku numbers as acceptance evidence. State the model and effort printed by the logs for every run. If the CLI reports a session limit again, stop, report exactly which runs finished, and give Hung the PowerShell commands for the rest.
2. **Compare against the targets** from Task 121 (≥ 4 of 6 final ideas with `blindSpot` ≥ partial by the model's own rating; ≥ 3 distinct `hunterArchetype` values with ≤ 2 per archetype; no `famous` guess under obscure steering; total time ≤ 5 minutes; zero unbacked numbers/names; ≤ 1 repair call per stage). Report real numbers per run, the stage durations, the audit folder paths, and say which targets were missed and why. Do not tune validators to pass; at most two prompt iterations, each re-measured.
3. **Titles and sketches**: print all final titles with their `trapSketch` lines for every run and give your own critical read (which look generic, too broad, likely wrong, or not "ít người biết"). Do not claim any historical fact is true.
4. **UI check** of the ideas panel and cards at 1920×1080, 1366×768 and ~900 px, using whatever browser tool you have; if you cannot capture it, say so plainly and give Hung the manual steps.
5. **Close-out**: make sure `docs/superpowers/tasks/task-121-report.md` is complete (add a "Part B results" section with the numbers above and a "Task 121b" section for Part A), confirm the Task 121 AGENTS.md Status line exists and is LF, and run the full verification below.

## Out of scope

Changing the API-path default model or `AI_MODEL_REGISTRY.claude.defaultModelId`, new effort settings UI, changing prompts beyond what a re-measured eval justifies, other presets, any push.

## Verification (run and report real output)

`npm run typecheck`, `npm run lint`, the new and touched vitest files plus `src/server/shared/claude-cli`, `src/server/modules/youtube`, `src/server/modules/seo`, `src/server/modules/script`, `src/server/modules/video`, `src/client/features/youtube`, `src/client/features/seo`, `src/contracts`, and `npm run build` (reuse the local Mongo workaround if needed and say so). Paste the argv of the real CLI calls (model + effort only), the eval tables, and the final `git log --oneline -8` and `git status --short` (tracked files must be clean).

## Report

Update `docs/superpowers/tasks/task-121-report.md` (untracked) as described; also write a short `docs/superpowers/tasks/task-121b-report.md` (untracked): what A1 found about effort flags and model ids, files changed, callers updated, tests, verification output, what you could not verify, deviations. Do not push.
