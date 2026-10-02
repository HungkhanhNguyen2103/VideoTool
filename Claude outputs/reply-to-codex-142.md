# Task 45 spec — 3 independent fixes on the create-project / Studio flow

Three separate, independent items from Hung. Please treat each as its own change (own commit is
fine, or one commit per item) so they're easy to review separately.

## A. Fix broken layout: "Phong cách hình ảnh" field on the create-project page

File: `src/client/features/project/components/NewProjectForm.tsx` +
`NewProjectForm.module.css`.

Bug: the `.stylePicker` field lays the visual-style `<select>` (flex:1, min-width:0) side-by-side
with the 80px sample-image preview and the "Upload ảnh mẫu"/"Thay ảnh mẫu" button, all inside one
column of the outer 3-column grid (`.grid3`, alongside the simpler "Preset kịch bản" and "Nhà cung
cấp AI" single-input fields). Because that column is much narrower than the row of 3 items needs,
the flex select collapses to almost zero width — visually it renders as just the dropdown arrow
with no visible text (see Hung's screenshot).

Fix: change `.stylePicker` to stack vertically instead of horizontally — the `<select>` on its own
line, full width, then `.styleSampleControls` (the 80px preview + button) below it on the next
line. This is more robust than trying to widen the grid column, since it doesn't depend on the
surrounding grid's column count changing. Concretely: change `.stylePicker`'s `display: flex` to
`flex-direction: column` (drop `align-items: flex-start` or adjust as needed for the new axis), and
verify `.stylePicker .input` no longer needs `flex: 1` once it's a block-level full-width element in
a column layout (a plain `width: 100%` is enough — but don't fight the existing `.input` base class
if it already renders full width by default in this column context).

Verify with a screenshot of the create-project page at normal desktop width, confirming the
dropdown text ("Flat Cartoon", etc.) is fully visible and the preview/button sit cleanly below it
without visually competing with the "Thời lượng mục tiêu" field beside it.

## B. Remove Studio's per-project visual-style reference-image controls

Hung wants to simplify: keep the "Visual style" dropdown in Studio (still lets him pick a style per
project), but remove the per-project reference-image upload/get-prompt/clear controls entirely —
every project should just use the single shared sample image for its style (the one uploaded from
the create-project page, per Task 39's shared `visual_style_samples` collection), never a
per-project override.

### Client (`src/client/features/asset/StudioPage.tsx`)
Remove, but keep the `<select aria-label="Visual style">` itself:
- The hidden file input + `uploadStyleReference()` handler + its "Upload ảnh"/"Thay ảnh" button.
- The "Get prompt" button + `getVisualStylePrompt()` handler.
- The reference-image `<img>` preview.
- The "Xóa ảnh" button + `clearStyleReference()` handler.
- The now-unused `styleReferenceFile`/`filesById.get(project.customStyleReferenceFileId)` lookup
  and any now-dead state/refs feeding only the removed controls (`styleReferenceInputRef`, etc.).
Update `asset-api.test.ts` and any StudioPage test accordingly.

### Server — simplify the "latest wins" resolution back to shared-only
`src/server/modules/file-store/visual-style-samples.ts` — `listSamples()`: remove the per-project
comparison entirely (the `listProjectStyleReferenceCandidates()` loop and the
`file.createdAt.getTime() > new Date(current.updatedAt).getTime()` override). It should now just
return the shared `visual_style_samples` collection entries directly — nothing from any project's
`customStyleReferenceFileId` should ever affect what create-project shows for a style. This matters
because today a per-project Studio upload can silently override the shared preview image seen by
*every* project of that style — which is exactly the confusing behavior Hung wants gone.

### Remove now-dead server code, if nothing else calls it
Since nothing sets `customStyleReferenceFileId` anymore once the Studio UI is gone, check whether
these are now fully dead and remove them (grep confirms these exist today — locate the exact route
handlers wiring them, likely in `src/server/modules/script/routes.ts` and/or
`src/server/modules/file-store/routes.ts`, and the corresponding client `api.ts` functions
`uploadStyleReference`, `getVisualStylePrompt`, and the clear-reference call):
- The upload-style-reference route/handler and `setProjectStyleReference`-style service function.
- The get-visual-style-prompt route/handler (whatever endpoint backs `getVisualStylePrompt` in
  `src/client/features/asset/api.ts`).
- The clear-style-reference route/handler.
- `listProjectStyleReferenceCandidates` in `src/server/modules/project/service.ts` once its only
  caller (`listSamples()`) no longer calls it.
Leave the `customStyleReferenceFileId` field itself in the `Scene`/project schema and DB documents
alone (don't migrate/strip existing data) — just stop writing to it, stop reading it for
resolution, and remove the now-orphaned endpoints that only existed to manage it. If any of the
above turns out to still have another live caller, leave that piece in place and note it in your
report rather than guessing.

### Tests
- `visual-style-samples.test.ts`: update/remove tests that exercised the per-project "latest wins"
  override; add/keep a test confirming `listSamples()` reflects only the shared collection.
- Remove or update any test exercising the deleted routes/client calls.

## C. "Chọn file" — upload a reference document, auto-extract text into the brief textarea

File: `src/client/features/project/components/NewProjectForm.tsx` (the disabled "Chọn file" button
next to "Tư liệu tham khảo", currently hardcoded `disabled` with hint "Tải file: sắp có").

Hung had no preference between "auto-extract text" and "attach raw file only" — my call as the one
scoping this: auto-extract, since a raw-file-only version leaves him to manually copy-paste anyway,
defeating the point of the button. Behavior:
- Accept `.txt`, `.md`, `.docx`, `.pdf` (reuse whatever text-extraction the repo already has access
  to for docx/pdf — check `package.json` for an existing library like `mammoth` (docx) or `pdf-parse`
  /`pdfjs-dist` (pdf) before adding a new dependency; add one only if nothing suitable exists,
  preferring a well-maintained pure-JS/Node library with no native build step).
- On file selection: read/parse the file client-side if practical for the format (plain text/
  markdown trivially is), or via a small new server endpoint if docx/pdf parsing needs a
  server-side library — your call based on what's already available; either is fine as long as it
  doesn't block on anything requiring the render pipeline or AI providers.
- Extracted text is appended to the existing "Tư liệu tham khảo" textarea's current value (don't
  silently overwrite anything Hung already typed there) with a clear separator (e.g. a blank line),
  and the textarea's value + form state updates so it's included on submit.
- Reasonable size/type guard (e.g. reject files over some sane limit like 10MB, reject unsupported
  extensions with a toast) — reuse this repo's existing upload size-limit conventions if there's a
  precedent (check the asset/file-store upload middleware for an existing max-size constant).
- Update the "Tải file: sắp có" hint text once implemented (something like the file name once
  selected, or remove the hint if redundant with the button's own label).

### Tests
- A unit test for the text-extraction function per format you implement (at least .txt/.md; add
  .docx/.pdf coverage if a real parser was added).
- A test that selecting a file appends to rather than replaces existing textarea content.

## Explicitly out of scope for this task
- "Nhập từ ZIP" (RecentProjects.tsx) stays as the disabled "Sắp có" placeholder — Hung hasn't
  decided its scope yet, don't touch it.

## Report format
Same as always: commit hash(es), diff summary per item (A/B/C), lint/typecheck/tests/build status,
and a screenshot for A (dropdown fully visible) and a screenshot for B (Studio header now shows
only the style dropdown, no upload/get-prompt/image controls). For C, show one concrete example:
a real .docx or .pdf selected and the resulting appended text in the textarea.

## D. "Nhập từ ZIP" — prefill the create-project form from a ZIP (RecentProjects.tsx)

Clarified scope from Hung: this is NOT a full project restore. The use case is that Hung (or I,
Claude, in a separate conversation) prepares project setup content — title, brief, reference
material, suggested config — and hands it over as a ZIP instead of Hung having to copy-paste each
field by hand. Importing the ZIP should **prefill the create-project form fields**, not silently
create the project — Hung still reviews/edits and clicks "Tạo dự án" himself afterward.

### ZIP contract
- `project.json` at the zip root, an object whose keys are a subset of the create-project form's
  fields: `title`, `language`, `brief`, `referencesText`, `scriptPresetId`, `aiProvider`,
  `visualStylePresetId`, `targetDurationSec`, `chapterCount`, `renderSettings: { aspect, fps }`,
  `voiceId`. Locate whatever zod schema already validates the create-project submission (check
  `src/contracts/project.ts` for something like a `CreateProjectInput`/`NewProjectInput` schema)
  and derive the import schema from it with `.partial()` rather than hand-declaring field names
  again — keeps the two in sync automatically as the form evolves. Every field is optional; an
  absent field just leaves that form field at its normal default.
- Optionally, a `references/` folder inside the zip containing 0+ documents (`.txt`, `.md`,
  `.docx`, `.pdf` — reuse exactly the text-extraction you build for item C above). Extract text
  from each file (in filename sort order) and append it to `referencesText` from `project.json`
  (if present), separated by a blank line between each source and between `project.json`'s own
  `referencesText` and the extracted material.

### Server
New endpoint, e.g. `POST /api/projects/import-seed` (pick a name consistent with this repo's
existing route conventions — check how `importAssetsFromZip`'s route is registered in
`src/server/modules/asset/routes.ts` for the pattern: multer memory upload + `adm-zip` parsing).
It:
1. Parses the zip, reads `project.json`, validates against the partial schema (400 with a clear
   message on missing/invalid JSON or a schema violation).
2. Extracts text from any files under `references/` and appends per the rule above.
3. Returns the resulting prefill object as JSON. **Does not create or touch any project** — this
   is a pure parse-and-return endpoint.

### Client
`NewProjectForm` and `RecentProjects` are unrelated siblings today (see `ProjectInitPage.tsx`) —
the "Nhập từ ZIP" button lives in `RecentProjects` but needs to fill `NewProjectForm`'s fields.
Lift the shared state up to `ProjectInitPage.tsx`:
- `ProjectInitPage` holds a `prefill` state (the parsed import result, or null) and passes it as a
  new optional prop to `<NewProjectForm prefill={prefill} />`.
- `ProjectInitPage` also owns the import-zip file input + the call to the new endpoint, and passes
  a callback (e.g. `onImportZip: (file: File) => void`) plus a busy/error flag down to
  `<RecentProjects onImportZip={...} importBusy={...} />`, which triggers it from the existing
  "Nhập từ ZIP" button (remove `disabled` and the "Sắp có" pill; show a toast on parse failure).
- In `NewProjectForm`, accept the `prefill` prop and, in a `useEffect` keyed on it changing to a
  non-null value, call react-hook-form's `reset()` merging the current default values with the
  prefill's defined keys only (don't let an absent key in `prefill` blank out a field that already
  has a sensible default) — plus append any `prefill.referencesText` the same non-destructive way
  item C uses (don't discard anything Hung already typed in that textarea if he imports after
  starting to type; simplest correct behavior is fine here — you decide, note your choice in the
  report).

### Write down the contract for future reference
Add a short `docs/project-import-zip-format.md` (or wherever this repo keeps this kind of format
note — check for a `docs/` convention already in use) describing the zip's exact shape (the
`project.json` field list and the `references/` folder), since I (Claude) will often be the one
producing these zips in a separate conversation and need a stable, written contract to follow
rather than re-deriving it from the code each time.

### Tests
- Server: valid zip with full/partial `project.json` parses correctly; missing/invalid JSON
  returns 400; a `references/` file's extracted text is appended in the right order/place; a zip
  with only `references/` and no `project.json` (or vice versa) is handled sensibly (either works
  standalone — decide and test it).
- Client: selecting a zip populates the form fields via the callback path; a schema-invalid zip
  shows an error toast and leaves the form untouched.
