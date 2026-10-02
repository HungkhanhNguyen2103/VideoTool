# Task 39 — shared sample image per visual style (upload on the create-project page)

## User problem
The user uploaded a Flat Cartoon reference in Studio for the Kodak project.
On the create-project page, Flat Cartoon still shows "Chưa có ảnh mẫu",
because that box only reads bundled static images (Task 30), while Studio
uploads are project-scoped (Task 31). The user wants:
1. an upload button **on the create-project page** itself (no project exists
   there yet), and
2. **shared** behaviour: an image uploaded for a style, from either place,
   becomes that style's sample shown on the create-project page.

## Required behaviour
- **Resolution rule, "latest wins".** For each `VisualStyleId`, the sample
  shown on the create-project page is the **most recent** of:
  (a) an explicit shared sample uploaded from the create-project page, and
  (b) any project's current `customStyleReferenceFileId` whose project's
      `visualStylePresetId` is that style (by file `createdAt`).
  If neither exists, fall back to the bundled static preview (cinematic),
  otherwise "Chưa có ảnh mẫu".
  Rule (b) makes the user's existing Kodak upload show up immediately, with
  no migration.
- **Create-project page.** Next to the preview box, add an "Upload ảnh mẫu"
  button (it becomes "Thay ảnh mẫu" when a sample is shown). It is
  image-only, uploads for the currently selected style, then refreshes the
  preview. Keep the existing "Tải ảnh" download link working for whatever
  sample is shown.
- **Studio** needs no UI change. Its uploads already count through rule (b).
  If Studio's "Xóa ảnh" clears the pointer, that project stops counting.
- No delete button on the create-project page for now. Replacing is enough.

## Storage question (please design this)
The explicit shared samples have no project, and `storeFile()` / the
`files` collection are project-owned today. Propose the smallest clean way
to store them. For example, a small `visual_style_samples` collection
`{ _id: styleId, storedPath, mimeType, originalName, createdAt }`, with the
file written under the files dir and served via the existing `/files`
static route. Or another approach, if simpler. Validate image MIME, reuse
the upload size limit, and never trust a client-supplied path.

## API sketch
- `GET /api/visual-style-samples` → `{ [styleId]: { url, filename,
  source: 'shared' | 'project', updatedAt } }`, containing only the styles
  that have one.
- `PUT /api/visual-style-samples/:styleId` (multipart `file`) → stores and
  returns the entry. Validate `styleId` against `VISUAL_STYLE_IDS`.

## Tests
Resolution rule (shared vs project, latest wins, fallback), invalid style
id → 400, non-image → 400, the client helper, and the legacy case where
there are no samples.

## Process
Reply with a short design (especially storage) before implementing. After
implementing, send a screenshot or still of the create-project page showing
Flat Cartoon with the Kodak image, and put it in the gitignored
verification folder.

**STOP after this report.**
