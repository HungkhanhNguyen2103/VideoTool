# Task 42 — transition variety (Remotion)

Today every scene boundary is the same 0.5 s crossfade (Task 33). We want
several transition types, rotated automatically so the video doesn't feel
repetitive, while keeping Task 33's guarantees.

## Hard constraints (unchanged from Task 33)
- **Audio timing never changes.** Voice/SFX sequences still use
  `sceneFrameTimings()`, and the total duration is unchanged. Transitions
  only touch the visual layer.
- Outgoing image visuals are extended under the incoming scene. Outgoing
  **video** scenes are not extended (the clip may be out of frames).
- Incoming scenes shorter than 3× the transition length get a hard cut.
- Ken Burns keeps using the real scene duration. Pop-ups and lower thirds
  (audio-timed) are unaffected.

## 1. Transition types
All procedural (CSS transforms, filters, gradients). No image or video
assets, no network. Named constants for durations:
| type | ~duration | incoming | outgoing (during its extension) |
|---|---|---|---|
| `crossfade` | 0.5 s | opacity 0→1 (today's behaviour) | static |
| `wipe` | 0.6 s | revealed by a soft-edged diagonal/horizontal wipe (`mask-image` linear-gradient moving across, or clip-path + feathered edge). Direction alternates. | static |
| `whipPan` | 0.4 s | slides in from ±100% with horizontal motion blur that fades out | slides out the other way with blur rising. Direction alternates. |
| `zoomThrough` | 0.5 s | scale 1.25→1 plus opacity 0→1 | scale 1→1.6, blur rising, opacity 1→0 |
| `lightLeak` | 0.7 s | crossfade underneath | a warm amber/orange radial-gradient overlay with `mix-blend-mode: screen`, peaking at the midpoint and drifting slightly |
| `filmBurn` | 0.7 s | crossfade underneath | an overexposed orange-to-white burn gradient sweeping across, plus a brief brightness pulse, peaking at the midpoint |

Easing: in-out for whip and zoom, gentle for the others. Keep the effects
tasteful: this is documentary, not a music video.

## 2. Planning (pure, tested)
Add a pure function in `src/remotion/frame-math.ts` (next to
`sceneVisualTimings`), e.g. `planTransitions(scenes, fps, style)`. It
returns, per boundary, `{ type, frames }`, and feeds
`sceneVisualTimings` so the extension/fade length **per boundary** matches
its type.
- **Deterministic:** pick by a hash of the incoming scene id (like Ken
  Burns). Re-rendering gives the same result.
- **Weighted, no immediate repeats:** crossfade ≈40%, wipe ≈15%,
  whipPan ≈15%, zoomThrough ≈10%, lightLeak ≈10%, filmBurn ≈10%.
  Never the same type on two consecutive boundaries. Use named constants.
- If the outgoing scene is a video, use `crossfade` (fade from black, as
  today). If the incoming scene is too short for its type, fall back to
  crossfade if that fits, else a hard cut.
- `style === 'crossfade'` → always crossfade, which is today's behaviour.

## 3. Per-project setting
Mirror Task 38 (`keywordPopupsEnabled`):
- `transitionStyle: z.enum(['crossfade', 'varied']).default('varied')` on
  the project doc/detail schemas. Copy it on duplicate.
- A strict `PATCH /api/project/:id/transition-style`.
- Pass it through the Remotion input props. Add it to
  `RemotionInputPropsSchema` with default `'varied'`.
- Studio: a small `<select>` "Chuyển cảnh: Đa dạng / Chỉ mờ dần" next to the
  "Chữ pop-up" checkbox. It's disabled for FFmpeg, with the same hint.

## 4. Rendering
`SceneVisual` gets the incoming transition (for its first frames) and the
outgoing transition (for its extension frames, i.e. the next boundary's
type). Put each effect in a small, separate component or function, so
Task 43 can add more.

## 5. Tests
Plan determinism, the weights roughly respected over many boundaries (e.g.
200 synthetic ids, loose bounds), no consecutive repeats, the
outgoing-video → crossfade rule, short-scene fallback, the
`style: 'crossfade'` override, and that audio timings and total frames are
unchanged. Also route/schema/legacy-default tests for the setting.

## 6. Visual verification (gitignored folder, exact paths)
For **each** of the 6 types, render one boundary between two Kodak image
scenes and send PNG stills at 25%, 50% and 75% through the transition.
A 3-up contact sheet per type is ideal. Also send one short mp4 containing
all six back-to-back. Zoom in yourself: no black flashes, no exposed edges
during whip/zoom (scale up enough to cover), no seams in the wipe edge.
Confirm the voiceover start frames are unchanged versus `main`.

Report the commit hash, typecheck/lint/test/build results,
`verify:keyword-font`, and the paths.

**STOP after this report.**
