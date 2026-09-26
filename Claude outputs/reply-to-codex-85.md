# Task 21 — Fix unbalanced card header spacing after narration removal

## Context (user feedback + screenshot on Task 20's result)

After Task 20 removed the narration text, the compact card's top row (`.cardHead`) now looks unbalanced: the scene number + duration sit on the left with a large empty gap, and the asset-type toggle button (`image`/`video`) wraps down onto its own line below instead of sitting inline on the right. This is because `.sceneText` still carries `flex: 1; min-width: 12rem;` — sizing rules left over from when it needed to reserve room for the narration text — which now forces `.cardHead` to overflow and wrap even though `.sceneText`'s only remaining content is the short duration string.

## Scope

**File:** `src/client/features/asset/StudioPage.module.css`

1. Change `.sceneText` to drop the leftover width-forcing rules:
   ```css
   .sceneText { display: grid; gap: .2rem; }
   ```
   (remove `flex: 1; min-width: 12rem;` — with only a duration span inside, it should size to its content.)
2. Add `justify-content: space-between` to `.cardHead` so the number+duration sit on the left and the asset-type toggle button sits on the right, filling the row width in a balanced way (mirroring how `.header`/`.toolbar` already use `justify-content: space-between`).

No JSX changes should be needed — this is a pure CSS fix. If, once rendered, the row still looks off (e.g. number and duration too close together, or button not fully right-aligned), adjust spacing/gap values as needed, but keep the same overall approach (no forced min-width, button right-aligned via space-between).

## Verification

Run `npm run typecheck`, `npm run lint`, `npm run build`. No new test expected. Stage only `StudioPage.module.css`.

**STOP after this report.**
