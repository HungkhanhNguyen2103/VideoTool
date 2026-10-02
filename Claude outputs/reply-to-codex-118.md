# Task 37 — keyword pop-ups timed to narration (Remotion only)

The user chose this style (instead of karaoke subtitles): only a few key
words **pop up large in the centre of the frame exactly when they are
spoken**, then fade. For example, "30 TỶ" when the narrator says "30 tỷ".
This is the first consumer of Task 34's `wordTimings`.

## 1. Keyword selection — pure, deterministic, no AI
Add a pure function (e.g. `src/remotion/keywords.ts`, or wherever you think
fits) that takes a scene's `wordTimings.words` and returns
`{ text, startSec, endSec }[]` pop-ups:
- **Numbers first:** a token containing digits (strip trailing punctuation:
  `1975.` → `1975`). Merge it with directly following magnitude/unit tokens
  into one phrase: `tỷ, triệu, nghìn, ngàn, trăm, %, đô, la, USD, năm`
  (e.g. `30 tỷ đô la`). Keep the unit list as a named constant.
- **Proper names second:** runs of consecutive capitalised tokens **not at
  the start of a sentence** (the token after `.`, `!`, `?`, or scene start
  doesn't count). Example: `Eastman Kodak`, `Steven Sasson`, `New York`.
  Strip trailing punctuation.
- **Limits** (named constants): max 2 pop-ups per scene, at least ~2.5 s
  between pop-up starts, and no overlaps. When there are too many
  candidates, prefer numbers, then earlier ones.
- Timing: `startSec` = first token's start. Show for
  max(phrase duration, 1.2 s), then fade. Clamp so it ends before the
  scene's audio ends.
- Unit tests: number + unit merge, trailing punctuation, sentence-start
  capital excluded, name runs, the limit/spacing/priority rules, and no
  pop-ups when there are no timings.

## 2. Props wiring
- Compute pop-ups server-side in `remotion-props.ts` and pass them as a new
  optional field on `RemotionScenePropsSchema` (e.g. `keywords`, defaulting
  to `[]`).
- **Only use `wordTimings` when `wordTimings.audioFileId ===
  scene.audioFileId`.** Otherwise pass `[]`.

## 3. Rendering
- Put the overlay in the **audio-timed** sequence (scene's real start), not
  the extended visual sequence, so it stays locked to the voice.
- Pop-in with a Remotion `spring` scale (≈0.6→1.0, slight overshoot OK) plus
  a quick opacity-in. Hold, then fade out over ~0.3 s.
- Style: large, bold, uppercase (`toLocaleUpperCase('vi')`), centred. White
  text with a strong dark outline/shadow so it reads on any image. Scale the
  font size from composition width (works at 16:9, 9:16, 1:1). Wrap long
  phrases to max 2 lines.
- **Font must support Vietnamese diacritics** (Ỷ, Ố, Đ…). Headless Chromium
  may not have a good system font. Bundle an OFL font locally (e.g. Be
  Vietnam Pro or Montserrat, bold weight) into the Remotion bundle and load
  it before rendering (`@remotion/fonts` `loadFont` or a FontFace with
  `delayRender`). **No network fetch at render time.** Include the font's
  OFL licence file next to it.
- The crossfade (Task 33) and Ken Burns (Task 32) must be unaffected.

## Non-goals
No karaoke subtitles, no per-project on/off toggle yet, no AI keyword
choice, no FFmpeg changes.

## Visual verification (stills in the gitignored folder, give me paths)
Use a real scene with timings that contains a number with a unit and a
diacritic. The Kodak scene's `30 tỷ đô la` at ~10.26 s is ideal. Stills:
(1) the frame the pop-up starts, (2) ~0.3 s later at full size, (3) during
the fade-out. Plus one still from a **9:16** render if cheap, to check
sizing. Also tell me which pop-ups the picker chose for 3–4 real scenes
(scene narration → chosen phrases), so I can judge the selection rules.

Report commit hash(es), tests/typecheck/lint/build, still paths, and the
selection samples.

**STOP after this report.**
