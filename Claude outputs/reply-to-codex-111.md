# Task 33 — crossfade transitions between scenes (Remotion only)

## Context
`VideoComposition.tsx` places scenes back-to-back with `sceneFrameTimings()`,
so every scene change is a hard cut. We want a short crossfade instead.

Hard constraint: **voiceover/SFX timing must not change.** Each scene's
narration audio must still start at exactly the same frame as today, and
total video duration must stay `totalDurationInFrames()`. That rules out
`@remotion/transitions`' `TransitionSeries` as-is, because it overlaps whole
sequences (audio included) and shortens the total.

## Approach (please follow this, it keeps audio untouched)
Split each scene into two layers:
- **Audio layer** — unchanged: voice + SFX `<Audio>` inside a `<Sequence>` at
  the existing `from`/`durationInFrames`.
- **Visual layer** — the image/video, in its own `<Sequence>`:
  - An image scene's visual is **extended** by `T` frames past its normal end
    (not for the last scene), so it is still on screen underneath while the
    next scene fades in.
  - Every scene except the first **fades in** its opacity 0→1 over its first
    `T` frames (eased), drawn on top of the previous scene's extended visual.
  - Result: a crossfade during the first `T`
    frames of each incoming scene, with no change to audio or total length.
- If the **outgoing** scene is a video (`assetType === 'video'`), do NOT
  extend it (the clip may have no frames left); the incoming scene just fades
  in over black. Incoming video scenes fade in normally.
- `T` = round(0.5 s × fps) (15 frames at 30 fps). Skip the fade (hard cut) if
  the incoming scene is shorter than ~3×T, so short scenes aren't mostly
  transition. Put `T` and the threshold in named constants.
- Ken Burns (Task 32) must keep working: it should still animate over the
  scene's real duration; during the extension frames it just holds its end
  state (the existing clamp in `kenBurnsTransform` already does this — pass
  the real scene duration, not the extended one).
- Layer order: later scenes render above earlier ones.

## Pure, testable timing math
Add to `src/remotion/frame-math.ts` something like
`sceneVisualTimings(scenes, fps)` returning, per scene:
`{ id, from, durationInFrames /* visual, incl. extension */, fadeInFrames }`.
Unit-test it in `frame-math.test.ts`: first scene has no fade-in; image
scenes followed by another scene are extended by T; last scene is not
extended; outgoing video is not extended; short incoming scene gets
fadeInFrames 0; audio timings (`sceneFrameTimings`) are unchanged.

## Non-goals
- No FFmpeg-engine changes (FFmpeg keeps hard cuts; transitions are a
  Remotion-render feature only).
- No wipes/slides/glitch variants yet — crossfade only.
- No schema/contract changes.

## Visual verification
The single-scene preview can't show a transition, so render a short segment
spanning at least one scene boundary between two **image** scenes (e.g. via
the Remotion renderer with a `frameRange`, or a 2-scene test project — your
choice). Extract 3 stills: just before the boundary, mid-crossfade (both
images visibly blended), and just after the fade completes. Save them in a
gitignored folder as agreed and give me the exact paths. Also confirm in
your report that the voiceover still starts on the same frame (e.g. compare
audio start timings before/after, or explain how the test proves it).

## Process
Bounded — implement directly. Report commit hash, test/typecheck/lint/build
results, and still paths.

**STOP after this report.**
