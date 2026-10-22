# Task 115 — SEO generation progress and logs, plus layout fixes for the SEO toolbar and the channel manager dialog

Work directly on `main` (no feature branch, no worktree). Never push. Do not stage temp files (`.env`, `.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`, `docs/superpowers/plans/*`, the stray `01M4W…` files in the repo root). Keep LF line endings in commits. Follow AGENTS.md (rule 11: Status line in the same commit; import through each module's `index.ts`; CSS Modules + design tokens only, no new colors). Code, comments and commit messages are English; user-facing text is Vietnamese. Primary viewport 1920×1080; also check 1366×768 and a ~900 px wide window. Small task: short untracked plan, no design-approval round. Two commits: `feat(seo): step progress, logs and cancel for SEO generation` and `fix(ui): relayout SEO toolbar and channel manager header`.

## Why (real observation by Hung, 2026-10-22)

He started SEO generation with the Claude CLI backend (Task 114). The first CLI call (main sections) finished in 46 s, then the second call (Shorts) ran for more than 3 minutes. The page showed "Đang tạo gói SEO… 0%" the whole time, with no log and no sign that the CLI was alive or at which step. Cause: `generateSeoPackage` (`src/server/modules/seo/service.ts`) calls `context.reportProgress` once at the very end (100) and `appendLog` only on a JSON retry; `SeoPage.tsx` renders only `progress.progress` and ignores `progress.logs`. He wants to see progress and logs. Two screenshots also show cramped layouts to fix (sections 3 and 4).

## What exists (reuse, do not duplicate)

- `JobContext` (`src/server/modules/job/service.ts`): `reportProgress(pct, result?)`, `appendLog(message)`, `isCancelled()`.
- Client: `useJobProgress(jobId)` (`src/client/shared/hooks/use-job-progress.ts`) already streams `status`, `progress`, `error`, `logs[]` and `lastEventAt` (heartbeat); `cancelJob(jobId)` in `src/client/shared/job-api.ts`; `StudioPage.tsx` line ~811 shows how another page renders the log list. `SeoPage.tsx` line ~217 is the current one-line progress bar.
- CLI backend from Task 114 (shared wrapper in `src/server/shared/claude-cli/`), audit folder path is already logged per call.

## 1. Server: step-aware progress and logs (API and CLI paths)

In `generateSeoPackage` build an explicit ordered step list from what is requested: `main` (when any non-Shorts section) and `shorts` (when requested and windows exist). Total steps N; step i of N.
- Progress: 5 at start; each step owns an equal slice of 5–95; report the slice start when a step begins and the slice end when it finishes; 100 after the save (as today). With a single step the bar goes 5 → 95 → 100.
- Log lines (Vietnamese, one per event, no secrets, no prompt text):
  - `Bắt đầu tạo gói SEO: <n> bước (<danh sách phần>). Cách sinh: API <model> | Claude CLI <model>.`
  - `Bước i/N — <tên bước>: gửi yêu cầu (<promptBytes> byte).`
  - `Bước i/N — <tên bước>: nhận phản hồi sau <mm:ss> (<outputBytes> byte).`
  - `Bước i/N — <tên bước>: JSON chưa hợp lệ, thử lại 1 lần: <reason>` (replace the existing English retry log; keep the content).
  - `Bước i/N — <tên bước>: xong.` and finally `Đã lưu gói SEO. Tổng thời gian <mm:ss>.`
  - For the CLI backend also log the audit folder path once per call (already logged by Task 114: keep one line, do not duplicate).
- **Heartbeat while waiting**: during an API or CLI request log `Bước i/N — <tên bước>: vẫn đang chờ (<mm:ss>)…` every 30 s (timer cleared in `finally`, never outlives the call, no log spam after cancel). Check how `appendJobLog` stores lines (any cap on the number or total size of log entries, MongoDB document limit) and keep the heartbeat within it; if there is no cap, cap SEO heartbeat lines at 20 per step and say so in the report.
- Cancellation still works (existing behavior); on cancel log `Đã hủy ở bước i/N.` once.
- Failures: the thrown `AppError` message already reaches `progress.error`; additionally log `Bước i/N — <tên bước>: thất bại — <message>` before rethrowing.
- Do not change prompts, parsing, saved data or the API path's behavior other than these logs/progress calls. Keep the injectable-backend signature from Task 114.
- Tests (extend `seo-ai.test.ts`): progress values and log lines for main only, main + Shorts, Shorts only; retry log; failure log; heartbeat with fake timers (fires every 30 s, stops after the call, stops on cancel, respects the per-step cap); cancellation log; the existing assertions still pass.

## 2. Client: show progress, step, elapsed time, logs, cancel

In `SeoPage.tsx` replace the one-line bar with a small `GenerationProgress` component (new file under `features/seo/components/`, with a CSS module reusing existing tokens):
- Header: current step text (derive from the last `Bước i/N …` log line with a small pure helper, tested; fallback "Đang tạo gói SEO…"), percent, `<progress>`.
- **Elapsed timer** computed from the job start (first log or when the job id was set) ticking each second in the component, shown `mm:ss`.
- **Log list**: last 10 lines, newest at the bottom, monospace-ish using existing tokens, collapsible ("Xem log" / "Ẩn log", default expanded while running), auto-scroll only if the user has not scrolled up.
- **Liveness**: use `lastEventAt` from `useJobProgress`; if no event for > 45 s show "Chưa có tín hiệu mới từ server (Xs). Claude CLI có thể đang chạy lâu." in the warning style; if the job has been in one step > 3 minutes (derive from log timestamps on the client, i.e. record the time each log line arrived) show "Bước này đang chạy lâu hơn bình thường." Both are informational; no auto-cancel.
- **Hủy** button calling `cancelJob(jobId)` (disable while the request is in flight, confirm toast "Đã gửi yêu cầu hủy"), hidden when the job is finished.
- On done/failed/cancelled keep the panel visible with the final line and the last log lines until the user dismisses it ("Đóng"), instead of vanishing; keep the existing toasts.
- Pure helpers in a `seo-generation-progress.ts` with tests: step parsing, elapsed formatting, liveness state, log windowing. No-DOM test style like the rest of the repo.

## 3. Layout fix: SEO toolbar (screenshot 1, `Toolbar.tsx` + `SeoPage.module.css`)

Current problems: controls, the CLI note and the right-aligned "Sinh bằng Claude Code CLI" text sit on separate wrapped lines with large gaps; the hint repeats information; the primary button is vertically misaligned with the selects.
Required (use CSS grid/flex, existing tokens, no behavior change):
- **Row 1**: `Chế độ` | `Cách sinh` | `AI` (API only) | model select (flexible, takes the remaining width, label above) | primary button "Tạo toàn bộ gói" aligned to the bottom edge of the selects. Field labels use the stacked label-above-control pattern consistently (today "Chế độ"/"Cách sinh" are inline while the model select is stacked).
- **Row 2** (one line, muted, left aligned): the CLI note and any CLI-unavailable reason, wrapped nicely; remove the right-aligned `providerHint` when the CLI note or a provider is already visible in row 1 — keep it only for manual mode ("Tự dán JSON từ AI bất kỳ").
- Manual mode row: buttons "Sao chép prompt", "Nhập JSON" and the section counter aligned in the same row, no leftover empty space.
- No wrapping surprises at 1366 px: below ~900 px the model select goes to its own full-width row and the button stays on the right of its row.

## 4. Layout fix: channel manager dialog header and list column (screenshot 2, `ChannelManagerDialog.tsx` + `.module.css`)

Current problems: in the left "Kênh đã lưu" column the title is squeezed into two lines ("Kênh / đã lưu"), the two action buttons and a long help sentence are stacked to its right in a very narrow column, and the first channel card starts far below.
Required:
- Give the list column more width (for example `minmax(20rem, .9fr)`), keep the editor usable at 1050 px and at ~900 px (stack columns below 900 px as today).
- Panel header becomes two rows: row 1 the title "Kênh đã lưu" on one line; row 2 the actions as two equal buttons side by side, full column width: "Tạo kênh" (secondary) and "Thêm kênh từ YouTube" (amber).
- The help sentence ("Google quyết định kênh nào được liệt kê…") moves below the buttons as a full-width muted paragraph, left aligned, readable size (`.75rem`), or into a small "?" disclosure; the setup-missing message and error states use the same slot.
- Channel cards start right under the header with consistent spacing. The notice and error lines span the column width.
- Verify at 1920×1080, 1366×768 and 900 px, both with zero channels and with several channels.

## Out of scope

Changing prompts or what SEO generates, adding steps, streaming the model's partial output, auto-cancelling slow runs, changing the YouTube/analytics code, other pages' progress UIs, and any new design tokens.

## Verification (run and report real output)

`npm run typecheck`, `npm run lint`, new and touched vitest files plus `src/server/modules/seo`, `src/client/features/seo`, `src/client/features/channel`, `src/client/shared`, and `npm run build` (reuse the local Mongo workaround from earlier tasks if needed and say so). A real run: generate a SEO package on a disposable duplicate project with the Claude CLI backend and, if available, with the API, and paste the real log lines and the progress values observed; verify cancel mid-run. Take screenshots of the toolbar and the dialog at the three widths and describe what you checked; if browser acceptance is not possible in your environment say so plainly and give Hung the manual steps (restart server + worker + Vite, open a project's SEO tab, generate with Claude CLI, watch the step text/timer/logs, press Hủy once, then open Quản lý kênh at a narrow window).

## Report

Write `docs/superpowers/tasks/task-115-report.md` (untracked): commits, files changed, the final step/progress/log table, heartbeat cap decision and the `appendJobLog` findings, client component behavior, before/after layout notes for both screens, verification output, what you could not verify, deviations. Do not push.
