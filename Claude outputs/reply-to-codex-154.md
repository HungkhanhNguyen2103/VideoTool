# Task 51 - Studio shows real video-scene facts, duration warnings, pre-render summary

## Why (Hung's real project)
Studio scene cards show only `scene.durationSec` ("1s", "9s"). For video scenes that number is the narration estimate (words/150*60, min 1s) until a
voiceover exists; after voiceover it becomes ceil(audio + 0.3s). The real clip length (`videoDurationSec`, ffprobe at ZIP import), the keyframe
(`videoKeyframeFileId`) and the tail frame (`videoTailFileId`, Task 49) are never shown. Runner clips are ~10s, scenes are often 4-18s, so users cannot see:
- scene SHORTER than clip -> clip is cut (Hung's scene 01: 1s scene, 10s clip),
- scene LONGER than clip -> tail frame holds for the remaining seconds,
- video scene with no clip, or clip without keyframe/tail (fallbacks).
Scope: Studio UI + one small server action. Do NOT touch FFmpeg/Remotion render code or visuals.

## Part A - Pure readiness helper (commit `feat(asset): add scene readiness analysis`)
New pure module (client-safe, e.g. `src/contracts/scene-readiness.ts` or `src/client/features/asset/scene-readiness.ts`; pick one place both client and server tests can import).
`analyzeScene(scene, { fps? })` returns `{ kind, status, messages[], deltaSec? }`:
- image scene: `missing-asset` if `assetFileId === null`, else `ok`.
- video scene:
  - `missing-clip`: `assetFileId === null` and `videoKeyframeFileId === null` -> error (blocks nothing, but red).
  - `keyframe-only`: no clip, has keyframe -> warning "chi co anh keyframe, se hien anh tinh".
  - `clip-unmeasured`: clip but `videoDurationSec === null` -> warning "chua do duoc do dai clip".
  - `clip-cut`: `videoDurationSec > durationSec` (epsilon 0.05) -> warning "Clip X.Xs, scene Ys: bi cat Z.Zs".
  - `clip-padded`: `videoDurationSec < durationSec` -> info "Clip X.Xs, scene Ys: dem Z.Zs bang khung cuoi" (say "bang keyframe" when no tail, "dung khung dau" if neither).
  - `no-tail`: clip present but `videoTailFileId === null` -> info, mention fallback to keyframe/none.
  - `ok` otherwise.
  Rounding: show one decimal; compare using seconds, not frames.
- Also returns `needsVoiceover: boolean` (informational: duration is still an estimate when `audioFileId === null`; add message "thoi luong scene la uoc tinh, tao voiceover de co thoi luong that").
Tests: every status incl. boundaries, epsilon, missing fields, image scenes, estimate hint.

## Part B - Scene cards and detail (commit `feat(studio): show video scene durations and frames`)
- Card header: keep `{durationSec}s`; for video scenes with a measured clip add a second muted chip `clip {videoDurationSec.toFixed(1)}s`.
  Add one status badge from Part A (error=red, warning=amber, info=muted) with a `title` containing all messages. Image scenes show a badge only for missing asset.
- Scene detail panel (video scenes): section "Khung hinh video" with three thumbnails labelled "Keyframe", "Khung cuoi (se dung de dem)", "Clip",
  using the same file URL helper as existing previews. Show a placeholder when a frame is missing. Show the Part A messages as a list.
- Also show `Thoi luong scene: Xs (uoc tinh)` vs `(tu voiceover)` depending on `audioFileId`.
- No layout regression for image scenes; keep existing buttons/classes; update CSS module only where needed.
- Client tests (component or logic-level, follow existing StudioPage test style): chip/badge text for cut/padded/missing cases, thumbnails render only when files exist.

## Part C - "Keo dai scene bang thoi luong clip" (commit `feat(asset): extend a scene to its clip length`)
Rule agreed with Hung: DEFAULT is warn-only; the user can opt in per scene.
- New endpoint `POST /:id/scenes/:sceneId/fit-to-clip` body `{ expectedVersion: number }` (strict). Server (asset module) validates: scene exists, `assetType === 'video'`,
  `videoDurationSec !== null`, and `ceil(videoDurationSec) > durationSec`; otherwise 422 with a clear message. Sets `durationSec = ceil(videoDurationSec)`
  through a project-module mutation with the version guard (409 `PROJECT_CHANGED` on mismatch). Does not touch audio, wordTimings, assets or prompts.
  Keep chapter `durationSec` totals consistent (same approach as the narration-edit task `0961a84`: reuse that helper if it exists).
- Studio: button "Keo dai scene = clip" on cards/detail with `clip-cut` status; after success refresh project and toast
  "Scene N: {old}s -> {new}s". Add hint: regenerating that scene's voiceover recalculates duration and may undo this (state it in the tooltip).
- Verify how `durationSec` is consumed in Remotion (`remotion-props.ts`, `SceneSequence.tsx`) when `durationSec` > audio length: narration ends, clip keeps playing, no crash,
  popups/word timings unaffected. If voiceover regeneration should preserve a larger clip-driven duration, DO NOT change it in this task; just report.
- Tests: success path; 422 for image scene / no clip / already long enough; 409 on stale version; chapter total updated; other fields untouched.

## Part D - Pre-render summary (commit `feat(studio): summarize scene readiness before render`)
- Above the render buttons show a compact summary: `N scenes: X ready, Y warnings, Z errors` with an expandable list `Scene n: message`.
- Keep the existing "thieu asset" blocking rule exactly as is (missingScenes).
  Warnings never disable render. If any `clip-cut` or `missing-clip`/`keyframe-only` scene exists, clicking "Render video" or "Render nhap" shows a confirm dialog
  listing them ("Tiep tuc render" / "Quay lai"). Use the existing dialog/confirm component if there is one; no new dependency.
- Tests for summary counts and for confirm only appearing when relevant.

## Do NOT
Change render engines, ZIP import, voiceover generation, scene-split, distribution (Task 48), or add dependencies. No auto-modification of any scene without the explicit button.

## Verify and report
Commit hashes per part, focused tests, full test/typecheck/lint/build EXIT codes. Then a manual check in Studio on a project with: a video scene shorter than its clip, one longer, one keyframe-only, one image scene
missing an asset. Report what each card/badge shows (text of the badges) and attach/describe screenshots. Confirm the `fit-to-clip` result in the real project and in a short render preview.
