# Task 40 — implemented by Claude; please render-verify and commit

The user asked me to implement Task 40 (reply-to-codex-126.md) directly.
**Do not re-implement it.** The code is in the working tree and not
committed, because my sandbox can't safely write git's index. I need you
to render the visual checks and commit.

## Files changed (commit exactly these)
- `src/contracts/video.ts`: `KEYWORD_KINDS`, `RemotionKeywordSchema` (kind,
  value/decimals/grouping/prefix/suffix, year, fromYear, timeline). Keyword
  fields are optional and `kind` defaults to `'name'`.
- `src/server/modules/video/keywords.ts`: kind classification in the
  picker (`year` = lone 4-digit 1000–2100 or `năm YYYY`, `date` = chains,
  `number`, `name`). Also `parseNumberPhrase()` (Vietnamese `.`/`,`) and
  `annotateYearKeywords()` (project-wide `fromYear` chain; dates count as
  mentions; the first year starts at year−10, clamped ≥1000; shared timeline
  padded by max(1, 5%)).
- `src/server/modules/video/remotion-props.ts`: calls
  `annotateYearKeywords` across the rendered scenes after the loop.
  Single-scene previews therefore roll from year−10 (no project context);
  that's acceptable.
- `src/remotion/number-format.ts` (+ `.test.ts`, new):
  `formatVietnameseNumber`, and `odometerColumnOffset` (units column rolls
  continuously, higher columns carry only from 9).
- `src/remotion/KeywordOverlay.tsx`: `PopUp` now takes the whole keyword.
  `CountUp` counts from 0 over 0.7 s with ease-out, uses tabular-nums, and
  reserves width with `minWidth: Nch`. `YearRoll` is a 4+ column odometer
  over 0.8 s with ease-in-out, plus a timeline bar (min/max labels) and a
  marker driven by the same animated value. Date/name are unchanged. Font
  loading and the `cancelRender` guard are untouched.
- `src/server/modules/video/keywords.test.ts`: existing assertions switched to
  `toMatchObject`, plus new kind/parse/chain tests.
- `src/server/modules/video/remotion.test.ts`: one assertion → `toMatchObject`.

## My checks
`keywords.test.ts` + `src/remotion` tests: 24/24. `npm run typecheck`
(server + client + remotion) and `npm run lint` are clean.
`remotion.test.ts` has one failure in my Linux sandbox ("bundle lifecycle",
which expects a `C:\` path). That's environment-specific, and the test is
untouched by this change. Please confirm it passes on Windows.

## What I need from you
1. Run the full suite, build, and `npm run verify:keyword-font`.
2. Render on the Kodak project (gitignored folder, send paths):
   - `30 tỷ đô la`: stills at start, mid-count (~0.3 s) and final.
   - A year pop-up (e.g. `1975`): start, mid-roll (~0.4 s) and final, with
     the timeline marker visible.
   - A ~2 s mp4 of each, and also **6 evenly spaced frames from each clip as
     PNGs**, since I can only inspect images.
3. Zoom in yourself first. Check: digits don't jitter sideways during the
   count, odometer columns are clipped cleanly (no digit bleeding
   above/below), timeline labels are readable, and Vietnamese diacritics in
   suffixes are still correct. If anything looks off, report it with frames
   rather than silently fixing big things. Small styling fixes are fine;
   list them.
4. Commit these files only:
   `feat(remotion): animate number and year pop-ups`.

**STOP after this report.**
