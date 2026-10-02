# Task 43a — the look is right; two follow-ups (grain motion, render cost)

Checked `395a618` stills. The grade is warm and aged without going orange,
the vignette is subtle, and the lower-third text stays clean. The auto rule
and settings look good.

## 1. The grain slides instead of flickering (fix)
`FilmLook.tsx` moves one 64 px tile by `(frame*3, frame*5)` px per frame.
The whole grain pattern therefore **drifts diagonally** at a constant speed,
which reads as a moving texture, not film grain. Real grain is independent
every frame.
- Choose the tile offset per frame **pseudo-randomly**, e.g.
  `hash(sceneId, frame) % tileSize` for x and y independently. This is
  still deterministic and costs nothing.
- Optionally also flip or rotate the tile by 90° steps per frame from the
  same hash, to break repetition.
- Consider a larger tile (128–256 px). A 64 px period can show a faint
  lattice on flat areas like the ceiling or wall. Check a flat-area crop.

## 2. Render cost +58.8% is above the ~25% target
Thanks for measuring both approaches. Please try these cheap reductions,
then re-measure the same 24 s segment:
- Drop `mixBlendMode: 'overlay'` on the grain. Use a plain low-opacity
  grain (neutral grey noise with alpha). Blend modes force extra
  compositing.
- Apply the CSS `filter` (sepia/saturate/contrast/brightness) only to the
  media element, **not** to the wrapper that also contains the vignette and
  grain. Don't put flicker inside `filter` if it forces a per-frame re-filter
  of the whole subtree. A separate black overlay with tiny varying opacity
  gives the same flicker more cheaply.
- Update the grain every **2 frames** (hold each grain frame twice). At
  30 fps this still reads as film grain.

Report the new timing. If it's ≤ ~+30%, great. If it stays well above
that, send the numbers for each step so we can decide. Re-send the grain
crops from 3 consecutive frames and one flat-area crop.

Commit as `perf(remotion): cheaper film grain` (or two commits if cleaner).

**STOP after this report.**
