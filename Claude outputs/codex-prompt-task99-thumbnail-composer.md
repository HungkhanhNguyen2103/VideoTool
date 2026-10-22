# Task 99 — Thumbnail composer (overlay big bold text on the Flow image)

Repo: `E:\ToolV2\ProjectHK\video-tool`. Report to Hung in Vietnamese; code, commits, comments in English; UI strings Vietnamese. Single agent (no Runner, no planner): do not read any Runner inbox or wait for approvals.

## Why
Tab 4 (SEO & Đóng gói) only suggests thumbnail ideas. The AI image prompt says "no readable text", so the image from Flow has no words, and Hung must add text outside the app (Canva etc.). Hung wants a thumbnail that really stands out, with large, bold, high-contrast text, made inside the app.

## Preconditions
- Branch `main`, `git status` clean except untracked `Claude outputs/` and `docs/superpowers/tasks/*`. Never push; never stage `.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`. LF line endings (`git diff --stat` must equal `git diff --ignore-cr-at-eol --stat`).
- Follow AGENTS.md (rule 11 Status in the same commit; imports only via `index.ts`; CSS Modules + tokens; no new dependency — use the browser canvas). If you believe a dependency is unavoidable, stop and ask.
- Existing pieces to reuse: `src/client/features/seo/components/ThumbnailPanel.tsx` (ideas, chosen idea, upload button, copy-prompt button), `uploadSeoThumbnail` in `features/seo/api.ts` (accepts PNG/JPEG ≤ 2 MB, target 1280×720, `SEO_THUMBNAIL_*` constants in `contracts/seo.ts`, `thumbnailTextStatus` ≤ 5 words in `contracts/seo-format.ts`).

## Feature
A "Ghép chữ thumbnail" panel/dialog opened from the Thumbnail section:
1. **Base image**: upload a PNG/JPEG (the Flow image) or pick the already-uploaded thumbnail. Cover-crop to exactly 1280×720 (no stretching), with an optional drag to reposition the crop.
2. **Text**: starts from the chosen idea's `overlayText` (editable, ≤ 5 words, uppercase by default, show the `n/5 từ` counter). Up to 2 lines, auto-fit: the largest font size that fits the text box; text should be BIG (target ≥ 12% of image height per line).
3. **Style presets** (3, chosen with a segmented control, defaults to the first): (a) "Vàng viền đen" (yellow fill, thick black stroke, soft shadow), (b) "Trắng viền đỏ" (white fill, thick dark-red stroke), (c) "Đỏ viền trắng". Font: heavy sans-serif available on the machine via a font stack (check which fonts the app already loads; prefer one bundled with the app so output is identical on every machine; no external font request). Stroke drawn behind fill (`lineJoin: round`) so thin letters stay readable.
4. **Position**: left-middle (default), center, bottom-left. Never place text in the bottom-right 18% × 14% safe zone (YouTube duration badge); show the zone as a dashed overlay in the preview only (not in the exported image).
5. **Contrast helper**: optional dark gradient behind the text block (toggle, on by default) so the text stays legible over bright or busy images.
6. **Live preview** at the panel width, plus a small 320×180 preview so Hung can judge legibility at feed size.
7. **Export**: render to a 1280×720 canvas, encode PNG; if > 2 MB re-encode JPEG with decreasing quality (0.92 → 0.6) until ≤ 2 MB; show the final format and size. Button "Dùng làm thumbnail" uploads through the existing upload endpoint and refreshes the project (the publish checklist "Thumbnail hợp lệ" then turns done). Also a "Tải ảnh về" download.
8. Persist nothing new in the project except the uploaded final thumbnail (existing field). Remember the last style/position in `localStorage` with try/catch only.
9. Keyboard accessible; Vietnamese labels; layout works at 1920×1080 (primary), 1440×900, 390×844 (stack controls under the preview).

## Structure (keep the module boundary)
- Pure, unit-testable helpers in `src/client/features/seo/thumbnail-compose.ts`: `coverCropRect`, `fitTextLines` (wrap + largest font size that fits, takes an injected `measure(text, size)`), `safeTextBox` (position presets that avoid the bottom-right zone), `chooseExportEncoding` (given a size-by-quality callback, returns format/quality ≤ limit or an error). Rendering to canvas lives in a thin component/function that only calls these helpers.
- Component `components/ThumbnailComposer.tsx` + CSS Module; wire a button in `ThumbnailPanel.tsx` ("Ghép chữ"). Do not break the existing copy-prompt button layout.
- No server change is expected. If you find one is needed, explain why in the report.

## Tests (Vitest, each must fail without the change)
`coverCropRect` for wider/taller/equal sources; `fitTextLines` picks the largest size that fits, wraps to ≤ 2 lines, shrinks for long text; `safeTextBox` never intersects the bottom-right zone for all positions; `chooseExportEncoding` returns PNG when small, falls back to JPEG with decreasing quality, errors when impossible; component renders the controls, the word counter, disables export when text is empty or > 5 words, and the existing upload callback is called with a 1280×720 file. Fakes only; no real network.

## Real verification (do it)
1. Use a real test image: save a 1536×864 generated-looking PNG under `data/files/.verification/task-99/` (draw it with a script: gradient sky, dark river band, bright focal blob — it only has to test contrast; do not use any copyrighted image). Run the composer in a real browser with the dev server (Playwright if available, else Chrome CDP), type "BỊ KHÓA HAI ĐẦU", try the three presets and three positions, export, and check with a script: output PNG/JPEG is exactly 1280×720, ≤ 2 MB, and the bottom-right zone pixels equal the base image there (no text drawn). Save the exported files.
2. Upload through the UI into a disposable duplicate project (`[verify-task-99] ...`, never touch an original) and show the checklist item "Thumbnail hợp lệ" turning done.
3. Screenshots with printed PNG dimensions: **exactly 1920×1080** (explicit viewport), plus 1440×900 and 390×844: composer open with each preset, the 320×180 preview, and the final exported thumbnail. Save under `data/files/.verification/task-99/` with a short `report.md`.
4. Full gate: `npm run typecheck`, `npm run lint`, `npm run build`, full test suite with real counts. Report pre-existing failures (e.g. `src/server/app.test.ts` SPA fallback) with proof, fix only what you caused.

## Done
One commit on `main` (feature + tests + AGENTS.md Status + `src/client/features/seo` docs if a MODULE.md exists), nothing pushed, tree clean (except the allowed untracked), evidence saved. Final report to Hung in Vietnamese: what changed, how to use it in 4 steps, screenshots/paths, gate counts, limitations. Ask Hung only for a decision that cannot be undone.
