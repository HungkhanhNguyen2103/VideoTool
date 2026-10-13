# Task 97 Part C final report

## Commit and tree

- Commit: `e2006f67b5bff33b303065ab0a057f3d03fbd972`
- Message: `feat(video): add popup analysis Studio controls`
- Includes `Co-Authored-By: Codex <noreply@openai.com>`.
- Part C history was squashed from `a2a88cb`, `01fcd64`, `1de7f6c`, and the final correction into this single commit.
- The commit contains 30 Task 97 files. `git diff --cached --name-only` was empty before the commit and `git diff --cached --check` was clean.
- The worktree has no tracked changes. The only remaining entries are pre-existing unrelated untracked files under `Claude outputs/` and `docs/superpowers/tasks/`; none were staged.

## Gates

- `npm run typecheck`: PASS, exit 0.
- `npm run lint`: PASS, exit 0.
- `npm test`: PASS, 87 test files passed, 1 skipped; 1,015 tests passed, 0 failed.
- `npm run build`: PASS, exit 0. Vite emitted the existing informational warning for a client chunk above 500 kB.
- Focused final-correction tests: 4 files, 37/37 tests passed.
- Staged-content typecheck: PASS, exit 0.

## Routes

- `POST /api/project/:id/popup-analysis`
- `PATCH /api/project/:id/popup-density`
- `PATCH /api/project/:id/scenes/:sceneId/popup-plan/flags`
- `PATCH /api/project/:id/scenes/:sceneId/popup-plan`

The old name-keyword routes and stored data remain compatibility-only. The worker no longer invokes legacy automatic name analysis, Studio no longer renders its old status row or button, and scene-detail popup text is read from the fresh `popupPlan`.

## Studio placement and behavior

The control-card DOM/tab order remains `Scene & hình ảnh` -> `Âm thanh` -> `Giao diện video` -> `Render & xuất`. `PopupAnalysisCard` is inside `Giao diện video`, before `ProjectLogoControl`. `Render & xuất` shows a non-blocking stale/unanalysed warning; render buttons remain enabled by popup-analysis state.

The card reports backend/model/density, fresh/stale/unanalysed counts, needed/not-needed reasons, kind/display/importance, kept/dropped reasons, rejected counts, bounded scene-list scrolling, cancellation/progress, and pin/suppress/edit actions. Number popups use preset v2's single-figure rule.

## Disposable real verification

Disposable Rạch Gầm project: `01M4SQF9AKB9QE07S9XWV4DTCJ` (98 eligible scenes, 507.47 seconds). The final API-low preset-v2 job was `01M4T3TK98DAM55P9WKVFR3X41`:

- 26.260 seconds from MongoDB `createdAt` to `updatedAt`.
- One measured DeepSeek prompt chunk, one provider call, no retry.
- 98/98 scene plans applied; 35 needed; 63 not needed; 29 kept.
- 17 persisted dropped rows; safety summary `droppedPopups: 16`; `rejectedByValidation: 5`.
- Total DeepSeek calls across API verification: 10 (nine historical calls plus this final one), within the approximately 15-call budget.

Nearest real requested cases: scene 21 stores the single figure `3.000 quân` rather than a range; scene 34 stores `19/1/1785`; scene 42 keeps `kênh Bảo Định` and drops `Rạch Rau Răm` for `gần popup khác`. The duplicate did not contain the exact requested phrases `3000 người`, `ngày xuất binh`, or `năm 1285`, so no synthetic candidates were added.

CLI evidence used historical preset-v1 runs: corrected Haiku low completed with one job attempt, corrected Sonnet low completed with one job attempt, and the final historical Sonnet low dump completed with one job attempt. The pre-fix Haiku failure had three queue attempts and wrote no plan. No CLI token/cost telemetry is exposed.

## Evidence artifacts

- `data/files/.verification/task-97/comparison.md`
- `data/files/.verification/task-97/after-api.md`
- `data/files/.verification/task-97/after-api-low-full.md` (complete final preset-v2 API dump)
- `data/files/.verification/task-97/after-cli-haiku.md`
- `data/files/.verification/task-97/after-cli-sonnet-full.md` (complete historical preset-v1 Sonnet dump)
- `data/files/.verification/task-97/renders/final-scene-21.mp4`
- `data/files/.verification/task-97/renders/final-scene-34.mp4`
- `data/files/.verification/task-97/renders/final-scene-42.mp4`
- `data/files/.verification/task-97/renders/final-scene-021-number-frame.png` (1920x1080, settled `3.000 QUÂN`)
- `data/files/.verification/task-97/renders/final-scene-034-date-frame.png` (1920x1080, `19/1/1785`)
- `data/files/.verification/task-97/renders/final-scene-042-place-frame.png` (1920x1080, `kênh Bảo Định` lower-third)
- Exact viewport CDP captures at 1920x1080, 1440x900, and 390x844: `post-card-final-*`, `post-pinned-final-*`, `post-suppressed-final-*`, `post-density-final-*`, `cli-unavailable-final-*`, and `idle-empty-final-*`.
- `data/files/.verification/task-97/cdp-capture.mjs`.
- `comparison.md` ends with the ffprobe-measured dimensions table for every PNG. Misleading full-page predecessors were renamed with their measured dimensions.

## Unverified or unavailable

- Playwright was unavailable; replacement browser evidence uses a dedicated Chrome 154 CDP profile with exact viewport captures.
- Final preset-v2 CLI quality was not rerun because the API-low run had to remain stored last; the CLI dump is explicitly historical preset v1.
- Provider token/cost telemetry is unavailable.
- FFmpeg popup overlays were not claimed; popup frames were verified with Remotion.
