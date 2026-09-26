# Task 20 — Remove narration text from the compact Studio card entirely

## Context (correction to Task 19)

The user clarified: they don't want the narration text truncated/line-clamped in the compact card at all — they want it removed entirely from the compact card. The full narration is already shown in the "Chi tiết" detail dialog (`.detailNarration`), so the compact card doesn't need to show any narration preview.

## Scope

**File:** `src/client/features/asset/StudioPage.tsx`

In the compact card's `cardHead` (currently, ~line 230):
```tsx
<div className={styles.cardHead}><span className={styles.number}>{String(index + 1).padStart(2, '0')}</span><div className={styles.sceneText}><strong className={styles.narration}>{scene.narration}</strong><span className={styles.muted}>{scene.durationSec}s</span></div><Button ...>{scene.assetType}</Button></div>
```
Remove the `<strong className={styles.narration}>{scene.narration}</strong>` element entirely. Keep the scene number, the duration span, and the asset-type toggle button exactly as they are — `.sceneText` now wraps just the duration span (still fine as a wrapper, or simplify if you prefer, your call as long as the duration still renders and the asset-type button stays where it is).

**File:** `src/client/features/asset/StudioPage.module.css`

Remove the now-unused `.narration` rule (the `-webkit-line-clamp` one added in Task 19). Leave `.detailNarration` (used by the detail dialog) untouched. If `.sceneText`'s `min-width: 12rem` now looks too wide with only a duration string inside, feel free to reduce it — use your judgment, this is a minor width tweak either way.

## Non-goals

- Do not touch the detail dialog (`.detailNarration` stays, full text still shown there).
- Do not remove or change the SFX/visual-prompt status badges, the preview thumbnail, or the "Chi tiết" button.

## Verification

Run `npm run typecheck`, `npm run lint`, `npm run build`. No new test expected for this pure removal — confirm and stage only the two files touched.

**STOP after this report.**
