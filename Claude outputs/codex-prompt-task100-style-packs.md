# Task 100 — Visual style reference packs (replace the single style sample)

Work directly on `main` (no feature branch, no worktree). Never push. Do not stage temp files (`.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`). Keep LF line endings in commits. Follow AGENTS.md (rule 11: add/refresh the Status line in the same commit; import through each module's `index.ts`; CSS Modules + design tokens). UI copy is Vietnamese; code, comments and commit messages are English. Primary viewport 1920×1080.

## Why

Today every visual style (`cinematic`, `anime`, `watercolor`, `photorealistic`, `flat-cartoon`, `strategic-map`) has exactly ONE shared sample image (create-project form: preview + "Thay ảnh mẫu" / "Upload ảnh mẫu" + download link). One image makes every generated scene look alike when it is used as a style reference. The user wants, per style, a **style pack**: several reference images of the SAME art style but different composition, shot size and lighting. The user generates them in Google Flow and later adds them as "Project Style References" in his Flow runner tool (Video Tool itself never sends them anywhere; this is a stored library + prompt helper).

## Source of truth for the pack content

Read `Claude outputs/style-reference-packs.md` (untracked, in the repo root folder). For each of the 6 styles it defines:
- a STYLE BLOCK (English text), and
- 5 slots, each with a role label and a SUBJECT line (English).

The copyable prompt of a slot is `STYLE BLOCK + " " + SUBJECT`. Copy these texts verbatim into code (see Contracts). Do not paraphrase them.

Slots per style:
- `cinematic`, `photorealistic`, `anime`, `watercolor`, `flat-cartoon`: `core`, `wide`, `interior`, `night`, `props`.
- `strategic-map`: `core`, `map`, `map-alt`, `combat`, `infographic`.

Vietnamese slot labels (use exactly):
- `core` "Nhân vật (chính)", `wide` "Toàn cảnh", `interior` "Nội thất", `night` "Đêm / hành động", `props` "Vật dụng", `map` "Bản đồ", `map-alt` "Bản đồ 2", `combat` "Giao tranh", `infographic` "Ẩn dụ tài nguyên".

## Contracts (`src/contracts`)

New file `visual-style-pack.ts` (export through the contracts index if one exists, otherwise follow how `visual-style-sample.ts` is exported/imported):
- `VISUAL_STYLE_PACK_SLOTS: Record<VisualStyleId, readonly { id: string; label: string; hint: string; prompt: string }[]>` with the data above. `hint` = the SUBJECT line translated into one short Vietnamese sentence (what this image should show).
- `VisualStylePackSlotIdSchema` (string), helper `isVisualStylePackSlot(styleId, slotId)`.
- `VisualStylePacksSchema = z.partialRecord(z.enum(VISUAL_STYLE_IDS), z.partialRecord(z.string(), VisualStyleSampleSchema))` reusing the existing `VisualStyleSampleSchema` entry shape (`url`, `filename`, `source`, `updatedAt`).
- Contract test: every id in `VISUAL_STYLE_IDS` has exactly 5 slots with unique ids, non-empty label/hint/prompt, `core` is the first slot of every style, and every prompt contains no unresolved placeholders.

## Server (`src/server/modules/file-store`)

- New collection `visual_style_pack_images`, doc `{ _id: "<styleId>:<slotId>", styleId, slotId, storedPath, mimeType, originalName, createdAt }`. Store files under `FILES_DIR` with a server-generated name exactly like `visual-style-samples.ts` does (reuse `extensionFor`, `uploadReference`, the JPEG/PNG/WebP allow-list and the existing upload limit).
- Put the code in a new file `visual-style-packs.ts` next to `visual-style-samples.ts` (same service/router/`configure…` pattern, export via `index.ts`, mount in `src/server/app.ts`):
  - `GET /api/visual-style-packs` → `VisualStylePacksSchema` (all styles, all uploaded slots).
  - `PUT /api/visual-style-packs/:styleId/:slotId` (multipart `file`) → replaces the slot image and deletes the previous file from disk (also when the DB write fails: remove the new file, like the existing sample code).
  - `DELETE /api/visual-style-packs/:styleId/:slotId` → removes the DB doc and the file; 204/empty ok even if nothing was stored.
  - Validation: unknown `styleId` or a `slotId` that is not one of that style's slots → 400 with a clear AppError code; wrong MIME → existing `INVALID_FILE_TYPE`; missing file → `FILE_REQUIRED`.
- **Backward compatibility (important):** the old single sample (`visual_style_samples`, `GET/PUT /api/visual-style-samples`) must keep working and keep its tests. In `GET /api/visual-style-packs`, if a style has no `core` pack image but has a legacy sample, return the legacy sample as that style's `core` entry. When a `core` image is uploaded or deleted through the new route, also remove the legacy sample doc and its file so the two do not diverge. Mark the old endpoints as deprecated in MODULE.md but do not delete them in this task.
- Server tests (use the existing in-memory/mongo test setup of `visual-style-samples.test.ts`): store, replace (old file removed), delete, invalid style, invalid slot for that style (e.g. `props` on `strategic-map`), invalid MIME, missing file, legacy fallback to `core`, legacy removal when `core` is uploaded.

## Client (`src/client/features/project`)

- `api.ts`: `getVisualStylePacks()`, `uploadVisualStylePackImage(styleId, slotId, file)`, `deleteVisualStylePackImage(styleId, slotId)` (reuse the error handling pattern of `uploadVisualStyleSample`). `hooks.ts`: `useVisualStylePacks()`, `useUploadVisualStylePackImage()`, `useDeleteVisualStylePackImage()` invalidating the `['visual-style-packs']` query.
- `visual-style-preview.ts` stays for the bundled cinematic preview: when the `cinematic` pack has no `core` image, the bundled `cinematic.jpg` is still shown in the `core` tile as a non-removable fallback (no delete button for a fallback).
- `NewProjectForm.tsx`: replace the single preview block (preview image, download link, "Thay ảnh mẫu" button) with a **style pack panel** under the style `<select>`; split it into a new component `components/StylePackPanel.tsx` (+ `.module.css`) and keep `NewProjectForm.tsx` from growing. Panel behavior:
  - Heading "Bộ ảnh phong cách" and a counter `n/5 ảnh`. A one-line hint: "Tạo các ảnh này trong Flow (sao chép prompt bên dưới), rồi thêm vào Project Style References."
  - A responsive grid of 5 tiles (one per slot of the selected style). Each tile shows: the slot label (the `core` tile also shows a small "Primary" badge), the image (aspect 16:9, object-fit cover) or an empty dashed placeholder showing the Vietnamese `hint`, and buttons: **"Sao chép prompt"** (always), **"Upload"** / **"Thay ảnh"**, **"Xóa"** (only when an uploaded image exists), and a download link for existing images.
  - "Sao chép prompt" copies the slot's full `prompt` to the clipboard (reuse the existing clipboard helper pattern from `src/client/features/seo/components/ThumbnailPanel.tsx`: `copyThumbnailPrompt`; if it is generic enough, extract it to a shared client util instead of duplicating) and shows the existing toast/confirmation style ("Đã sao chép prompt").
  - Switching the style `<select>` switches the tiles. Upload uses a hidden `<input type="file" accept="image/*">` per tile (or one shared input with the slot stored in a ref). Disable buttons while a mutation runs and show the existing error toast on failure.
  - Do not change how the project itself is created: `visualStylePresetId` and the rest of the form payload stay as they are.
- Where else the old single sample is shown: grep for `useVisualStyleSamples`, `resolveVisualStylePreview` and any "Thay ảnh mẫu" text. The screenshot the user sent (select "Flat Cartoon", one thumbnail, "Thay ảnh mẫu", "Tải ảnh") is the create-project form. If another screen (for example the Studio visual-style select) shows the same sample, update it to the pack as well or tell me in the report that it only shows the select.
- Client tests: pack panel renders 5 slots for each style (strategic-map shows its own slot labels), empty vs filled tiles, copy-prompt writes the exact prompt (mock clipboard), upload calls the API with the right style/slot, delete calls the API and is hidden for the bundled fallback, switching style swaps the tiles; api tests for the three new calls (URL, method, error mapping).

## Out of scope

- No ZIP download of the whole pack, no image generation inside the app, no sending the pack to any AI provider, no change to scene prompts or the server visual-style presets (`ai/presets/visual-styles/*.md`).
- Do not remove the old `/api/visual-style-samples` routes, collection or tests.

## Docs and Status

Update `src/server/modules/file-store/MODULE.md` (new collection, routes, legacy fallback, deprecation note) and the project module doc that describes the create-project form if one exists; add the AGENTS.md Status line in the same commit.

## Verification (run and report real output)

`npm run typecheck`, `npm run lint`, the vitest files you added or touched plus `src/contracts`, `src/server/modules/file-store`, `src/client/features/project`, and `npm run build`. Do a manual browser check at 1920×1080: pick each of the 6 styles, copy a prompt, upload an image to one slot, replace it, delete it, reload the page and confirm persistence, and confirm that a style that had a legacy sample shows it in the `core` tile. Note that `app.test.ts` has a known pre-existing SPA fallback failure; do not try to fix it here.

## Report

Write `docs/superpowers/tasks/task-100-report.md` (untracked) with: commits, files changed, what you verified and how, what you could not verify, and any decision you made that deviates from this brief. Commit message: `feat(project): per-style reference packs` (one commit if it stays reviewable; otherwise contracts+server, then client). Do not push.
