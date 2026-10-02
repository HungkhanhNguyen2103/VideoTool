# Task 43a — old-film look (Remotion, procedural)

The user agreed to split Task 43:
- **43a (this task):** film look. Procedural, no AI model.
- **43b (later):** 2.5D parallax, which starts with a prototype/comparison.

Small and bounded, so implement directly (no design round). Follow the
usual verification.

## 1. Effect (visual layer only)
Applied to a scene's **visual layer**, meaning the image/video plus Ken
Burns and transitions. **Not** to pop-ups, the odometer/timeline or lower
thirds, which stay clean and readable.
- **Colour grade:** CSS `filter: sepia(~0.35) saturate(~0.8) contrast(~1.05)
  brightness(~0.97)`. Keep it subtle: warm and aged, not orange.
- **Vignette:** a radial-gradient overlay darkening the corners (~30–35% at
  the edges, none in the centre).
- **Grain:** animated film grain, fine and low opacity (~6–10%), using
  `mix-blend-mode: overlay` or `soft-light`. It must change every frame,
  deterministically from the frame number, so re-renders are identical.
  Two acceptable approaches:
  (a) an SVG `feTurbulence` whose `seed` changes per frame, or
  (b) a noise tile generated once in code (canvas or data URL, no asset
  file) and offset/rotated per frame. Measure both if unsure and pick the
  one that renders faster. See §4.
- **Flicker:** a very slight deterministic brightness wobble (±2% at most).
  No scratches or dust for now.
- Put the effects in their own component(s) (e.g. `FilmLook.tsx`), with
  named constants for every strength value.

## 2. When it applies — per-project setting
`filmLook: z.enum(['auto', 'always', 'off']).default('auto')` on the
project doc/detail schemas. Copy it on duplicate. Add a strict
`PATCH /api/project/:id/film-look`, mirroring `transitionStyle`.
- **auto:** a scene gets the look when the story's "current year" at that
  scene is **before 1990** (named constant `FILM_LOOK_BEFORE_YEAR = 1990`).
  The current year is the most recent year/date mentioned **at or before
  that scene**, in narration order, across the whole project. Reuse the
  project-wide keyword chain from Task 40 (`keywordContextScenes` /
  annotated years). Scenes before any year is mentioned get no look. Put
  this in a pure, tested function that returns a per-scene boolean.
  - Important: compute the year chain from word timings **even when
    keyword pop-ups are turned off**. The pop-up toggle must not disable the
    film look.
- **always:** every scene. **off:** none.
- Pass the per-scene result into the Remotion props as `filmLook: boolean`
  (default false).
- Studio: a `<select>` "Hiệu ứng phim cũ: Tự động (trước 1990) / Luôn bật /
  Tắt" next to the transition selector. It's disabled for FFmpeg, with the
  same hint.

## 3. Tests
The pure auto function: a year before 1990 → on; later scenes stay on until
a ≥1990 year is mentioned; a scene before any year → off; dates count;
works with pop-ups disabled. Also always/off, the route/schema/legacy
default, and duplicate.

## 4. Visual and performance verification (gitignored folder, exact paths)
- The same Kodak scene with the look **off vs on**, as full-frame stills,
  plus a 100% zoom crop showing the grain. Two consecutive frames' crops
  should show the grain changing.
- One frame where a keyword pop-up or lower third overlaps a film-look
  scene, to show the text stays clean (no sepia or grain on it).
- **Render-time impact:** render the same ~20–30 s segment with the look
  off and on, and report both times and the % difference. If it's more than
  about +25%, try the other grain approach and report both.

Report the commit hash, typecheck/lint/test/build results,
`verify:keyword-font`, timings, and paths.

**STOP after this report.**
