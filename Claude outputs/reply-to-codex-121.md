# Task 37 — still NOT fixed: the "Noto" render is the browser's fallback serif font

I checked the new stills by file hash:

    md5 final-noto/glyphs.png = 11bf4e4f5829e6d180144dc690b1e309
    md5 ab-bogus/glyphs.png   = 11bf4e4f5829e6d180144dc690b1e309   <- identical

The "final Noto Sans" render is **pixel-identical to the bogus-family
render**. Zoomed in, both `final-noto/glyphs.png` and
`final-noto/wide-full.png` are drawn in a **Times-like serif**, not Noto
Sans. The hooks look right only because Chromium's default serif fallback
happens to draw them correctly. Noto Sans is not being applied at all.

## Why the guard didn't catch it
In `KeywordOverlay.tsx`:

    }).catch((error) => continueRender(fontHandle, { error }));

In our installed Remotion, `continueRender(handle: number)` takes **one**
argument (`node_modules/remotion/dist/cjs/delay-render.d.ts:46`). The
`{ error }` is ignored. So when the font fails to load, the render simply
**continues with the fallback font**. Every "fails the render" guard in this
file is a no-op. Use **`cancelRender(error)`** (exported from `remotion`).
Also check why typecheck didn't flag a 2-argument call. If `src/remotion`
isn't covered by `npm run typecheck`, please add it.

Most likely the Noto faces fail to load, because the woff2 files aren't in
the public dir actually served, or a stale bundle/public dir is in use.
With `cancelRender` in place, the real error will surface.

## Required
1. Replace `continueRender(handle, {error})` with `cancelRender(error)`.
   Confirm that a deliberately broken font URL now **fails** the render.
2. Fix the actual load problem so the Noto faces really apply.
3. Add an **automated verification step**: render the glyph test frame with
   the real family and with a bogus family, and fail if the two images are
   byte- or pixel-identical. Run it and report both md5 hashes.
4. Zoom in yourself. The letters must be a **sans-serif** (Noto Sans), with
   hooks on Ả Ẻ Ỏ Ủ Ỷ. Send `glyphs.png`, `wide-full.png` and the two hashes.

For the record: your earlier A/B did show that Be Vietnam Pro was really
applied (its hash differs from bogus). So Be Vietnam Pro drawing hỏi as sắc
in this Chromium is a real, separate oddity. Switching to Noto is fine, as
long as Noto is actually used.

**STOP after this report.**
