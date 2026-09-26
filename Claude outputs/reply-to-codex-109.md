# Task 32 — subtle Ken Burns motion for image scenes

## Context
`src/remotion/SceneSequence.tsx` currently renders every image scene as a
100%-static full-frame `<Img>` — no motion at all (video-type scenes already
have motion since they're actual video clips). We're starting the "make
scenes less like a static slideshow" work with the smallest, lowest-risk
piece first: a gentle Ken Burns pan/zoom on image scenes only. No new scene
data is needed — everything required (`durationSec`, `fps`) is already
available where `SceneSequence` is rendered.

## What to build

**1. Pure, testable transform math** — add a small function to
`src/remotion/frame-math.ts` (same file as the existing
`sceneDurationInFrames`/`sceneFrameTimings`), something like:

```ts
export type KenBurnsTransform = { scale: number; translateXPercent: number; translateYPercent: number };

export function kenBurnsTransform(frame: number, durationInFrames: number, seed: string): KenBurnsTransform
```

- Deterministic per scene: derive a stable direction (zoom-in vs zoom-out,
  and a pan axis/direction) from `seed` (pass the scene id) so the same scene
  always animates the same way, but different scenes don't all move
  identically — a simple string hash to pick among 3-4 preset motion
  variants is enough, no need for real randomness.
- Keep it subtle: scale should range roughly 1.00 → 1.06–1.10 over the full
  scene duration (never more, it should read as "alive," not distracting),
  with an eased curve (Remotion's `Easing.out(Easing.cubic)` or similar) —
  not linear, so it decelerates naturally.
- Duration-aware: the motion should complete once across the scene regardless
  of scene length — a 2s scene and an 8s scene should each feel like one slow
  continuous move, not the 8s scene moving 4x since a fixed pixels/frame rate
  would look wrong on short scenes. Interpolate over `[0, durationInFrames]`,
  not a fixed frame count.
- Clamp for very short scenes (e.g. under ~1s / ~30 frames) so the motion
  doesn't look like a jarring snap — either skip the effect below some
  minimum duration, or reduce the zoom amount proportionally, your call, just
  document which you picked.

**2. Wire it into `SceneSequence.tsx`** — for `scene.assetType === 'image'`
only, wrap the `<Img>` (or apply directly via its `style`) with a transform
using `useCurrentFrame()` + the new `kenBurnsTransform()`, something like
`transform: scale(${scale}) translate(${x}%, ${y}%)`. Leave the
`assetType === 'video'` branch untouched. Make sure `object-fit: contain`
still holds and the scaled image doesn't reveal letterboxing/edges at max
zoom (scaling >1 should be safe here since it only zooms in, never out past
1.0, so no edge gaps — just confirm this holds).

**3. Unit tests** — add tests for `kenBurnsTransform()` in
`src/remotion/frame-math.ts`'s existing test file (create
`frame-math.test.ts` if one doesn't exist yet) covering: frame 0 has no
scale/translate offset (or minimal), motion is monotonic across the
duration, the same seed produces the same output deterministically, and two
different seeds can differ. No Remotion rendering needed for these — pure
function tests.

## Non-goals (explicit)
- No kinetic typography, no chart scenes, no transitions between scenes —
  those are separate future tasks. This task is Ken Burns only.
- No new scene schema/props, no changes to `RemotionSceneProps`/contracts.
- Video-type scenes (`assetType === 'video'`) are untouched.

## Visual verification step (new — please do this one)
Because motion quality can't be judged from a diff or a passing test, once
implemented please:
1. Pick any existing project with at least one image scene (or use a test
   fixture), and use the existing scene-preview render path (the same one
   the Studio page's "Preview" button already calls —
   `GET /api/project/:id/scenes/:sceneId/render-preview`, which already
   renders through Remotion) to render that one scene.
2. Extract 3 frames from the rendered output with ffmpeg (start, middle, end
   of the scene) as PNGs.
3. Attach/share those 3 PNGs in your report (or tell me exactly where they
   are in the repo so I can pull them) so I can actually look at the motion
   before we call this done — a clean diff and passing tests aren't enough
   for this kind of change, I need to see it.

## Process
This is bounded — go ahead and implement directly (no need for a separate
design round), but do the visual verification step above before your final
report. Report back with commit hash, test results, and the 3 still frames.

**STOP after this report.**
