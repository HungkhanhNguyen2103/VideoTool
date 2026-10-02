# Task 46 spec — video scene + trailing keyframe image when the clip is shorter than the scene

## Why
Motion-comic clips from Hung's external video-gen flow are usually ~10s or less, while a scene's
target duration (from its narration, `NARRATION_WORDS_PER_MINUTE`-based) can be longer — the real
Kodak project averages ~18s/scene. When a video-type scene's clip is shorter than the scene needs,
render the clip for its real length, then crossfade into the same context/keyframe image already
used to generate that clip (prompt 1, "ngữ cảnh nhân vật") for the remaining time — reusing an asset
that already exists rather than requiring anything new to be generated. Confirmed with Hung:
- The trailing image is always the existing context/keyframe image (not a separately-uploaded one).
- The video→image cut is a light crossfade, ~0.3-0.4s (not a hard cut, not a freeze-frame hold).

## 1. Contract (`src/contracts/project.ts`, `SceneSchema`)
Add two new fields, both legacy-safe defaults:
- `videoKeyframeFileId: z.string().nullable().default(null)` — the context/keyframe image file for
  a video-type scene (separate from `assetFileId`, which stays the video file itself for video
  scenes).
- `videoDurationSec: z.number().positive().nullable().default(null)` — the real, probed duration of
  the video file at `assetFileId`, only meaningful when `assetType === 'video'`.
Add both fields (default `null`) to every other scene-construction site — grep for `depthMap: null`
to find them all (same list as the last few tasks: `scene-split.ts` `replacements()`, test fixtures,
etc.).

## 2. Probe real video duration
Add a small ffprobe wrapper, mirroring how `src/server/modules/video/ffmpeg-renderer.ts` already
shells out to a configurable ffmpeg binary (`process.env.FFMPEG_PATH ?? 'ffmpeg'`): add
`FFPROBE_PATH` (default `'ffprobe'`) to `src/server/config.ts` the same way `FFMPEG_PATH` is
already configured, and a function that runs
`ffprobe -v error -show_entries format=duration -of json <path>`, parses the JSON, and returns the
duration in seconds (throw a clear error if ffprobe fails or the output can't be parsed — this
should never silently produce a wrong duration).

## 3. Import: accept both a video AND an image for the same video-type scene
`src/server/modules/asset/service.ts` — `importAssetsFromZip()` currently requires the imported
file's type to exactly equal `scene.assetType` (video scene ⇒ only a video file accepted for that
scene number; an image with the same number is skipped as a mismatch). Change this specifically for
video-type scenes: when `scene.assetType === 'video'`, accept **both** a video file (as before,
becomes `assetFileId`) and an image file with the same `SCENE_NNN_...` number (becomes
`videoKeyframeFileId`) in the same zip. Image-type scenes keep today's exact behavior (only an
image file matches, everything else skipped) — no change there.

Concretely: restructure the per-scene `updates` map (currently `Map<sceneId, assetFileId>`) to hold
`{ assetFileId?: string; videoKeyframeFileId?: string }` per scene, so a video file and an image
file for the same scene number both get recorded instead of the second overwriting the first. After
storing a video file, probe its duration with the ffprobe wrapper from step 2 and carry that through
to the scene update as `videoDurationSec` (only for the video-file branch — an image file for a
video-type scene never sets `videoDurationSec`).

Update `applySceneAssets()` in `src/server/modules/project/service.ts` (currently
`Array<{ sceneId: string; assetFileId: string }>`) to accept the optional
`videoKeyframeFileId`/`videoDurationSec` per update and set them the same conditional-array-filter
way `depthMap: null` is currently reset alongside `assetFileId` — don't touch these two new fields
when an update doesn't provide them (e.g. a plain image-scene re-import shouldn't blank out
anything, and a video-only update with no keyframe in that particular zip shouldn't erase a
previously-imported keyframe from an earlier import).

`requestDepthMaps()` should still only ever be triggered for image-type scenes, exactly as today —
a video scene's keyframe image is not a depth-map/parallax candidate (video scenes already have
real motion; don't wire this to the depth pipeline).

## 4. Remotion: play the video for its real length, then crossfade to the keyframe image
`src/remotion/SceneSequence.tsx` (`ImageScene`/the video branch inside `SceneVisual`) currently
renders `OffthreadVideo` for the entire scene duration whenever `scene.assetType === 'video'`. When
`scene.videoDurationSec` is known, positive, and strictly less than the scene's real duration, AND
`scene.videoKeyframeFileId` is present, split that scene's visual content into two consecutive
segments within the same `<Sequence>` (this is separate from and nested inside the existing
scene-to-scene transition system from Task 42 — don't touch `planTransitions`/`frame-math.ts`, this
is purely internal to one scene's own content):
1. `OffthreadVideo` for `videoDurationSec` (converted to frames via the scene's fps), exactly as
   today.
2. Then the keyframe image (`Img` + `staticFile(...)`), held for the remaining frames, with a
   ~0.3-0.4s crossfade at the join (video fading out / image fading in via `interpolate()`-driven
   opacity on two stacked `AbsoluteFill` layers — a small local implementation is fine, no need to
   reuse the full inter-scene transition machinery). No Ken Burns motion needed on this trailing
   image segment — a static hold is fine, keep it simple.

Fallback / don't regress existing behavior:
- If `videoDurationSec` is null, or `videoDurationSec >= scene`'s real duration, or
  `videoKeyframeFileId` is null — render exactly as today (video for the whole scene), no split.
- This whole feature only ever activates for video-type scenes; image-type scenes (Ken Burns,
  parallax, everything else) are completely unaffected.
- Confirm the split still nests correctly inside the existing `FilmLook` wrapper (both the video
  segment and the trailing image segment need the film grade applied when the scene has film-look
  on) and inside the outer scene-to-scene transition system (the whole two-segment scene still
  behaves as one visual unit for incoming/outgoing scene transitions).

## Tests
- ffprobe wrapper: parses a real short test video's duration correctly; throws a clear error on a
  missing/invalid file.
- `importAssetsFromZip`: a zip with both `SCENE_003_x.mp4` and `SCENE_003_x.png` for a video-type
  scene populates both `assetFileId` and `videoKeyframeFileId` (and `videoDurationSec` from the
  probed video); an image-type scene's existing behavior (only accepts its own type) is unchanged
  by this refactor — add a regression test proving that.
- `applySceneAssets`: doesn't clobber an existing `videoKeyframeFileId`/`videoDurationSec` when an
  update only touches `assetFileId`.
- Remotion: a scene with `videoDurationSec` shorter than its real duration renders the video segment
  then the image segment at the right frame boundaries (component-level unit test on the
  frame-splitting logic, not a full Chromium render); a scene without `videoKeyframeFileId` or with
  `videoDurationSec` null/too-long renders exactly as before (no regression).

## Report format
Same as always: commit hash, diff summary, lint/typecheck/tests/build status. Include a short
Remotion render-verification: stills at the video-segment midpoint, right at the crossfade, and
partway into the trailing image segment, for one real scene where you manually set a short
`videoDurationSec` to exercise the split path (since Hung likely has no real motion-comic clip
imported yet to test this against naturally).
