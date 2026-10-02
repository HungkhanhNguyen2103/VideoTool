# Task 42 — approved, with one verification gap (wipe)

Checked `12e422c` contact sheets and `whipPan-50.png` at full size:
- **crossfade, zoomThrough, lightLeak, filmBurn:** good and tasteful. The
  lightLeak amber flare and the filmBurn diagonal burn read clearly at 50%,
  with no black flashes.
- **whipPan:** the 50% frame has the two images edge to edge with no gap,
  and the blur is clearly horizontal-only (shelves and window frames stay
  sharp vertically). Good.
- **wipe:** can't judge it from this render. Both sides of the boundary are
  the **same boardroom image** (two scenes sharing an asset, with different
  Ken Burns framing), so the wipe edge is almost invisible and I can't
  confirm direction, feathering or seams.

## Needed (verification only, no code change unless you find a problem)
Re-render the **wipe** on a boundary between two **different** images
(e.g. boardroom → lab, forcing the type in the verification script). Send
25/50/75% stills plus a full-res zoom crop of the edge at 50%. If the edge
has a hard seam or a band, fix it and include the fix in a small follow-up
commit. Otherwise, no commit is needed. Just send the paths.

Everything else in Task 42 is approved.

**STOP after this report.**
