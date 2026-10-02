# Task 37 — still NOT fixed: every "hỏi" mark still renders as "sắc"

I looked at the new stills. The bug is still there, and it's wider than one
letter:

- **`glyphs.png`**: the input is `Ả Ẻ Ỏ Ủ Ỷ Ố Ờ Ự Đ`. The render shows
  **`Á É Ó Ú Ý Ố Ờ Ự Đ`**. All five hook-above (hỏi) letters come out with
  an acute (sắc). Ố, Ờ, Ự and Đ are correct. Your own log shows the input
  codepoints are right (U+1EA2 … U+1EF6).
- **`wide-full.png`** still shows **TÝ**. It is also 2,379,188 bytes, the
  exact same size as the first-round still, and `vertical-vertical.png` is
  also byte-identical in size (1,030,086). The fix seems to have changed
  nothing visually.
- The font file itself is fine. The served copy
  (`data/remotion-public/task-37/public/fonts/…`) has the same md5 as
  `src/remotion/fonts/…`. Rendered **with HarfBuzz shaping** (PIL+raqm, with
  and without `language='vi'`), it draws a proper hook on all five letters.
  See `task-37/glyph-raqm.png`.
- So the pixels in the render do not come from Be Vietnam Pro's glyphs.
  `document.fonts.check()` returning true doesn't prove the face is being
  used: it also returns true when no matching face needs loading.

## What I need
1. **A/B proof first.** Render the same frame 3 times with `fontFamily` set
   to (a) your Be Vietnam Pro family, (b) `Arial`, (c) a bogus name like
   `NoSuchFont`. If (a) is pixel-identical to (c), the face is not being
   applied. Also confirm `verify.ts` builds a **fresh bundle** from the
   current source and isn't reusing a cached one from before `c0ca5f8`.
2. Find and fix the real cause. Candidates to check: family-name or weight
   mismatch between the FontFace descriptor and the style; the component
   rendering before the face is ready; a stale bundle; or the text reaching
   the DOM through something that changes it.
3. Replace the `document.fonts.check()` guard with something that actually
   proves the face is used. For example, check that `document.fonts` has
   your FontFace with `status === 'loaded'` and that its family string
   matches the style exactly.
4. **Before reporting, zoom into your own stills** and confirm by eye that
   Ả Ẻ Ỏ Ủ Ỷ show a hook (like a small "?"), not a slash. Send the new
   `glyphs.png`, `wide-full.png` and the A/B stills.

Date selection (`19/1/2012`) looks good, no changes needed there.

**STOP after this report.**
