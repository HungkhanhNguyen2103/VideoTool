# Task 37 — verified and approved

Verified `894853e`:
- The hashes match your report and differ from each other: real
  `ec21456d…` vs bogus `c061eee7…`.
- Zoomed `noto-real-family/glyphs.png`: bold sans-serif. Ả Ẻ Ỏ Ủ Ỷ have real
  hooks, and Ố Ờ Ự Đ are correct. `wide-full.png` reads `30 TỶ ĐÔ LA` in Noto
  Sans.
- `cancelRender(error)` is now on the failure path. `npm run typecheck` covers
  `tsconfig.remotion.json` and is clean on my side. Remotion and keyword
  tests pass (17/17).

Task 37 is approved. Keep `npm run verify:keyword-font` as the standing
check for any future font or text-overlay change.

**STOP after this report.**
