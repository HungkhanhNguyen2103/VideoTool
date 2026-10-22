# Task 115 — SEO Progress and Layout Report

## Commits

- `8ab5c5b` — `feat(seo): step progress, logs and cancel for SEO generation`
- `dde3b6b` — `fix(ui): relayout SEO toolbar and channel manager header`

Neither commit was pushed.

## Implementation

- `generateSeoPackage` now creates an ordered `Phần chính` step and, when eligible windows exist, a `Shorts` step. A single step reports `5 → 95 → 100`; two steps report `5 → 50 → 95 → 100`. Progress reaches 100 only after the package is saved.
- Vietnamese job logs include the backend/model, step name, prompt and response byte counts, elapsed time, validation retry, completion, cancellation, and failure. Prompt and generated response text are not written to job logs. The Claude CLI wrapper’s existing audit folder entry remains one line per call.
- A 30-second waiting heartbeat stops with the request or cancellation and is capped at 20 per step across validation retries. The counter is shared across both attempts. `appendJobLog` retains the last 1,000 lines and truncates each line to 8 KiB.
- The SEO page keeps the progress panel until dismissed. It shows the current step, percent, timer, last ten logs, informational no-signal/slow-step warnings, a cancel action while active, and a close action after completion. Auto-scroll follows new logs only while the viewer remains at the bottom.
- Pure client helpers cover step parsing, elapsed formatting, the 45-second no-signal and three-minute slow-step thresholds, request start-time tracking across retry/heartbeat logs, and the ten-line log window. A toolbar regression test ensures manual mode retains its mode selector and action row.

## Live acceptance

All live calls used synthetic fictional railway-station content in an empty isolated database named `video_tool_task115_smoke_20261022`. The harness created a synthetic source and disposable duplicates, then removed all project records, dropped the database, and deleted its temporary audit directory. No saved project text was sent to an AI provider.

Claude Code CLI was available as 2.1.306 with subscription authentication. The two-step run returned four titles and three Shorts. The observed progress values were `5 → 50 → 95 → 100`:

```text
Bắt đầu tạo gói SEO: 2 bước (Phần chính, Shorts). Cách sinh: Claude CLI claude-sonnet-5-5.
Bước 1/2 — Phần chính: gửi yêu cầu (12493 byte).
Bước 1/2 — Phần chính: nhận phản hồi sau 00:10 (431 byte).
Bước 1/2 — Phần chính: xong.
Bước 2/2 — Shorts: gửi yêu cầu (5960 byte).
Bước 2/2 — Shorts: nhận phản hồi sau 00:10 (2050 byte).
Bước 2/2 — Shorts: xong.
Đã lưu gói SEO. Tổng thời gian 00:20.
```

The existing wrapper also logged an audit folder once for each CLI call. The CLI calls completed in about ten seconds each, so this live run did not reach the 30-second heartbeat interval.

The DeepSeek API was configured and generated five titles; observed progress was `5 → 95 → 100`:

```text
Bắt đầu tạo gói SEO: 1 bước (Phần chính). Cách sinh: API deepseek-chat.
Bước 1/1 — Phần chính: gửi yêu cầu (12488 byte).
Bước 1/1 — Phần chính: nhận phản hồi sau 00:01 (571 byte).
Bước 1/1 — Phần chính: xong.
Đã lưu gói SEO. Tổng thời gian 00:01.
```

A second real CLI request was canceled while it was running. It completed in 5.2 seconds, logged `Đã hủy ở bước 1/1.`, returned progress `[5]`, and saved zero titles. The fake-timer tests separately verify the 30-second heartbeat, that it stops after the call and on cancellation, and that retries do not exceed the 20-line step cap.

## Layout checks

- **SEO toolbar:** before, labels and controls wrapped inconsistently, the provider hint repeated the selected backend, and the primary action sat apart from the selects. Now the automatic mode uses stacked labels, a flexible model field, and a bottom-aligned primary button; the CLI note and unavailable reason share a muted left-aligned note row. Manual mode keeps its mode selector, prompt/import actions, and section count together.
- **Channel manager:** before, the list title wrapped, its actions/help were squeezed into a side column, and channel cards began far below. Now the list column uses `minmax(20rem, .9fr)`, the title stays on one line, equal-width buttons fill a row below it, and help/setup/error text uses the full-width slot. The two panels stack at widths below 900 CSS px.
- In-session Chrome checks used a roughly 1,356 CSS px width at 110% zoom for the desktop toolbar/dialog and about 852 CSS px at 175% zoom for the narrow layout. The stacked toolbar showed the model on its own row and the generate button on the preceding row; manual mode kept its selector and actions visible. The dialog showed several saved profiles and stacked at the narrow width.
- The physical browser surface was 1,492×739. Exact 1,920×1,080 and 1,366×768 viewports, a precise 900 px viewport, and the zero-channel dialog state were not verified. The browser screenshots were visible during the session but the available capture did not provide a workspace export path, so no screenshot files were saved. Further computer interaction stopped when Hung needed control of the machine.

For manual acceptance, restart the API, worker, and Vite with `npm run dev`; open a project’s SEO page, generate on disposable content with Claude CLI, watch the step/timer/log panel, and press **Hủy** once. Then open **Quản lý kênh** at 1,920×1,080, 1,366×768, and a 900 px window, checking both an empty list and several saved channels.

## Verification

- `npx vitest run src/server/modules/seo src/client/features/seo src/client/features/channel src/client/shared --maxWorkers=2 --isolate=false` — 20 files passed, 126 tests passed. Mongo-backed tests used the installed MongoDB 8.0 binary via `MONGOMS_SYSTEM_BINARY` and the workspace temporary directory.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; Vite retains the existing warning for the 862.37 kB minified client chunk.
- `git diff --check` — passed.

## Files

Commit 1 contains the SEO service, progress panel and helper, SEO module documentation, tests, and the Task 115 status entry in `AGENTS.md`. Commit 2 contains the SEO toolbar/CSS and manual-mode regression test, channel manager header/CSS, and the final `AGENTS.md` status entry.

The short plan at `docs/superpowers/plans/2026-10-22-task-115-seo-progress-and-layout.md` and this report are untracked by request.
