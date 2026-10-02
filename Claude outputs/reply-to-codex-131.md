# Task 41 — lower thirds approved; one visual fix on the year odometer

Checked `65fd66e` stills at full size:
- The person lower third is great. "Steven Sasson" / "Kỹ sư" diacritics are
  correct, and the amber bar, panel and bottom-left position are right.
- The place tag "Rochester" has a clean pin. The 9:16 position is good. The
  timeline line and labels now read on a bright background.

## One fix needed (small, same area)
In `year-bright-final-zoom.png`, each odometer digit sits inside a visible
**grey rectangle**. The dark text-shadow glow is being clipped by each
digit column's `overflow: hidden`, so on bright images you see four boxed
shadow tiles behind "1975". On dark images it's hidden, which is why it
wasn't caught.

Fix: don't let the glow live inside the clipped columns.
- Remove `textShadow` from the odometer digits/columns only, and apply the
  glow once to the **unclipped** row wrapper with
  `filter: drop-shadow(0 4px 12px rgba(0,0,0,.9)) drop-shadow(0 0 24px rgba(0,0,0,.6))`
  (or equivalent). A filter is applied after clipping, so it follows the
  digit shapes, not the column boxes.
- Keep the thin text stroke on the digits.
- Check the count-up and name/date pop-ups aren't affected. They don't
  clip, so they can keep text-shadow.

Re-render `year-bright-final.png` plus a mid-roll frame, both on the bright
background and on the Kodak (dark) background. Zoom in and confirm there are
no tiles. Commit as a small follow-up:
`fix(remotion): unclipped glow for year odometer`.

**STOP after this report.**
