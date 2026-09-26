# Task 19 — Replace the compact card's scrollable narration with a clean line-clamp truncation

## Context (user feedback + screenshot on Task 18's result)

Task 18 added `.narration { max-height: 6.5rem; overflow-y: auto; padding-right: .25rem; }` to cap narration height in the compact grid card. The user pointed out this produces a visible scrollbar cutting into the card (looks bad), and asked whether the full narration is already shown elsewhere. Confirmed: yes — the Task 17 detail dialog already renders the full, untruncated narration (`<p className={styles.detailNarration}>{expandedScene.narration}</p>`) when a card's "Chi tiết" button is clicked. Given that, the user is fine dropping the scrollable box in the compact card in favor of a plain truncated preview with no visible scrollbar — full text remains one click away.

## Scope

**File:** `src/client/features/asset/StudioPage.module.css`

Replace the `.narration` rule from Task 18:
```css
.narration { max-height: 6.5rem; overflow-y: auto; padding-right: .25rem; }
```
with a standard multi-line clamp (no scrollbar, ellipsis after N lines):
```css
.narration { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
```
(4 lines to roughly match the visual space the old 6.5rem scroll box occupied — adjust to 3 or 5 if it looks off once rendered, use your judgment.)

No JSX changes needed — the `className={styles.narration}` is already applied to the right element from Task 18.

## Non-goals

- Do not touch the detail dialog's narration display (`.detailNarration`) — it already shows full text, untruncated, and that's correct.
- Do not change the card-footer-alignment (`margin-top: auto` etc.) from Task 18 — only the `.narration` rule changes.
- Do not add a "read more" affordance or any JS-driven expand/collapse — the existing "Chi tiết" button already serves that purpose.

## Verification

Run `npm run typecheck`, `npm run lint`, `npm run build`. This is a single CSS-property change with no logic touched, so no new test is expected — confirm nothing else needs updating and stage only `StudioPage.module.css`.

**STOP after this report.**
