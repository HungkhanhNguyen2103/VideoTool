# Stepper visual-parity plan — approved, proceed

Yes — proceed with this plan as described.

Confirms everything from the report:
- `approvedCount` from `chapters.filter((c) => c.status === 'approved').length`, `Đã duyệt X/Y` only shown pre-`allApproved`.
- Step 1/2 stay hardcoded `done` once chapters exist, and step 2's existing no-chapter empty-state handling (`Chưa bắt đầu` / `Đang thực hiện` while `jobId` is running) is preserved exactly as `de75a7c` left it — that logic was correct, only the visual layer and step-3 sub-label were wrong.
- `state` transitions match the prototype: step 3 `active` until `allApproved`, then `done`; step 4 `todo` until `allApproved`, then `active`. `aria-current="step"` follows whichever step is `active`.
- Port the dot component (`step__dot`, checkmark icon for `done` via the prototype's `#i-check` SVG symbol, numbered fallback otherwise) and `step__line` connector, including the responsive rule that hides the connector line on narrow viewports (`docs/prototypes/duyet-tai-tao/styles.css` lines ~356–357).

One concrete note, checked directly: the app already has an icon system (`src/client/shared/ui/IconSprite.tsx` + `Icon.tsx`, mounted once by `App.tsx`) that mirrors the prototype's inline sprite pattern — `<Icon name="film" />` etc. renders `<use href="#i-film">` against symbols defined in `IconSprite.tsx`. It does **not** yet have a `check` symbol. Add one there (copy the prototype's `#i-check` definition — `<path d="M5 12l5 5L20 7"/>` on a `viewBox="0 0 24 24"`) and reference it in the stepper as `<Icon name="check" />`, rather than inlining a one-off `<svg>` in `ReviewScriptPage.tsx` or copying the whole prototype sprite. Keep using the project's existing icon system, consistent with every other page.

Red-first regression cases for partial-approval progress and step-4 activation, plus the existing three cases from `review-script-page.test.ts`, should cover the full state space. Run typecheck/lint/tests before committing, same as always. Report back with the commit hash.
