# Task 37 — NOT approved yet: wrong tone mark in the render + one selection fix

Thanks for the Truc Ly answer. That's clear, and no action is needed there.

## 1. Blocker: "TỶ" renders as "TÝ"
I zoomed into `wide-full.png` and `vertical-vertical.png`. The pop-up shows
**TÝ** (acute accent), not **TỶ** (hook above). In Vietnamese that's a
different word, so this can't ship.

What I checked:
- The source token is correct: `tỷ` = U+1EF7 (from selection-samples.json).
- The bundled `BeVietnamPro-Bold.ttf` has a proper `uni1EF6` glyph. I
  rendered "TỶ | TÝ" with it via PIL (`task-37/glyph-check.png`), and the
  hook is correct and clearly distinct from Ý.
- The letterforms in the render ("3", "0", narrow "Ô") look like a generic
  sans (Arial/Liberation), not Be Vietnam Pro.

So the bundled font is most likely **not being applied** in the headless
render, and the fallback font draws the wrong mark. Please:
- Confirm by logging the prop string's codepoints inside the composition,
  and `document.fonts.check('bold 100px "Be Vietnam Pro"')` (or your
  family name) after loading. Make sure `delayRender`/`continueRender`
  actually waits for the font before any frame is captured. Also make sure
  the `fontFamily` in the style exactly matches the loaded family name, and
  that the font file is included in the Remotion bundle/public dir the
  renderer uses.
- Add a guard: if the font fails to load, fail the render with a clear
  error instead of silently falling back.
- Re-render and send stills where the text is visibly Be Vietnam Pro and
  **TỶ** has the hook. Add a still with a test string containing
  `Ả Ẻ Ỏ Ủ Ỷ Ố Ờ Ự Đ` (a temporary test render is fine, don't commit it),
  so I can check hook, horn and circumflex+tone stacking.

## 2. Selection fix: Vietnamese dates
`Ngày 19 tháng 1 năm 2012` produced the pop-up **"19"**, which means nothing
on its own. The year got dropped by spacing. Vietnamese dates put the unit
*before* the number:
- Merge a date chain `[ngày] D tháng M năm YYYY` (any contiguous subset
  that includes `tháng` or `năm` followed by a number) into **one**
  candidate. Display it compactly: `19/1/2012`, `1/2012`. For `năm YYYY`
  alone, display just `YYYY`.
- Keep `37 năm` (number followed by năm = duration) working as today.
- Add tests: full date, month+year, year only, and duration `37 năm`.
  Re-list the same 4 selection samples afterwards.

## Not an issue (FYI)
The black bars in the 9:16 still come from 16:9 images with
`objectFit: contain`. That's existing behaviour and out of scope. The pop-up
sizing in 9:16 looks good.

Report a new commit hash, tests/typecheck/lint/build, and the new still paths.

**STOP after this report.**
