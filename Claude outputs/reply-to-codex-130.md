# Task 41 — lower-third name tags for people and places (Remotion)

Task 40 is approved (`d6e6c2f`). This task moves `kind: 'name'` pop-ups out
of the screen centre into a TV-style **lower third**, and folds in the small
Task 40 follow-up.

## 1. Selection changes (`src/server/modules/video/keywords.ts`, pure, tested)
- **Names no longer compete with numbers.** Select centre pop-ups
  (number/year/date) exactly as today: max 2, 2.5 s spacing, no overlap.
  Select names **independently**: at most **1 lower third per scene**, the
  earliest eligible name. A lower third may overlap a centre pop-up in
  time, since they sit in different screen areas.
- **Hold:** `LOWER_THIRD_HOLD_SEC = 3.0` (named constant), clamped so the
  slide-out finishes by the last timed word. Skip it if less than ~1.5 s
  would remain.
- **Role subtitle:** if the name run is immediately preceded by role words
  from a named lexicon, set `subtitle` to those words, sentence-cased.
  Example: `kỹ sư Steven Sasson` → name "Steven Sasson", subtitle "Kỹ sư".
  Starting lexicon (match the longest phrase first): `kỹ sư, ông, bà,
  giám đốc, tổng giám đốc, chủ tịch, tổng thống, thủ tướng, tướng,
  đại tướng, nhà khoa học, nhà sáng lập, nhà phát minh, người sáng lập`.
- **Place vs person:** `nameRole: 'place'` when the name run is immediately
  preceded by a locative word from a named list (`ở, tại, từ, đến, sang,
  thành phố, bang, tỉnh, thủ đô`). Otherwise `nameRole: 'person'`. Don't
  over-engineer this. An org like "Eastman Kodak" ending up as `person`
  with no subtitle is acceptable.
- **First mention only:** across the whole video, show a lower third only
  the first time a name appears (compare case- and diacritic-insensitive).
  Do this in the project-wide pass next to `annotateYearKeywords`, using the
  same `keywordContextScenes` so previews stay consistent.
- Schema: add optional `nameRole: 'person' | 'place'` and `subtitle: string`
  to `RemotionKeywordSchema`.

## 2. Rendering (`src/remotion`)
- New `LowerThird` component for `kind === 'name'`, placed bottom-left.
  Margin is ~6% of width from the left and ~10% from the bottom. For 9:16,
  go a bit higher (~14%) so it clears typical phone UI.
- Look: a thin amber accent bar on the left (reuse the app's amber, e.g.
  `#f5a623`), then a dark translucent panel (`rgba(10,14,28,.78)`), with
  small inner padding and a subtle radius.
  - Name in bold Noto (same font and loader, **keep the `cancelRender`
    guard**), in the narration's own casing, not uppercased. Size ≈
    `min(width, height) * 0.045`.
  - Subtitle below it at ~0.6× size, 80% opacity.
  - For `place`, a small inline SVG map-pin icon before the name. Draw it
    yourself; no icon library, no network.
- Motion: the panel slides in from the left using the existing spring and
  fades in. The accent bar can lead by a few frames. Hold, then slide out
  to the left and fade over ~0.4 s.
- Text on the dark panel needs no heavy stroke. Keep a soft shadow.
- The "Chữ pop-up" toggle still disables lower thirds too.

## 3. Task 40 follow-up
Give the year timeline line and its min/max labels the same dark
text-shadow / thin stroke treatment as the pop-up text, so they stay
visible on bright images.

## 4. Tests
Names are selected independently of numbers (a scene with 2 numbers + 1
name yields all three). There's at most 1 name per scene. Hold clamping
and skip. Role subtitle (longest match, sentence case). Place detection.
First-mention dedupe across scenes, including different casing or
diacritics. With the toggle off, there's nothing.

## 5. Visual verification (gitignored folder, send exact paths)
- Kodak scene with "kỹ sư Steven Sasson": stills at slide-in start,
  fully in, and slide-out. Zoom in and confirm the diacritics in "Kỹ sư".
- A place example (e.g. "ở Rochester", or a synthetic scene if none
  exists): the fully-in still, showing the pin.
- One 9:16 still of a lower third.
- A bright-background still of the year timeline after the shadow fix.
- Short mp4/gif clips are welcome, but also send PNG stills, because I can
  only inspect images.

Report the commit hash, typecheck/lint/test/build results,
`npm run verify:keyword-font`, and the still paths.

**STOP after this report.**
