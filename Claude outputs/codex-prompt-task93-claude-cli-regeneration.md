# Task 93 — "Claude CLI" mode for chapter regeneration (Review & Tái Tạo)

You are the coder. Claude (planner/reviewer) wrote this brief; Hung decides. Read `AGENTS.md` first and obey it (rule 11: update the Status section in the SAME commit; never `git add -A`; keep each file's line endings, new files use LF; do not read or print `.env`; never push). Start from `main` (HEAD `0d8fdbd` or later) on a new branch `codex/task-93-claude-cli-regen`. The dirty `src/server/modules/video/remotion.test.ts` and the untracked plan files belong to Task 87 — leave them out of every commit.

## Goal
Today, chapter regeneration has two modes: **Tự động** (server calls the Anthropic/DeepSeek API with a key from `.env`) and **Thủ công (JSON)** (user copies the prompt, pastes it into some AI, pastes the JSON back). Hung wants a third way that automates the manual loop using the **Claude Code CLI installed on his own machine** (his subscription, no API key):

1. Build the exact same regeneration prompt the manual mode builds (`buildRegenerationPromptForChapter` → `SYSTEM … USER …`).
2. Write it to a prompt file, run the CLI non-interactively with that prompt, and capture the CLI's answer into an output file.
3. Read that output file and feed it into the SAME import path as manual mode (`parseRegeneratedParagraphs` → `applyRegeneratedChapter`, snapshot/history, upstream-changed marker, quality summary). Nothing about validation or persistence may fork from manual import.

## Decisions already made (change only if you find a real blocker, and say so)
- **Not a new `AiProvider`.** Do not touch `AI_PROVIDERS`, `ai-models.ts` provider keys, or the project schema. It is a third *regeneration mode* (`'cli'`) next to `'automatic' | 'manual'`, client + server.
- **Scope = per-chapter regeneration only** (the "Tái tạo" button on a chapter, and "Tái tạo chương đã chọn" / "Tái tạo toàn bộ" run sequentially from the lowest chapter index, because later chapters depend on earlier ones). QA, outline, and chapter writing stay as they are; list them in the final report as follow-ups.
- **Capture stdout, then write the file ourselves.** Do not ask the CLI to write the file with its own tools (fragile, needs tool permissions). Layout: `data/files/<projectId>/cli-runs/<runId>/prompt.md`, `output.txt`, `meta.json` (command shape without the prompt, model, exit code, duration, byte sizes, chapterId). Keep them for audit; the folder is already gitignored under `data/files`. Add a simple retention rule (e.g. keep the last 20 runs per project) so the folder cannot grow forever.
- **It is a job**, per AGENTS.md ("long/failing work is always a job"). Follow the Task 89 bulk-QA pattern: enqueue → worker handler → per-chapter progress + logs → cooperative cancel → shared blocking progress dialog (Task 76). Cancel must kill the child process (on Windows kill the whole tree).

## Server requirements
1. New module-local code in `modules/script/` (e.g. `cli-runner.ts` for process spawning, `cli-regenerate-handler.ts` for the job). Keep the dependency direction `script → project`. Register the handler explicitly in `worker/registry.ts` and the route in `routes.ts` (thin).
2. Routes: `GET /api/script/cli-status`-style availability check (resolve the executable, run `--version` with a short timeout, return `{available, version?, reason?}`) and `POST /api/project/:id/chapters/regenerate/cli` → 201 `{ jobId }` with `{ chapterIds: string[], instruction, level, model? }` validated by a zod schema in `contracts/script.ts`. Reuse the existing `ManualRegeneratePromptSchema` fields for instruction/level.
3. **Spawning rules (important):**
   - Pass the prompt via **stdin**, never as a command-line argument (Windows ~8k limit, quoting, and secrets in process lists).
   - `spawn` with an args array and `shell: false`. On Windows the CLI may be a `.cmd` shim — resolve it and handle that without opening a shell-injection hole (no string-concatenated command lines).
   - Run with `cwd` set to a fresh empty temp/run directory, NOT the repo, so the CLI does not load this repo's `AGENTS.md`/CLAUDE.md/settings and cannot touch project files.
   - Single turn, no tools, no session persistence, plain-text or JSON result output. **Do not guess flag names** — run `claude --help` on the machine and use what actually exists (print mode, model selection, disabling tools, max turns, output format, session persistence). Record the flags you chose and the CLI version in `MODULE.md`.
   - Config in `config.ts`/`.env.example`: `CLAUDE_CLI_PATH` (default `claude`), `CLAUDE_CLI_TIMEOUT_MS` (default generous, e.g. 600000), `CLAUDE_CLI_MAX_OUTPUT_BYTES`. Never log the prompt body or the full output at info level (log sizes, durations, exit codes).
   - If `ANTHROPIC_API_KEY` is set in the environment the CLI may bill the API instead of the subscription. Do not silently strip it, but report in the status response and UI which auth path is likely in use if you can detect it cheaply; otherwise just document it.
   - Treat stdout as untrusted text: size cap, strip a leading/trailing JSON markdown fence only through the existing tolerant parser (do not write a second parser).
4. Failure handling per chapter: timeout, non-zero exit, empty output, rate-limit/auth message, parse error → mark that chapter failed with a Vietnamese message, keep the raw output file, **stop the batch** (later chapters would lose continuity), leave already-applied chapters in place with their history snapshots. One automatic retry only for malformed JSON (same rule as automatic mode), not for CLI/auth errors.
5. Model: accept an optional model id from the existing `claude` registry list and map it to whatever `--model` accepts; if the CLI rejects it, surface the error. If omitted, let the CLI use its own default.
6. Persist nothing new on the project besides what manual import already writes. If `reviewedBy`/history metadata records the source, use a distinct label such as provider `'claude-cli'` only where the schema already allows free labels; do not widen persisted enums without a migration decision — ask Hung instead.

## Client requirements (Vietnamese UI copy, keep existing literals and ARIA labels)
- Regeneration mode radio becomes: `Tự động (API)` / `Claude CLI (máy này)` / `Thủ công (JSON)`. The CLI option is disabled with a clear reason when `cli-status` says unavailable.
- In CLI mode the per-chapter button reads `Tái tạo bằng Claude CLI`; selected/all buttons are enabled and run sequentially. Use the shared blocking progress dialog with per-chapter progress, elapsed time, and a confirmed cancel. Show where the run files are (`data/files/<projectId>/cli-runs/<runId>`) in the job log/result.
- Reuse existing success handling (toasts, undo for first run, upstream badges). Responsive checks at 1280×900 and 390×844.

## Tests (no real CLI, no network in automated tests)
- A fake CLI: a tiny Node script used via `CLAUDE_CLI_PATH`/injected spawner that can (a) return valid regenerated JSON, (b) return fenced JSON, (c) return garbage, (d) hang until killed, (e) exit non-zero with a rate-limit message, (f) emit oversized output.
- Cover: prompt equals the manual prompt byte-for-byte; stdin delivery; files written; success path applies via the SAME function as manual import; sequential order and batch stop on failure; cancel kills the child and writes nothing for the in-flight chapter; timeout; availability check; client mode gating.
- Existing suites must stay green except the known `app.test.ts` SPA-fallback failure (report exact numbers).

## Real verification (on a `[verify-task-93]` duplicate, never the original)
Run one real chapter regeneration through the actual CLI on Hung's machine (needs the CLI installed and logged in; if it is not, say so and stop at the fake-CLI evidence — do not claim it verified). Capture: the run folder contents (prompt/output/meta), before/after chapter text, history snapshot, a 3-chapter sequential run, a cancel mid-run, and screenshots of the new mode, progress dialog and error state at both viewports. Report real duration per chapter.

## Done when
`npm run typecheck`, `lint`, `test` (real numbers), `build` pass; `MODULE.md` + AGENTS.md Status updated in the same commit(s); final report lists what was verified for real, what was only faked, flags/CLI version used, and proposed follow-ups (QA via CLI, outline/chapter writing via CLI, token/cost visibility). Use 2–3 commits: (1) runner + config + tests, (2) job/routes + tests, (3) client + docs/Status.
