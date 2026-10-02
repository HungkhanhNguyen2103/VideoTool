# Animation roadmap + Task 40 (count-up numbers and year timeline)

The user wants richer animation and picked all four directions. Planned
order (one task at a time, after Task 39 is finished):
- **Task 40:** count-up numbers + year odometer/timeline (this file)
- **Task 41:** lower-third name tags for people and places
- **Task 42:** transition variety
- **Task 43:** film-look layer + 2.5D parallax (will need a design round)

Finish Task 39 first. Then do Task 40 as below.

---

# Task 40 — animated numbers and years (Remotion)

Builds on the Task 37 pop-ups. The picker keeps its selection rules. Each
pop-up just gains a **kind**, and number/year kinds animate instead of
simply popping in.

## 1. Picker output (server side, pure, tested)
Extend each keyword with `kind: 'number' | 'year' | 'date' | 'name'`:
- `year`: a lone 4-digit 1000–2100 token (including after `năm`).
- `date`: the `19/1/2012` chains from Task 37.
- `number`: a digit token, with or without a unit (`30 tỷ đô la`, `90%`,
  `37 năm` duration).
- `name`: capitalised runs.

For `number`, add `value: number` (parse `1.000` / `1,5` Vietnamese style:
`.` = thousands, `,` = decimal) and `prefix`/`suffix` strings, so
`30 tỷ đô la` → value 30, suffix `tỷ đô la`. If parsing fails, fall back to
the plain pop-up.

For `year`, add `fromYear` and `timeline: { min, max }`, computed
**project-wide** in mention order:
- `fromYear` = the previous year mentioned anywhere earlier in the video, or
  `year - 10` for the first one.
- `min`/`max` = the smallest/largest year mentioned in the whole project
  (padded a little).
This needs the props builder to look across scenes. Keep it a pure function
over the ordered keyword list.

## 2. Rendering
- **number:** the digits count up from 0 to `value` over ~0.7 s (ease-out),
  formatted Vietnamese style (`1.000`, `1,5`). The prefix/suffix stay
  static. Use tabular/monospaced digits (CSS `font-variant-numeric:
  tabular-nums`) so the width doesn't jitter. Same spring pop and fade as
  today.
- **year:** an odometer roll from `fromYear` to `year` over ~0.8 s, with each
  digit column rolling vertically, clipped. Below it, a thin horizontal
  timeline bar from `min` to `max` with small end labels. A dot/marker
  slides from `fromYear`'s position to `year`'s position in sync with the
  roll. Keep it subtle: thin line, white at ~70% opacity.
- **date / name:** unchanged for now. Names move to lower thirds in Task 41.
- Keep the Noto font setup and `npm run verify:keyword-font` passing.
- The per-project "Chữ pop-up" toggle still disables all of this.

## 3. Tests
Kind classification, number parsing (`30`, `90%`, `1.000`, `1,5`), fromYear
chaining across scenes, timeline min/max, and fallback when parsing fails.

## 4. Visual verification (gitignored folder, send paths)
Kodak scene: stills at count start, mid-count and final for `30 tỷ đô la`.
A year scene (`1975`, rolling from the previous year or 1965): start, mid
and final, with the timeline marker visible. Also a short mp4/gif of each
(~2 s) so I can judge the motion, not just frames.

Report the commit hash, typecheck/lint/test/build results,
verify:keyword-font, and the still/clip paths.

**STOP after this report.**
