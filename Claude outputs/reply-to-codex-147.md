# Task 48 — Auto-distribute video scenes (e.g. ~20% video / ~80% image)

Do this AFTER Task 47 is committed. It is independent of Task 49 (last-frame trailing image), which is not
part of this task.

## Goal
Today the only ways to choose which scenes are video are the per-scene toggle and "All images / All videos".
Add a deterministic "distribute video scenes" action: the user enters a target percentage (default 20),
previews exactly which scenes would become video, then applies. Nothing is random; same input, same output.
This sets `assetType` only. It must NOT touch prompts, files, voiceover or anything else.

## A. Pure picker (no DB) — `src/server/modules/project/video-scene-picker.ts` (+ `.test.ts`)

```ts
export function pickVideoSceneIndexes(input: {
  chapterSceneCounts: number[];   // scenes per chapter, in order (chapter.scenesCount ?? 0)
  currentTypes: Array<'image' | 'video'>; // per scene, project order
  locked: boolean[];              // per scene: true when the scene already has assetFileId
  targetPercent: number;          // integer 0..100
}): Set<number>                   // 0-based indexes of scenes that must be video in the end
```

Rules (implement exactly):
1. `N = currentTypes.length`. `target = targetPercent === 0 ? 0 : Math.max(1, Math.round(N * targetPercent / 100))`, capped at `N`. If `N === 0` return an empty set.
2. Chapter layout: if `chapterSceneCounts` is empty, contains a negative/non-integer value, or its sum !== N, treat the whole project as ONE chapter of N scenes (do not throw).
3. Locked scenes keep their current type. Locked scenes that are currently `video` are always in the result and count toward `target`. Locked `image` scenes are never picked. Never demote a locked video even if it exceeds the target.
4. `need = target - (number of locked video scenes)`. If `need <= 0`, add nothing.
5. Otherwise choose `need` more scenes from the UNLOCKED scenes:
   a. Openers = the first UNLOCKED scene of each chapter (chapters with no unlocked scene contribute none), in chapter order.
   b. If `need <= openers.length`: pick `need` openers evenly spaced: opener index `floor(j * openers.length / need)` for `j = 0..need-1` (always includes the first opener).
   c. If `need > openers.length`: take all openers, then `rest = need - openers.length` more from the remaining unlocked non-opener scenes (project order), evenly spaced: position `floor((j + 0.5) * pool.length / rest)` for `j = 0..rest-1`, where `pool` is that remaining list.
6. Result = locked videos ∪ chosen scenes. Unlocked scenes not in the result must end as `image`.

Unit tests (plain vitest, no Mongo) — at least: 100 scenes / 10 chapters / 20% → exactly 20 picks, contains all 10 chapter openers, sorted output identical across two calls; target < chapter count (e.g. 3 picks over 10 chapters, includes scene 0); 0% → empty; 100% → all unlocked; 1 scene @ 20% → that scene; chapters missing or mismatched sum → falls back to one chapter without throwing; locked video counts toward the target and is never removed; locked image is never picked; chapter with all scenes locked contributes no opener; result never exceeds `max(target, lockedVideoCount)`.

## B. Contracts — `src/contracts/asset.ts`
Add zod schemas + types:
- `VideoDistributionRequestSchema = z.object({ targetPercent: z.number().int().min(0).max(100) })`
- `VideoDistributionPreviewSchema = z.object({ total, videoCount, imageCount, lockedCount, changes: z.array({ sceneId: string, sceneNumber: number (1-based), from: 'image'|'video', to: 'image'|'video' }), videoSceneNumbers: z.array(number) , projectVersion: number })`
  where `lockedCount` = scenes with an asset, `changes` lists only scenes whose type would change.

## C. Service + routes (asset module)
In `src/server/modules/asset/service.ts` add:
- `previewVideoDistribution(projectId, targetPercent)` — reads the project, builds inputs (`chapterSceneCounts` from `project.chapters`, `locked = scene.assetFileId !== null`), runs the picker, returns the preview above (including `projectVersion: project.version`). Writes nothing.
- `applyVideoDistribution(projectId, targetPercent, expectedVersion)` — recomputes the picker SERVER-SIDE (never trust a client list), then performs ONE `updateOne` on the projects collection filtered by `{ _id, version: expectedVersion }` using two arrayFilter identifiers, e.g. `scenes.$[toVideo]` (ids that must become video) and `scenes.$[toImage]` (ids that must become image), each with the guard `'x.assetFileId': null` so a scene that received an asset in the meantime is skipped. Set for toVideo: `assetType='video'`, `depthMap=null`; for toImage: `assetType='image'`, `videoKeyframeFileId=null`, `videoDurationSec=null`; plus `updatedAt`, `$inc version`. (Same field semantics as `patchProjectScene` / `setProjectScenesAssetType`; put the Mongo write in the project module next to them and export it, keep the asset service thin.) If `matchedCount === 0` throw `AppError('Project changed, preview again.', 409, 'PROJECT_CHANGED')`. Skip the update entirely (return the project) when there are no changes. Do not call depth-map jobs: only scenes without an asset are ever changed, so there is nothing to compute. Return the updated `ProjectDetail`.

Routes in `src/server/modules/asset/routes.ts` (validate bodies with the new schemas; invalid percent → 422 through the existing error path):
- `POST /:id/scenes/video-distribution/preview`  body `{ targetPercent }` → preview JSON
- `POST /:id/scenes/video-distribution/apply`    body `{ targetPercent, expectedVersion }` → `ProjectDetail`

Add `expectedVersion: z.number().int()` to an apply-specific request schema.

## D. Studio UI — `src/client/features/asset/StudioPage.tsx` + `api.ts`
Next to "All images / All videos" add a compact control:
- number input (0–100, step 5, default 20) with label "% scene video", and a button "Xem trước".
- After preview: show one line "N scene video / M ảnh · K scene đã có asset (giữ nguyên)" and the video scene numbers ("Scene 1, 6, 12…"), plus buttons "Áp dụng" and "Huỷ". If there are no changes, say so and disable "Áp dụng".
- "Áp dụng" calls apply with the previewed `projectVersion`; on 409 show a toast "Dự án vừa thay đổi, xem trước lại." and clear the preview. Success: refresh + toast.
- Hint text under the control: "Sau khi áp dụng, bấm 'Tạo visual prompt' để AI điền motion prompt cho scene video mới."
- Disable while another busy action / job is running, same as neighbouring buttons. Keep existing buttons untouched. Vietnamese UI text, matching the file's style.

## E. Tests (Mongo-backed, in `asset.test.ts` style)
- preview does not modify the project (version unchanged).
- apply with correct version changes only unlocked scenes; a scene with `assetFileId` keeps its type.
- apply with a stale `expectedVersion` → 409 `PROJECT_CHANGED`, nothing changed.
- switching a scene to `video` clears `depthMap`; switching to `image` clears `videoKeyframeFileId` / `videoDurationSec`.
- `targetPercent` 101 / -1 / 12.5 → 422.
- project whose `chapters[].scenesCount` do not sum to `scenes.length` still works (single-chapter fallback).

## Do NOT
- Do not change `generateVisualPrompts`, the export JSON, the ZIP import, or any render code.
- Do not auto-run prompt generation after apply.
- Do not add new dependencies.

## Report back
Commit hash, changed files, test output (raw, not just counts) for the picker tests, `npm run typecheck`, `npm run lint`, and a short description of one manual check: distribute 20% on a real project with chapters and paste the resulting "Scene …" list from the preview.
