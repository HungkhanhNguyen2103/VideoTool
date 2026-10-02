# Task 66 — Make the manual "Lấy prompt tái tạo" result impossible to miss

User report: in manual regeneration mode the `Lấy prompt tái tạo` button "seems not to work". Code review (`ReviewScriptPage.tsx`): `loadManualRegenPrompt` calls `getRegenerationManualPrompt` and sets `manualRegen`; the result box (`styles.manualBox`: prompt version, `Sao chép`, JSON textarea, `Nhập chương`) renders at ~line 495, AFTER the chapter body. For an expanded chapter that is far below the button row and nothing scrolls to it, nothing is announced, and there is no loading state on the button. From the user's seat the click appears to do nothing. Fix the feedback, not the logic.

## Changes (client only)
1. Placement: render the `manualBox` directly under the chapter's button row (above the chapter body / hook callout), so it appears next to the button that opened it. Only one box is open at a time (existing behavior).
2. Scroll + focus: after the prompt loads, scroll the box into view (`scrollIntoView({ block: 'nearest', behavior: 'smooth' })`) and focus the textarea. Respect `prefers-reduced-motion` (no smooth scroll then).
3. Feedback: while loading, the button shows `Đang lấy prompt…` and is disabled; on success show a toast `Đã tải prompt tái tạo chương <no>. Sao chép rồi dán JSON kết quả vào ô bên dưới.`; errors keep the existing toast.
4. Steps line inside the box, above the buttons, muted: `Bước 1: Sao chép prompt · Bước 2: dán vào AI bất kỳ · Bước 3: dán JSON kết quả vào ô rồi bấm "Nhập chương".`
5. Box header shows which chapter it belongs to (`Chương <no>: <title>`), and a `Đóng` button that closes it without importing.
6. Keep everything else: the textarea placeholder, error under the textarea, pasted text preserved on error, `Nhập chương` disabled when empty.

## Tests
- After `loadManualRegenPrompt` success the box exists inside the chapter's header region (not after the body) — use the existing source/DOM-test style of this file.
- Loading state text, success toast text, `Đóng` clears `manualRegen`.
- Existing manual regeneration tests stay green.

## Verification
Typecheck, lint, full tests pass. In the running app on a project with chapters and mode `Thủ công (JSON)`: click `Lấy prompt tái tạo` on chapter 1 (expanded and collapsed) and report whether the box is visible without manual scrolling, and whether the clipboard copy works. One commit: `fix(script): surface manual regeneration box`. Report hash, files changed, tests added. No `.env` changes, no deletions.
