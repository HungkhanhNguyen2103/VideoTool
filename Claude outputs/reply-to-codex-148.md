# Task 49 — Trailing image = last frame of the video (keyframe stays as fallback)

Do this AFTER Task 47 is committed (it touches `asset/service.ts`, which Task 47 commits). Independent of Task 48.

## Part 0 — small fix to Task 48 (do this first, in its own commit)
I verified `bc54610` (Task 48): approved, one gap. A video scene that has ONLY an imported keyframe
(`assetFileId === null` but `videoKeyframeFileId !== null`; this is exactly what a Runner ZIP produces when
the video stage failed) is currently treated as UNLOCKED, so "distribute video scenes" can flip it to `image`
and clear `videoKeyframeFileId`, dropping the only image the scene has.
Fix: a scene counts as locked when `assetFileId !== null || videoKeyframeFileId !== null`.
- `videoDistributionIndexes` (asset/service.ts): `locked = scene.assetFileId !== null || scene.videoKeyframeFileId !== null`.
- `previewVideoDistribution`: `lockedCount` uses the same rule.
- `applyVideoDistribution`: the JS filters for `toVideoSceneIds` / `toImageSceneIds` use the same rule.
- `applyProjectVideoDistribution` (project/service.ts): add `'toVideo.videoKeyframeFileId': null` and `'toImage.videoKeyframeFileId': null` next to the existing `assetFileId: null` guards (both arrayFilters), so a keyframe imported between preview and apply is also protected.
- Tests: a video scene with keyframe only is never changed (preview shows it in `lockedCount`, apply leaves type and keyframe intact); a scene with neither behaves as before. Picker tests need no change (the rule is applied to the `locked` input).
Commit message: `fix(asset): treat keyframe-only video scenes as locked in distribution`.
Then continue with the rest of this task (Parts A-F) as separate commit(s).

## Why
Task 46 crossfades the end of a short clip into the scene's KEYFRAME (the image the clip was generated from).
Real Runner output showed the problem: the clip starts on the keyframe (wide village shot) but ENDS on a
completely different composition (marketplace close-up), so the crossfade jumps back to the opening image.
Fix: at import time extract the clip's actual LAST frame and use that as the trailing image. The keyframe stays
stored and is used only when no tail frame exists.

## A. ffmpeg helper — new `src/server/shared/ffmpeg-frames.ts` (+ `.test.ts`)
Mirror `src/server/shared/ffprobe.ts` (env `FFMPEG_PATH`, default `ffmpeg`, same injectable style, `spawn` with an args array — never a shell string).

```ts
export async function extractLastFrame(videoPath: string): Promise<Buffer> // PNG bytes
```
- Create a temp dir (`mkdtemp` under `os.tmpdir()`), run
  `ffmpeg -y -v error -sseof -0.5 -i <videoPath> -an -update 1 <tmp>/tail.png`
  (`-update 1` makes the image muxer keep overwriting one file, so what remains is the LAST decoded frame; do not use `-frames:v 1`, that returns the first frame after the seek). Read the file, `rm` the temp dir in `finally`.
