# Task 17 — Reorganize the Studio scene list into a responsive grid with an expand-to-edit detail view

## Context

`src/client/features/asset/StudioPage.tsx`'s scene list (`<section className={styles.sceneList}>`, currently ~lines 205-227) renders one full-width card per scene, stacked vertically. Each card already shows a lot: truncated narration (`scene.narration.slice(0, 80)}{scene.narration.length > 80 ? '…' : ''}`), an editable visual prompt textarea, an SFX prompt input, three action buttons (Tạo SFX / Tạo lại voiceover / Preview), any generated audio/sfx players, and an asset preview (image/video). The user wants two things:

1. The narration text shown in full, never truncated.
2. The scene list reorganized into a responsive grid (roughly 3-4 cards per row on a wide screen, fewer on a narrower one — CSS `auto-fit`, not a fixed column count) instead of one full-width card per row, for a faster visual scan of many scenes.

Since a compact grid card can't fit everything the current full-width card shows, the agreed design is: the grid card shows only a compact summary, and clicking it (or an explicit button on it) opens a detail view with everything else, exactly matching this repo's existing native-`<dialog>` modal convention (see `src/client/features/project/components/ConfirmDeleteDialog.tsx`: a `useRef<HTMLDialogElement>`, `showModal()`/`close()` driven by a piece of state, `onClose` handling submit vs cancel via `form.returnValue`, or however the current file structures it — read that file for the exact pattern before writing this one; the detail view here is not a confirm dialog, so it doesn't need `<form method="dialog">`/`returnValue`, just the show/close-on-state-change wiring).

## Scope — file by file

**`src/client/features/asset/StudioPage.tsx`**

1. Add `const [expandedSceneId, setExpandedSceneId] = useState<string | null>(null);` near the other `useState` declarations (~line 16-25).

2. Restructure the `scenes.map(...)` body (~lines 206-226):
   - The returned `<article className={styles.card}>` becomes the **compact grid card**. Keep the existing per-scene derived values (`file`, `src`, `actualType`, `previewType`, `typeMismatch`) since the compact card still shows the asset preview. Drop `editing`/`sceneBusy` from this compact card (they move to the detail view below).
   - Compact card content: the scene number (`String(index + 1).padStart(2, '0')`), the **full** `scene.narration` (no `.slice`/`…`), `scene.durationSec`, the existing `.preview` block (image/video/placeholder — same JSX as today, just visually smaller in the compact card via CSS, see below), the existing asset-type toggle `Button` (`scene.assetType === 'video' ? ... : ...`), and a short visual-prompt status indicator instead of the full prompt text — e.g. a small `Badge` or `span` reading `scene.visualPrompt ? 'Đã có visual prompt' : 'Chưa có visual prompt'`. Add a `Button size="sm"` labeled `Chi tiết` that calls `setExpandedSceneId(scene.id)`. Do not make the whole card a click target (keep click targets to buttons only, for accessibility and to not conflict with the asset-type toggle button also living on the card).
   - Do NOT render the visual-prompt textarea, the SFX prompt input, the three action buttons, or the audio/sfx players inside the compact card — those move into the detail dialog.

3. Add one detail `<dialog>` rendered once (not per scene), after the `sceneList` section, following the `ConfirmDeleteDialog.tsx` pattern:
   - Controlled by `expandedSceneId`: `showModal()` when it becomes non-null, `close()` when it becomes null (via a `useEffect` watching `expandedSceneId`, same shape as `ConfirmDeleteDialog`'s effect watching `pending`).
   - Look up `const expandedScene = scenes.find((scene) => scene.id === expandedSceneId) ?? null;` and render `null`/empty content when it's null (dialog is closed anyway, but avoid crashing on stale lookups).
   - Move the existing "Visual prompt" editable block (the `editing ? <textarea>... : <div className={styles.promptLine}>...` JSX), the SFX prompt input + its three action buttons, and the audio/sfx `<audio>` players — all exactly as they exist today, same handlers (`patchScene`, `startEdit`, `generateSfx`, `regenerateVoiceover`, `previewScene`), same `editingScene`/`draftPrompt`/`sceneBusy` state — into this dialog's body, scoped to `expandedScene`.
   - Add a close control (a `Button` calling `setExpandedSceneId(null)`, and also close `editingScene` if it was open: `setExpandedSceneId(null); setEditingScene(null);`) plus a heading showing the scene number and full narration for context while editing.
   - The existing `.preview` block can stay in the compact card only (don't duplicate the full asset preview inside the dialog) unless you find it awkward to edit without seeing the asset — use your judgment, but do not remove the compact card's preview either way.

**`src/client/features/asset/StudioPage.module.css`**

4. Change `.sceneList` from a single-column grid to a responsive auto-fit grid:
   ```css
   .sceneList { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: .85rem; align-items: start; }
   ```
   (`align-items: start` so shorter cards don't stretch to match a taller neighbor's height.)

5. Adjust `.card` and add whatever compact-card-specific classes you need (e.g. a smaller preview height inside the grid card — the existing `.preview img, .preview video { max-height: 18rem; }` is sized for the old full-width layout; use something like `10rem` for the compact card's preview, and keep the dialog's own styling separate if you add new preview usage there). Add CSS for the new dialog (reuse `ConfirmDeleteDialog.module.css`'s dialog-sizing conventions as a starting point — `max-width`, `border-radius`, backdrop styling — but this dialog needs to be noticeably wider/taller than a confirm dialog since it holds a textarea and multiple controls; don't just copy its exact pixel values without checking they make sense for more content).

## Non-goals — do not touch

- Do not change any handler logic (`patchScene`, `startEdit`, `generateSfx`, `regenerateVoiceover`, `previewScene`, `generateAllVoiceovers`, `generateVisualPrompts`, `splitScenes`, `renderProject`, etc.) — this is a pure layout/JSX reorganization plus one new piece of UI state.
- Do not touch the header, toolbar, or `mediaPanel` (BGM/render) sections.
- Do not change `ConfirmDeleteDialog.tsx` itself — only follow its pattern for the new dialog in `StudioPage.tsx`.
- Do not add a component-render test suite if none currently exists for `StudioPage.tsx` (check first) — this repo's convention tests pure helper functions, not component rendering.

## Verification

Run `npm run typecheck`, `npm run lint`, and `npm run build` (this is a client-only change with no new business logic, so there's likely no new unit test to write — confirm by checking whether `StudioPage.tsx` has any existing test file first). Stage only `src/client/features/asset/StudioPage.tsx` and `src/client/features/asset/StudioPage.module.css` (plus a new dialog CSS/test file only if you actually create one), after checking `git diff --stat`. Never `git add -A`/`git add .`/`git commit -a`.

**STOP after this report.**
