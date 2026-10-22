# Task 98 — Inactive scenes (skip everything)

Branch: work directly on `main`, one commit per part (A, B, C), never push. Planner: @planner. Coder: @coder.
Preconditions were checked by the planner on 2026-10-13: HEAD is `main` (`a9a80be`, Task 97 merged), tracked tree clean (only untracked `Claude outputs/` and `docs/superpowers/tasks/*`).
Re-check `git status` yourself before the first commit. Never stage `.env.*`, `vite.*.config.ts` temp files, `Claude outputs/`, or `docs/superpowers/tasks/*`.
Files in HEAD are LF: before each commit `git diff --stat` must equal `git diff --ignore-cr-at-eol --stat`.
Follow AGENTS.md (rule 11: update Status in the same commit; imports only via `index.ts`; module boundaries; contracts/zod). No new dependency.

## 1. Goal

A scene can be marked **inactive**. An inactive scene is skipped by every generation, batch and render step: no image/video asset import or export, voiceover, word alignment, SFX, depth map, visual prompt, popup analysis, duration recompute, render, and it does not count toward totals or timestamps.
Hung toggles it per scene in Studio and can switch it back on without losing anything stored on the scene (files, voiceover, wordTimings, popupPlan, nameCandidates, sfx, depthMap, prompts).

Schema change (additive, authorised by the mission): `active` on the scene. No migration; legacy scenes read as active.

## 2. Design (decide in your plan; these are the defaults)

1. `src/contracts/project.ts`: add `active: z.boolean().default(true)` to `SceneSchema`. Check every other scene schema (`SceneDocSchema` in project/docs.ts, import/export schemas, `FlowSceneExport` — which must NOT gain it) so a legacy doc without the field parses as active and a doc with `active:false` survives round trips.
2. One shared helper in `src/contracts/` (e.g. `scene-active.ts`): `isSceneActive(scene)`, `activeScenes(scenes)`, `countInactiveScenes(scenes)`. Treat `active !== false` as active so partially-typed fixtures keep working. Use it EVERYWHERE. No scattered `scene.active` checks, no ad-hoc `filter`.
3. Never change scene ids or order. Scene numbers shown to the user, Flow export numbers, ZIP `SCENE_NNN` numbers, log lines ("Scene 5/44") stay the ORIGINAL positions; inactive scenes are not renumbered. When a loop reports progress, compute progress over active scenes but print original numbers.
4. Toggle: `PATCH /api/project/:id/scenes/:sceneId/active` body `{ active: boolean, expectedVersion?: number }`.
   - Project module owns the write: new `setProjectSceneActive(id, sceneId, active, expectedVersion?)` in `project/service.ts` (+ repo), single `updateOne` with arrayFilters, `$inc: {version: 1}`, same version-guard pattern and error codes as `patchProjectScene` (`PROJECT_CHANGED` 409, 404 for unknown scene). Idempotent: setting the same value still succeeds (bump version only if you want; document the choice).
   - The route cannot live in `project` (project may import nothing, but the guard needs `job`). Put it where `job` is importable: the video router (precedent: `PATCH /:id/render-engine`, `popup-density`) or asset router. State your choice in the plan.
   - Refuse with Vietnamese 409 while any job that reads/writes scenes is active for the project: `render-full-video`, `generate-voiceover`, `align-word-timings`, `analyze-popups`, `generate-all-sfx`, `generate-depth-maps`, `generate-depth-map`, `generate-visual-prompts`, `split-scenes`, `generate-script`, `final-qa`, `regenerate-chapters-claude-cli`. Reuse `getActiveJobByType` from `job/index.ts`; use ONE list constant. Use distinct codes (reuse `RENDER_IN_PROGRESS` / `POPUP_ANALYSIS_IN_PROGRESS` where they already exist, otherwise a new `PROJECT_JOB_IN_PROGRESS`).
