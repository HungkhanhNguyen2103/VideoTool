# Task 95.2 — Consolidate everything on `main` and finish Task 95.1 directly on `main`

You are the coder. Claude (planner/reviewer) wrote this brief; Hung decides. Read `AGENTS.md` first and obey it (rule 11: update Status in the SAME commit as the code; never `git add -A`, stage explicit paths; keep each file's line endings, new files use LF; do not read or print `.env`). **Never push.**

Hung's decisions for this task: (1) from now on work happens directly on `main` — no feature branches, no extra worktrees; (2) treat Task 87 as complete — do not keep its changes out of the repo any more. Both override the older "branch per task" and "leave Task 87 out" instructions.

## Facts to verify first (Claude's last known state, not guaranteed)
- Main checkout `E:\ToolV2\ProjectHK\video-tool` was checked out on `codex/task-93-claude-cli-regen`, with a modified `src/server/modules/video/remotion.test.ts` and untracked files under `docs/superpowers/plans/`, `docs/superpowers/tasks/` and `Claude outputs/`.
- Branches are linear: `main` (`0d8fdbd`) → Task 93 (`71b4d6f`) → Task 94 (`036f892`) → Task 95.1 committed (`11d8bcd`, 3 commits `1aa8b8c`, `208f78f`, `11d8bcd`). `codex/task-95-1-config-ui-polish` therefore contains 93, 94 and 95.1.
- The Task 95.1 worktree `C:\Users\Admin\.codex\worktrees\task-95-1-config-ui-polish\video-tool` has 7 UNCOMMITTED files (ReviewScriptPage.tsx/.module.css/.test, StudioPage.tsx/.module.css/.test, AGENTS.md) that contain a flawed fix (see Part C).
Report any difference you find before acting on it.

## Part A — Task 87 (treat as done)
1. Inspect the dirty `remotion.test.ts` diff and the untracked plan/task files. Do not discard anything.
2. The known failure is `src/server/modules/video/remotion.test.ts:688` expecting a timing log of `2.40s`. Find out why it fails by reading the current logging code. If the test expectation is simply stale versus the intended logging, fix the expectation; if the code is wrong, stop and tell Hung instead of guessing.
3. Commit as separate commits with explicit paths: (a) the `remotion.test.ts` change, (b) the untracked `docs/superpowers/plans/*` and `docs/superpowers/tasks/` files as a docs commit (check them for secrets first). Leave `Claude outputs/` (planner prompt files) untracked unless Hung says otherwise. Update AGENTS.md Status to say Task 87 baseline is committed, with only what you verified.

## Part B — Bring everything onto `main`
1. Preserve the uncommitted Task 95.1 worktree changes first: save them as a patch file outside the repo (for example `git -C <worktree> diff > %TEMP%\task95-1-uncommitted.patch`) and keep a copy of the 7 files.
2. Switch the main checkout to `main` (carry nothing else), then merge `codex/task-95-1-config-ui-polish` with `--ff-only` (it should fast-forward if `main` is still `0d8fdbd`). If it cannot fast-forward, stop and report; do not rebase or force anything.
3. Run `git log --oneline -12` and confirm Tasks 93, 94 and 95.1 commits are on `main`.

## Part C — Finish Task 95.1 directly on `main`
Apply the preserved patch to `main` (or re-do it by hand), then fix all of the following. Hard rule from the original brief: UI only; keep every existing Vietnamese literal, `aria-label`, `id`, `htmlFor` and test hook.
1. Chapters box ("Kịch bản theo chương" on the Review page): keep using the shared `AiModelSelect` (`id="ai-model-select"`, `aria-label="Model AI"`, label "Model", options `label — hint`, e.g. "DeepSeek Chat — mặc định hiện tại"), or reproduce exactly those. The CLI model select must keep `id`/`htmlFor` `claude-cli-model` (the patch renamed it to `regen-model-select`; revert).
2. Manual mode: originally the Model field is hidden. Keep that, but reserve its space so the box height is identical in API, Claude CLI and Manual modes.
3. Studio control cards: independent desktop columns WITHOUT changing DOM/tab order (must stay scene, audio, video, render). Use CSS grid placement or multi-column, not `order` tricks. Verify tab order by keyboard at ≥1100 px and below.
4. Long CLI status/reason text must remain readable (full text via title or expandable), not clipped silently by `line-clamp`.
5. Replace source-string tests with at least one test asserting the preserved ids, aria-labels and the `label — hint` option text. Layout-class tests may stay as a supplement.
6. Commit with explicit paths and the AGENTS.md Status update in the same commit.

## Part D — Verification (real, saved)
Ask Hung (say so in your report) to start MongoDB, the API and Vite if they are not running; earlier browser/DB sessions were unavailable. Use a `[verify-task-95-1]` duplicate WITH chapters, never an original. At 1920×1080 (primary), 1440×900, 1280×900 and 390×844 save, under `data/files/.verification/task-95-1/`, full-quality captures of: the chapters box in API / Claude CLI / Manual modes, New Project "Cấu hình kịch bản", the Studio control area (FFmpeg and Remotion). Report measured chapters-box height and mode-row y-position per mode (they must be equal) and no horizontal overflow at 390. Tell Hung whether `[verify-task-95-1] Studio` is still on Remotion (reset: Studio → Giao diện video → FFmpeg).
Also close these Task 94/93 gaps if the environment allows: reconcile the test count (937 vs 932) with one real full-suite run on `main`; save screenshots of the progress dialog, error/resume state and CLI-unavailable state at 1920×1080 and 390×844.
Run `npm run typecheck`, `lint`, `test`, `build` on `main` after the final commit and report real counts (mention the `MONGOMS_SYSTEM_BINARY` workaround if you use it).

## Part E — Cleanup (ask first)
List `git worktree list` and the merged branches (`codex/task-9x*`, `codex/task-95-1*`). Do NOT delete anything yet: propose the exact `git worktree remove` / `git branch -d` commands and wait for Hung's OK.

## Report
Per part: what was done, commit hashes on `main`, real test counts, what is verified vs "unverified", anything you changed beyond this brief (should be nothing).
