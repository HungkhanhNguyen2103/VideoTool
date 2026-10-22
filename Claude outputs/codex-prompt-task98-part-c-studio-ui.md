# Task 98 Part C — Studio UI for inactive scenes (Codex, single agent)

Repo: `E:\ToolV2\ProjectHK\video-tool`. Report to Hung in Vietnamese; code, commits, comments in English; UI strings Vietnamese.

## Context
Task 98 = "inactive scenes": a scene can be switched off and is then skipped by every generation/batch/render step. Parts A and B are already committed on `main` (65950da, 9fc1d23, 286ba6d, 1792ae4): `active` flag in `SceneSchema`, helper `src/contracts/scene-active.ts` (`isSceneActive`, `activeScenes`, `countInactiveScenes`), route `PATCH /api/project/:id/scenes/:sceneId/active`, `SCENE_INACTIVE` 409 on single-scene actions, `skippedInactive` counts in batch results, render/timeline/timestamps use active scenes only, render freshness via `renderedActiveSceneIds`.
Read first: `docs/superpowers/tasks/task-98-inactive-scenes.md` (full spec) and `docs/superpowers/tasks/task-98-coder-plan.md`, plus AGENTS.md. Your job now: **Part C (Studio UI) + the real verification**.

## Preconditions (stop and report if false)
- Branch `main`, HEAD contains 1792ae4. `git status` clean except untracked `Claude outputs/` and `docs/superpowers/tasks/*`.
- Quick sanity of Part B before building on it: run the Task 98 tests (`npx vitest run` on the related files) and confirm they pass. If something in A/B is broken, fix it in a separate commit `fix(task-98): ...` and say so in the report.

## Rules
- Work directly on `main`, never push. Do not stage `.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`.
- LF endings: before commit `git diff --stat` must equal `git diff --ignore-cr-at-eol --stat`.
- AGENTS.md: rule 11 (Status update in the same commit), imports only via `index.ts`, CSS Modules + tokens, no new dependency.
- Max 3 fix rounds on any failure, then stop and report.
- No paid calls: image provider mocked; ask Hung before any paid AI call. VieNeu TTS and MongoDB are already running; start API/worker/web yourself and stop them afterwards.

## Part C spec
1. **Scene card (Studio grid):** compact switch in the footer row next to "Chi tiết". Text label "Bật"/"Tắt", accessible name "Bật/tắt scene N", `role="switch"` + `aria-checked`, Space/Enter toggles. Calls the PATCH route with `expectedVersion`.
2. **Scene detail panel:** switch "Dùng scene này" with a one-line hint ("Scene tắt sẽ bị bỏ qua khi tạo asset, voice và render. Dữ liệu vẫn được giữ.").
3. **Inactive card:** muted (reduced opacity/desaturated via tokens), badge "Đã tắt" in the top row, still selectable and editable (narration, prompts). "Chi tiết" stays enabled. Single-scene actions (regenerate image/voice, SFX, preview…) disabled with tooltip "Scene đang tắt — bật lại để dùng chức năng này".
4. **Disabled while busy:** switch disabled while a project job/render that writes scenes runs (reuse the existing guard); server 409 shown as a Vietnamese toast; no layout shift when toggling.
5. **Counts:** header shows "N scene đang bật · M đã tắt"; total duration = active only. Every batch button/confirm shows "N scene, bỏ qua M scene đã tắt" using the helper (no ad-hoc filters). Scene numbers keep original positions.
6. Voiceover listen panel and "Chạy từ đây" must ignore inactive scenes (skip in playback order, counts in confirm dialog). Check and fix if Part B missed it.
7. After a toggle the render status shows "đã thay đổi sau lần render" (freshness from Part B); verify in UI.
8. Keyboard accessible, focus ring visible, works at 1920×1080, 1440×900, 390×844.

## Tests (Vitest/RTL, each must fail without the change)
Switch on card + detail, aria state, toggling calls route and updates optimistically/rolls back on error, muted class + badge, single-scene actions disabled with tooltip, counts text in header and batch buttons, switch disabled during running job, 409 toast.

## Real verification (do it, not just tests)
Disposable duplicate project `[verify-task-98] ...` (never touch the original). Mark 2 scenes inactive (one in the middle). Run voiceover batch, align-words, SFX, popup analysis and a real short render (mock images). Show: no new files/jobs for inactive scenes; `skippedInactive` observed per batch; render duration (ffprobe) = sum of active scene durations; chapter timestamps skip inactive; re-activate and show all stored data (voiceover, wordTimings, popupPlan, files) intact and usable again.
Playwright screenshots at **exactly** 1920×1080 (set viewport explicitly; print PNG dimensions with a script — 1905×1072 was rejected before), plus 1440×900 and 390×844: grid with 2 inactive cards, detail panel switch, batch confirm with counts, disabled tooltip, stale-render status. Save under `data/files/.verification/task-98/` with `report.md` (commands, numbers, ffprobe output, skip counts, dimensions).

## Gate and finish
`npm run typecheck`, `npm run lint`, `npm run build`, full test suite — real counts, pre-existing failures only with proof. One commit for Part C (AGENTS.md Status + module docs updated), tree clean (except the allowed untracked), nothing pushed.

## Final report to Hung (Vietnamese, short)
What changed, render decision (inactive scenes left out of the final video), skip counts observed, evidence paths, gate counts, limitations, anything needing his decision.
