# Task 57 — Scene card layout alignment (CSS/markup only)

Problem (Studio scene grid, `src/client/features/asset/StudioPage.tsx` ~line 403 and `StudioPage.module.css`):
Video cards show two lines in the header (`11s` and `clip 10.0s` stacked in `.sceneText`), image cards show one line.
So video previews start lower than image previews, the preview boxes have different heights (`min-height` + `max-height` on `img/video`), and the badge/footer blocks land at different heights per card. The grid looks ragged.

## Goal
Every card in a row has identical header height, identical preview box (16:9), and badges starting at the same y. No behavior change.

## Changes (UI only, no API/logic/test-contract changes)
1. Header: keep it ONE row of fixed height. Layout: `[number] [duration meta] ... [type button]`.
   - Put duration and clip duration on the same line in `.sceneText`: `11s · clip 10.0s` (flex row, `white-space: nowrap`, `min-width: 0`, ellipsis if too narrow). Image card shows `4s`.
   - `.cardHead`: `flex-wrap: nowrap; min-height: 2.25rem;`.
2. Preview: fixed aspect ratio box.
   - `.cardPreview { aspect-ratio: 16 / 9; min-height: 0; margin-top: .75rem; width: 100%; }`
   - `.cardPreview img, .cardPreview video { width: 100%; height: 100%; max-height: none; object-fit: cover; }` (`contain` for video if you prefer no cropping — choose `cover` for images, `contain` for video, and say which you used).
   - Placeholder and mismatch message stay centered inside the same box.
3. Badges: reserve a consistent area so the footer starts at the same y in every card.
   - Order: readiness badge first, then the existing ones, as now.
   - `.statusBadges` gets `min-height` equal to two badge rows (measure it; no magic number without a comment), and `align-content: flex-start`.
   - Keep `.cardFooter { margin-top: auto }` so "Chi tiết" is bottom-aligned.
4. Grid: `.sceneList { align-items: stretch }` and `.card { height: 100% }` so cards in a row are equal height.
5. Fix the untranslated badge text `Khong co loi dan` → `Không có lời dẫn` (diacritics) in the same markup line.

## Out of scope
Do not touch the detail dialog, readiness logic, API, or tests other than updating any snapshot/string assertion that contains the old badge text.

## Verification
- Typecheck, lint, full tests pass.
- Run the app and screenshot the scene grid with a mix of video and image cards in the same row; attach or describe: header height equal, previews equal size, footers aligned. Check at narrow width (~900px) and wide width.
- One commit: `style(studio): align scene cards`. Report hash, files changed, which `object-fit` you chose, and screenshot results.