- 30 s timeout that kills the process. Throw a clear `Error` if ffmpeg exits non-zero, the output is missing/empty, or the bytes do not start with the PNG signature `89 50 4E 47`.
- Test with REAL ffmpeg like `ffprobe.test.ts` does (generate the clip with ffmpeg, follow that test's ffmpeg-availability handling). The clip must be 1 s solid red then 1 s solid blue (e.g. lavfi `color` sources + `concat` filter, small size like 64x64). Prove it is the LAST frame: decode the extracted PNG to raw `rgb24` with ffmpeg in the test and assert blue dominates (b > 150, r < 100, g < 100 — allow for YUV rounding). Also test: nonexistent input path rejects; clip shorter than 0.5 s still returns a PNG.

## B. Data model — new scene field `videoTailFileId: string | null` (default null)
Mirror EVERY place `videoKeyframeFileId` appears (find them with `grep -rn videoKeyframeFileId src`; non-test hits today: `contracts/project.ts` SceneSchema, `project/docs.ts` SceneDoc, `project/service.ts` (duplicateProject, the doc→scene normalization, `patchProjectScene`, `setProjectScenesAssetType`, `applySceneAssets`), `script/scene-split.ts`, `script/service.ts`, `asset/service.ts`, `video/remotion-props.ts`). Semantics:
- Initial value `null` everywhere scenes are created/copied. `duplicateProject` resets it to `null` (files are not copied).
- Cleared to `null` whenever `videoKeyframeFileId`/`videoDurationSec` are cleared: switching a scene to `image` (`patchProjectScene`, `setProjectScenesAssetType`) and normalization for non-video scenes.
- In `patchProjectScene`: add `videoTailFileId` to the patchable fields, and when `assetFileId` is patched WITHOUT an explicit `videoTailFileId`, set the tail to `null` (the tail belongs to a specific video file and is stale once that file changes). Do NOT expose the tail in the client-facing `PatchSceneSchema`.
- `applySceneAssets`: extend the update type with `videoTailFileId?: string | null` and write it when the key is present (explicit `null` must be written).

## C. Import — `importAssetsFromZip` (asset/service.ts)
For a video-type scene when a VIDEO file is imported (the branch that sets `update.assetFileId` and `videoDurationSec`), after the duration probe succeeds:
1. Resolve the stored video path (already done for ffprobe).
2. Call `extractLastFrame(stored.absolutePath)`; on success `storeFile({ projectId, originalName: <video filename without extension> + '.tail.png', mimeType: 'image/png', buffer, purpose: 'reference' })` and set `update.videoTailFileId = summary.id`.
3. On ANY extraction/store failure: do NOT skip the video and do NOT abort the batch — log a warning (existing `logger`) and set `update.videoTailFileId = null` (explicit null: a previous tail belongs to the previous video). The scene then falls back to its keyframe at render time.
4. Importing only an IMAGE (keyframe) for a video scene must not touch the tail.
Make the extractor injectable exactly like `probeVideoDuration`: extend `configureAssetModule(..., options: { probeVideoDuration?, extractLastFrame? })` and use a module-level `extractLastFrameFn`.
Keep the existing behavior: a video whose duration probe fails is still skipped (its companion keyframe is still imported).

## D. Render props — `video/remotion-props.ts`, `contracts/video.ts`
- `RemotionScenePropsSchema`: add `videoTailRelPath: z.string().min(1).nullable().default(null)`.
- In `resolveRemotionAssets`, for `assetType === 'video'` scenes with `videoTailFileId`: resolve with purpose `'reference'`, mime prefix `'image/'`, stage it as `${prefix}-tail.${ext}` (same pattern as the keyframe) and emit `videoTailRelPath`. If resolving the tail fails for any reason, catch it, log a warning and leave `videoTailRelPath = null` (fallback to keyframe) — a missing tail file must never fail a render. The keyframe logic stays exactly as is (strict).
- Image scenes never carry a tail.

## E. Remotion — `src/remotion/SceneSequence.tsx` (`VideoScene`)
`const trailing = scene.videoTailRelPath ?? scene.videoKeyframeRelPath;` and use `trailing` for both the `hasKeyframe` argument of `planVideoKeyframeSegments` and the `<Img src=…>`. Everything else (0.35 s crossfade, opacity interpolation, nesting inside `FilmLook`) is unchanged. Do not touch the FFmpeg engine (`ffmpeg-renderer.ts`, `docs.ts`) — that is a later task.

## F. Tests
- `ffmpeg-frames.test.ts` as above.
- `asset.test.ts` (fake `extractLastFrame` injected): success stores a tail file (mime `image/png`) and sets `videoTailFileId`; extractor throws → video still imported (`assetFileId`, `videoDurationSec` set), tail `null`, filename NOT in `skipped`; re-importing a video after a tail existed and extraction now fails → tail becomes `null`; keyframe-only import leaves an existing tail untouched; switching the scene to `image` clears it.
- `remotion.test.ts` / props tests: tail preferred and staged as `renders/<id>/scene-01-tail.png`; no tail → keyframe used, `videoTailRelPath === null`; tail file unresolvable → no throw, falls back to keyframe; image scene ignores tail.
- Existing tests must still pass unchanged apart from fixtures that list every scene field.

## Real-file check (required, paste the result)
Hung has a real Runner clip (`SCENE_002_Video_Scene_Example.mp4`, 1280x720, 10 s; ask him for it, or use any real mp4). Run `extractLastFrame` on it, save the PNG under `data/files/.verification/task-49/` like earlier tasks, and report `ffprobe` of the PNG (expect 1280x720). Tell me the path so I can view it and confirm it shows the clip's FINAL composition, not its first.

## Do NOT
- Do not change the crossfade length, `planVideoKeyframeSegments`, the FFmpeg render engine, the Studio UI, the export JSON, or add dependencies (ffmpeg is already required).
- Do not backfill existing projects: scenes imported before this task keep using the keyframe until their video is re-imported.

## Report back
Commit hash, changed files, raw test output for `ffmpeg-frames`, `asset`, and the remotion props tests, `npm run typecheck`, `npm run lint`, and the real-file check above.