5. **Render decision (flag it in your plan and in the final report; keep it in ONE place):** an inactive scene is LEFT OUT of the final video (not rendered as a blank). Otherwise a scene without assets would block render. Implement it as a single `activeScenes(project.scenes)` at the render entry points, so changing to "render as blank" later means changing one call site. Do not scatter filters through the builders.
6. Explicit single-scene actions on an inactive scene are rejected server-side with `409 SCENE_INACTIVE` + Vietnamese message (e.g. "Scene này đang tắt. Bật scene trước khi thực hiện."), using one shared guard function (e.g. `assertSceneActive(scene)` in `src/contracts` or an `AppError` helper in the project module's public API). Applies to: `regenerate-voiceover`, `generate-sfx` (single), `render-preview`, depth-map single (`generate-depth-map` job enqueue + worker handler), `fit-to-clip`, `generate-voiceover` with `startSceneId` pointing at an inactive scene, popup-plan edit and popup-plan flags. NOT blocked: editing narration / visualPrompt / motionPrompt / sfxPrompt via `PATCH /scenes/:sceneId` (stays "selectable and editable"). Note that editing narration already clears voiceover/wordTimings — that is existing behaviour; only report it, don't change it.
7. Staleness: toggling must (a) bump `project.version` and `updatedAt` (b) make the render status show "đã thay đổi sau lần render" and (c) change the scene-preview fingerprints. Find how render freshness is derived today (`src/client/features/asset/scene-preview.ts`, `render-readiness.ts`, `ScenePreviewSection.tsx`, `StudioPage.tsx`; the server side stores `project.renderFile*` pointers) and include the active set (ordered ids of active scenes) in whatever the project-level freshness compares. For the per-scene fingerprint add `active` (or the neighbour/timeline-position info if the preview depends on it — see Part B: year chaining/film look/popup year context depend on other scenes, so the preview fingerprint must change when an earlier scene's active state changes). Add a `ScenePreviewChangedField` + Vietnamese reason.

## 3. Audit list (every item must either skip inactive, or be explicitly justified as "not applicable" in the plan)

Batch/job paths **silently skip** inactive scenes and report `skippedInactive: N` in the job result, in a job log line, and (client) in the summary toast. Do not fail the job because of inactive scenes. If after skipping there are 0 active scenes, finish with a clear Vietnamese log and `skippedInactive` set, not an error loop.

Starting points found by the planner (grep is not exhaustive — you must audit `video`, `asset`, `script`, `seo`, `worker`, `remotion`, `client`, `contracts` yourself and list results in your plan):

### Part A candidates (server skips)
- `video/service.ts`: `generateProjectVoiceovers` (incl. `startSceneId` semantics), `generateProjectSfx` (lines ~100-165, uses `project.scenes.length` for progress and "scene N/M" logs), `generateSceneVoiceover`, `generateSceneSfx`, `renderScenePreviewBuffer`, `assertProjectRenderReady` (only active scenes must be ready; 0 active scenes → `SCENES_NOT_READY` with a Vietnamese message "không có scene nào đang bật"; missing-list numbers are original positions).
- `video/word-timing-service.ts` (align), `video/depth-map-service.ts` (`generateProjectDepthMaps`, `generateSceneDepthMap`), `asset/service.ts` `requestDepthMaps` call after ZIP import (line ~210), `video/scene-duration-service.ts` (recompute-durations: skip inactive, and chapter totals are sums over active scenes only — see `patchProjectScene` chapter duration recompute and `setProjectSceneDurations` in project/service.ts).
- `video/name-keyword-service.ts`, `name-keywords.ts`, `keywords.ts`, `GET /name-keywords/previews`, `selectProjectSceneKeywords`: inactive scenes yield no popup; cross-scene duplicate skipping and "first appearance" order use the active timeline.
- `video/popup-analysis-service.ts`, `popup-plan.ts`, `popup-validation.ts`, `popup-safety-net.ts`, `popup-window.ts`, `autoAnalyzeProjectPopupsIfStale`: inactive scenes are EXCLUDED from the AI input, from chunking/overlap context, and the story start times used by popup logic are computed on the ACTIVE timeline only. `stale/unanalysed` counts, "eligible scene" counts, and the Task 97 guard "skip when any eligible scene already has a fresh plan" consider active scenes only. An inactive scene's stored `popupPlan` is never overwritten, never counted as stale, never deleted; on re-activation it is used again (and shows stale if its inputs changed). `assemblePopupPlans` merging must keep inactive scenes' plans untouched.
- `script/visual-prompts.ts` + `visual-prompt-handler.ts` + route `POST /scenes/generate-visual-prompts` (global scene indexes stay original; inactive scenes are not sent to the AI and not filled; count `skippedInactive`; readiness check `SCENES_NOT_READY` considers... decide and state). `project.applyEmptySceneVisualPrompts*` must not fill an inactive scene even if the AI returns it.
- `asset/service.ts`: `exportScenesJson` (Flow export: omit inactive scenes, keep original `sceneNumber`/`sceneId`), `importAssetsFromZip` (files for inactive scenes are put in `skipped[]` with reason and counted as `skippedInactive` in the response; extend `{updated, skipped}` in `contracts/asset.ts` additively), `setProjectScenesAssetType`/`set-asset-type` (skip inactive), video-distribution preview/apply (`pickVideoSceneIndexes`: inactive scenes are neither counted in totals/percent nor changed; chapter scene counts map to ORIGINAL positions — be careful, the picker works on index arrays), `fitSceneToClip` (single → 409).
- `worker/registry.ts`: every handler above, plus `handleGenerateDepthMap` (single scene → skip if inactive, no throw), `handleAlignWordTimings` auto popup step.
- `project/repo.ts` list aggregation (lines ~54-55): `scenesCount` / `durationSec` used by the project list and `projectMeta` = ACTIVE values (keep behaviour for legacy docs without the field: `active != false`).
- `duplicateProject`: flag and all stored data of inactive scenes are copied as-is.

### Part B candidates (render / timeline / timestamps)
- `video/ffmpeg-renderer.ts` (loop at ~90-108, `totalSceneFrames`), `video/remotion-renderer.ts`, `video/remotion-props.ts` (`resolveRemotionAssets`, `keywordContextScenes`, year chaining, film-look chaining, transitions between neighbours), `video/remotion-staging.ts`, `video/build-timeline.ts`, `video/service.ts` `renderFullProject`, `src/remotion/VideoComposition.tsx` (verify it derives nothing from a scene list it should not see), SFX/BGM mixing offsets, audio concat, logo.
- Preview render (`renderScenePreviewBuffer`) stages ONE active scene but its `keywordContextScenes` / year chain context must be the full project's ACTIVE scenes, so the preview looks the same as in the final video.
- Transitions: neighbours are neighbours among active scenes (crossfade/wipe between scene 4 and 6 when 5 is off).
- `contracts/seo-format.ts` `chapterTimestamps`, `assembleDescription`, `buildPublishChecklist`, `buildPackageMarkdown`: timestamps use active scenes only; chapter start = sum of per-scene rounded frames of ACTIVE scenes before it; a chapter whose scenes are all inactive is skipped from the timestamp list (with a warn-only note, same style as existing warnings) — state exactly what you do. `seo/ai/build-prompt.ts` and `video/ai/build-prompt.ts` / `parse-output.ts`: inactive scenes excluded from AI input.
- Audio-only listen player: `client/features/asset/voiceover-listen.ts` + `VoiceoverListenPanel.tsx`: queue contains active scenes only; if the playing scene becomes inactive (can't happen during a job, but can after refetch) the player skips/pauses cleanly.
- Total duration shown anywhere (Studio header, render readiness, project list) = active only.

### Part C (client, Studio, Vietnamese strings)
- Scene detail: switch **"Dùng scene này"** (a real `<input type="checkbox" role="switch">` or equivalent with label; keyboard accessible: Tab, Space).
- Scene list: compact toggle per row (same control, accessible name "Bật/tắt scene N"); inactive rows visibly muted (opacity/strikethrough-free, readable contrast >= 4.5:1 for text) with an **"Đã tắt"** badge; still selectable and editable (narration, prompts).
- Disable single-scene action buttons for inactive scenes with Vietnamese tooltip + `aria-disabled`/`title` (e.g. "Scene đang tắt — bật lại để dùng chức năng này").
- Every batch button shows what it will touch: **"N scene, bỏ qua M scene đã tắt"** (only show the "bỏ qua" part when M > 0). Confirmation dialogs use active counts. Toasts after jobs include `skippedInactive`.
- Header totals (duration, scene count) show active values with the inactive count noted ("38 scene đang bật · 6 đã tắt").
- Popup card (Task 97) counts, voiceover listen panel, render readiness, pipeline progress (`pipeline-progress.ts`), `scene-readiness-ui.ts`: active only.
- Toggle disabled while a project job is active (reuse the existing blocking logic, e.g. `isProjectJobActive`), with the server 409 shown as a toast.
- Layout holds at 1920×1080 (primary), 1440×900, 390×844; no horizontal overflow at 390px; focus order sensible.

### Out of scope — report current behaviour only (in the final report, as facts you verified by reading/running)
- Script QA, chapter regeneration, scene split (`script/scene-split*.ts`), finalize (`replaceProjectScenes`): do inactive flags survive each of these (new scenes default to active)? Do not change behaviour; if a flag is silently lost by a path that is NOT out of scope, list it as a problem.

## 4. Parts and commits

- **Part A** — contract + helper + `active` field + toggle service/route + guards + all server-side batch/job skips + `skippedInactive` + single-scene 409 + list aggregation + tests. One commit: `feat(project): add inactive scenes and skip them in batch jobs`.
- **Part B** — render (both engines), timeline, preview context, SEO timestamps, AI-input exclusion in seo/video prompts, freshness/fingerprint, tests. One commit: `feat(video): leave inactive scenes out of renders and timestamps`.
- **Part C** — Studio UI + client contracts/api/hooks + counts + muting + tests. One commit: `feat(studio): toggle scenes on and off`.
- Each commit updates AGENTS.md Status (video-tool/AGENTS.md, add a Task 98 line + "Last updated") and the relevant `MODULE.md` files (project, video, asset, script, seo as touched). Stage only this task's hunks; `git diff --cached` checked; staged state typechecks and passes focused tests.
- Dependency order is A → B → C. Post to @planner after each part (not only at the end) so review can happen in parallel with the next part.

## 5. Tests (Vitest, fakes only; each must FAIL without the change — say how you verified that, e.g. by running them against `git stash` of the source change or by a deliberate one-line revert)

Part A:
- Legacy scene doc without `active` parses to `active: true`; `active:false` round-trips through project read/write/duplicate.
- Helper unit tests (`isSceneActive`, `activeScenes`, `countInactiveScenes`; missing field = active).
- Toggle route: success, version guard (`expectedVersion` mismatch → 409 `PROJECT_CHANGED`), unknown scene 404, refusal 409 for EACH job type in the guard list (table-driven), idempotent same-value call, bumps `version`.
- Each batch skips inactive and reports `skippedInactive`: voiceover (including `startSceneId` on an inactive scene → 409), align-words, generate-all-sfx (also `onlyMissing`), depth maps, recompute-durations, visual prompts (AI returning an inactive index is ignored), popup analysis (AI input excludes inactive; story start times on active timeline; stored plan of inactive scene untouched; re-activation restores use), ZIP import (inactive scene file in `skipped`), Flow export (omits inactive, keeps original numbers), set-asset-type, video distribution.
- Single-scene actions on inactive → 409 `SCENE_INACTIVE` (table-driven over regenerate-voiceover, generate-sfx, render-preview, fit-to-clip, depth-map, popup-plan edit/flags).
- `assertProjectRenderReady`: ignores inactive scenes' missing assets, 0 active → `SCENES_NOT_READY`, numbers are original positions.
- Project list `scenesCount`/`durationSec` count active only.

Part B:
- FFmpeg builder and Remotion props exclude inactive; total frames/duration = sum of ACTIVE scene frames; transitions pair active neighbours; film-look/year chaining/keyword/popup year timeline identical to rendering a project that never had the inactive scenes; preview render context uses active neighbours.
- `chapterTimestamps`: skips inactive, frame rounding parity with Remotion for active scenes, all-inactive chapter behaviour.
- Fingerprints: toggling a scene changes its own preview fingerprint and the fingerprint of later scenes whose context changes; render freshness shows "đã thay đổi sau lần render" after a toggle.
- SEO/video AI prompt builders exclude inactive.

Part C (match the repo's client test style: see `StudioPage.test.ts`, `PopupAnalysisCard.test.tsx`, `VoiceoverListenPanel.test.tsx`):
- Toggle control (accessible name, keyboard Space, optimistic/refetch behaviour, disabled while job active, 409 toast), muted row + "Đã tắt" badge, disabled single-scene buttons with tooltip, batch counts text "N scene, bỏ qua M scene đã tắt" (and no "bỏ qua" when M = 0), header totals, listen queue excludes inactive.

## 6. Real verification (do it; label anything not done as "unverified" with the reason)

Disposable duplicate project `[verify-task-98] …` (duplicate via the API/UI from a real project that has scenes, audio and assets, e.g. the Rạch Gầm project; NEVER touch the original). MongoDB and VieNeu TTS are already running. Start API/worker/web yourself (`npm run dev` or equivalent; stop what you started when done). **No paid image calls: use a fake/mocked image provider or existing stored files.** Real TTS (VieNeu local) and real FFmpeg are fine; for popup analysis use API/CLI only if it is not a bulk paid call — ask the planner first; otherwise use a stub backend and label the popup result "stub, unverified with real AI". Do not use the real project, and ask before any paid AI call.

Steps:
1. Record baseline: scene count, per-scene file ids, voiceover durations, popupPlan summary, job count, number of files on disk for the project.
2. Mark 2 scenes inactive (one in the middle, one near the end or start). Show the toggle works through the UI and that the render status shows "đã thay đổi sau lần render" if a render existed.
3. Run voiceover batch (delete/clear audio for a few scenes beforehand including one of the inactive ones, on the duplicate only), align, SFX (real Freesound only if the key exists and the call count is small; otherwise stub, say so), popup analysis, recompute-durations. Show per job: `skippedInactive: 2`, the log line, inactive scenes got NO new files, NO new asset/voice/sfx/depth ids, NO changed `popupPlan`/`wordTimings` (compare to baseline dump).
4. Real short render (draft Remotion preferably, plus one FFmpeg render if time allows; use a project subset or short scenes so it finishes in minutes). `ffprobe` duration of the MP4 must equal the sum of ACTIVE scenes (frame-rounded, include the per-scene tail logic). Print the numbers.
5. SEO chapter timestamps: show that they skip the inactive scenes (compare with timestamps before toggling).
6. Re-activate both scenes: show stored data intact (file ids, voiceover, wordTimings, popupPlan, depthMap equal to baseline) and counts back to full.
7. Playwright screenshots (use Playwright; if it is unavailable say so and use exact Chrome CDP captures, as in Task 97) at exactly 1920×1080 (print PNG pixel dimensions; a 1905×1072 image is REJECTED), 1440×900, 390×844 of: Studio with inactive rows, scene detail switch, batch buttons with counts, header totals. Save under `data/files/.verification/task-98/` with a short `report.md` (commands, real numbers, dimensions). That folder is gitignored; do not commit it.
8. Full gate at the end: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` — real pass/fail/skipped counts. If MongoDB memory-server needs `MONGOMS_SYSTEM_BINARY`, say so.
9. Leave the duplicate project in place and tell me its id (do not delete it).

## 7. Reports

Plan (before any code), posted to @planner, English, ≤ 60 lines:
- confirmation that preconditions hold (`git status`, branch, HEAD sha);
- the toggle route location and guard job list; the helper's file/name;
- the audit table: each item from section 3 → "skip", "n/a (why)", or "decision needed";
- the exact render decision site;
- how freshness/fingerprint will include the active set;
- risks (e.g. chapter→scene index mapping in video distribution, `applyEmptySceneVisualPrompts` global indexes, chapter `durationSec`);
- questions for Hung (only if truly blocking).

After each part: commit sha, `git show --stat`, test names added, focused test result with real counts, anything unverified.

Final report (after Part C and verification): per-part sha; full-gate counts; render decision site; `skippedInactive` counts observed per job; ffprobe vs expected duration; timestamp comparison; evidence paths; behaviour of out-of-scope paths (QA, regeneration, split, finalize) regarding the flag; limitations/unverified items.
