# Task 63 — Tidy the "Kịch bản theo chương" header (layout/CSS only)

Problem (screenshot of the review page, step 3): the chapters panel header mixes five things in one cramped block. The title/summary sits on the left; the AI dropdown, an uppercase "CHẾ ĐỘ TÁI TẠO" legend with two raw radio buttons, and a status sentence are stacked in a small column; "Duyệt tất cả" and "Tái tạo toàn bộ" float on the right at a different height. Elements have different heights and baselines, the radios look unstyled, and the status sentence ("Tái tạo tự động bằng Claude") is orphaned below.

Files: `src/client/features/script/ReviewScriptPage.tsx` (the `panelHead` block, ~lines 396–418) and `ReviewScriptPage.module.css`. No behavior, API, state or text-logic changes.

## Target layout
Two rows inside the same panel head.

Row 1 (`panelHead`): title + summary on the left; on the right the two action buttons `Duyệt tất cả` and `Tái tạo toàn bộ`, vertically centered with the title, same height (use the existing Button sizes, no custom heights).

Row 2 (new `regenToolbar`, directly under row 1): one horizontal bar with a subtle border and the existing panel-2/input background token, rounded like the other cards, padding about `.5rem .75rem`, `display: flex; align-items: center; gap: .75rem; flex-wrap: wrap`. Left to right:
1. `AI` select, label inline on the same line (keep `compactField` look; select height 36px like `.input`).
2. A thin vertical divider.
3. The regeneration mode as a segmented control with two options `Tự động` and `Thủ công (JSON)`. Reuse the existing `.segmented` visual language from the right-hand "Mức thay đổi" control (Nhẹ / Vừa / Viết lại) so both controls match: same radius, selected state in the amber accent, same height 36px. Do NOT show a visible "CHẾ ĐỘ TÁI TẠO" legend; keep it for assistive tech via `aria-label="Chế độ tái tạo"` on the group (or a visually hidden legend).
4. A status chip on the right (`margin-left: auto`), muted, one line, ellipsis if too narrow:
   - automatic: `Tự động bằng <provider label>` with a small dot icon;
   - manual: `Thủ công: tự dán JSON` (short form). The long explanation `lấy prompt, dán vào AI bất kỳ, rồi dán JSON kết quả vào` moves into the chip's `title` attribute and into a second muted line under the toolbar shown ONLY in manual mode.
Everything in the toolbar shares one baseline and the same 36px control height.

## Responsive
- At narrow widths the toolbar wraps: AI + mode on the first line, the chip below, left-aligned. No horizontal overflow at 360px, and none at 900px.
- Row 1 wraps the buttons below the title if needed, never overlapping.

## Keep exactly as is
- Radio semantics and `disabled={controlsBusy}` behavior; keyboard navigation (arrow keys switch mode); focus ring visible.
- The `title` on `Tái tạo toàn bộ` in manual mode and its disabled logic.
- Existing tokens/theme; no hard-coded colors outside tokens.

## Tests
- Update only tests that assert on the old markup/strings (e.g. the `Chế độ tái tạo` legend, `Tái tạo tự động bằng …`). Assert: the group has an accessible name `Chế độ tái tạo`; the chip shows `Tự động bằng DeepSeek`/`Tự động bằng Claude` in automatic mode and `Thủ công: tự dán JSON` in manual mode; the manual helper line renders only in manual mode.
- Existing disabled/title assertions for bulk buttons stay green.

## Verification
Typecheck, lint, full tests pass. Open the review page for a project with chapters and compare against the current screenshot at about 1500px, 900px and 360px wide (the in-app browser viewport may limit this; say which widths you could check). Confirm toolbar controls share one height and baseline. One commit: `style(script): tidy chapters header controls`. Report the hash, files changed, tests changed, and widths checked. No `.env` changes, no deletions.
