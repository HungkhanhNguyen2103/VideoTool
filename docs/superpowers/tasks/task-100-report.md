# Task 100 report — visual style reference packs

## Commit

- `84a8723 feat(project): per-style reference packs` on `main`. No push.
- The commit contains 19 Task 100 files. The requested report remains untracked.

## Changes

- `src/contracts/visual-style-pack.ts` and its test define five labeled slots for each of the six visual styles, exact English style blocks and subjects, Vietnamese hints, slot validation, and the sparse pack response schema.
- `src/server/modules/file-store/visual-style-packs.ts` and its route test own `visual_style_pack_images`, generated disk filenames, list/upload/delete routes, input validation, replacement cleanup, and legacy `core` fallback. The legacy sample service gained deletion for new `core` mutations. Old sample routes remain available.
- `src/client/features/project/api.ts`, `hooks.ts`, `visual-style-preview.ts`, and `components/StylePackPanel.tsx` with its CSS/test replace the create-project single sample with five prompt/upload/download/delete tiles and preserve the bundled cinematic `core` fallback. `NewProjectForm.tsx` still submits the same project payload. The reference-file input hiding rule was restored after review.
- `src/server/app.ts` mounts the new route through the file-store index. `src/server/modules/file-store/MODULE.md`, `src/server/modules/project/MODULE.md`, and `AGENTS.md` document the behavior and verified status.
- Studio's visual-style control is only a select; it does not display the old sample, so no Studio panel changed.

## Verification

- Source comparison script: all 6 style blocks and 30 SUBJECT strings in the contract match `Claude outputs/style-reference-packs.md` exactly.
- `npm run typecheck`: pass, including after the final CSS correction.
- `npm run lint`: pass, including after the final CSS correction.
- `npx vitest run src/contracts src/server/modules/file-store src/client/features/project --no-file-parallelism --maxWorkers=1` with `MONGOMS_SYSTEM_BINARY=C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe`: 21 files, 95 tests passed.
- `npm test -- --no-file-parallelism --maxWorkers=1` with the same MongoDB binary: 98 files passed, 1 skipped; 1113 tests passed. This run preceded the final CSS-only restoration of `.hiddenInput`; the two affected client tests were rerun afterward: 2 files, 5 tests passed.
- `npm run build`: pass after the final CSS correction. Vite reported its existing informational warning for a bundle above 500 kB.
- `git diff --cached --check`: pass before commit. All 19 staged blobs were checked for CR bytes; none had any, so the commit stores LF line endings.
- Disposable in-memory MongoDB browser server at `127.0.0.1:3100`: selected each of six styles and observed five correct slots, including strategic-map's own labels. At a requested 1920×1080 DOM viewport, `innerWidth`/`innerHeight` initially measured 1920/1080, document width measured 1905, and five tiles fit in one row. Clicking “Sao chép prompt” showed the confirmation toast. Uploading a local bundled JPEG to strategic-map `map` showed its image and 1/5 count. Clicking “Xóa” returned 0/5, and the empty state persisted after reload.
- A read-only review found and fixed the unrelated reference-file input visibility regression. No other Critical or Important issue was identified.

## Limits and decisions

- The browser permission gate declined the replacement upload. Its stated reason was that the user declined upload approval for `http://127.0.0.1:3100`; the browser tool forbade retrying through another surface or workaround. Replacement behavior passed the Mongo-backed route test but was not repeated live in the browser.
- A live browser legacy-sample fallback check was not completed after that upload denial. The route test verifies both fallback and removal of the legacy document and file on new `core` upload/delete.
- The browser's 1920×1080 screenshot displayed only its smaller visible pane and black space elsewhere. DOM viewport and element geometry were used for the exact-size layout check; no 1920×1080 screenshot artifact was saved.
- The browser confirmation toast appeared after prompt copy, but its virtual clipboard reader returned empty; the client test verifies that the exact full prompt is passed to `writeText`.
- The style select now spans the form grid width so five reference tiles fit at the primary desktop viewport. The project creation request and stored project shape were not changed.
