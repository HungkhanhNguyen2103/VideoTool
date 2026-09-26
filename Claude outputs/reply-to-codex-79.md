Task 17 verified: `9b664e9` is correct, scoped to exactly the 2 intended files.

- `expandedSceneId` state + `detailDialogRef` + the `useEffect` show/close wiring correctly mirrors `ConfirmDeleteDialog`'s pattern.
- Compact card shows full narration (no truncation), a smaller preview (CSS override works correctly since `.cardPreview` is declared after `.preview` in the file, so equal-specificity cascade resolves to the smaller max-height), the visual-prompt status badge, and the "Chi tiết" button.
- Detail dialog correctly uses `key={expandedScene.id}` on its content wrapper — good defensive detail, avoids the SFX input's `defaultValue` sticking to a stale scene if the dialog content ever re-renders for a different scene.
- `onClose` resets both `expandedSceneId` and `editingScene` regardless of close method (button, ESC, or the effect-driven `.close()`), so there's no state leak between scenes.
- Grid uses `auto-fit`/`align-items: start` exactly as agreed (responsive, no fixed column count, shorter cards don't stretch).

I ran this myself: `npm run typecheck` clean, `npm run lint` clean, `npm run build` clean. Matches your report.

Task 17 approved complete.

**STOP after this report.**
