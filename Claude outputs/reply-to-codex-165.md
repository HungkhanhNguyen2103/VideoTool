# Task 67 — Per-project logo watermark (upload in Studio, faint bottom-right in Remotion renders)

Hung wants a faded logo in the bottom-right corner of rendered videos, and the logo must be **uploaded per project** (each project can have its own, or none). Model it on the existing BGM flow: a nullable `…FileId` on the project, a file-store file with its own `purpose`, resolved and staged by `remotion-props.ts`. Remotion engine only; the FFmpeg engine ignores it (same as keyword pop-ups / film look / parallax, and the Studio already shows the hint `Chỉ áp dụng cho Remotion.`).

Read first: `AGENTS.md` section 6 (hard rules), `src/server/modules/project/MODULE.md`, `src/server/modules/video/MODULE.md`, and the visual-style-sample upload (`file-store/visual-style-samples.ts` + client `uploadVisualStyleSample`) which is the closest existing "PUT one image" pattern.

## Contract and data
1. `contracts/file.ts`: add `'logo'` to `FILE_PURPOSES`.
2. `contracts/project.ts` `ProjectDetailSchema` and `project/docs.ts` `ProjectDocSchema`: add `logoFileId: z.string().nullable().default(null)` (the `.default(null)` is what keeps legacy Mongo documents readable, no migration).
3. `project/service.ts`: map it in `toDetail`, set `null` in `createProject`, **reset to `null` in `duplicateProject`** (duplicates do not copy files, same as `bgmFileId`), and add `setProjectLogo(id, logoFileId | null)` using the existing `updateProject` single-version-bump pattern. Export it from `project/index.ts`. The `project` module stays the only writer of the `projects` collection.
4. `contracts/video.ts` `RemotionInputPropsSchema`: add `logoRelPath: z.string().min(1).nullable().default(null)`.

## Server
5. Upload middleware: add `uploadLogo` to `server/shared/upload.ts` (`multer` memory storage, **5 MB** limit, field `file`). Check how the error handler maps multer `LIMIT_FILE_SIZE` today and reuse it; the user must get a Vietnamese 4xx message, not a 500.
6. New `video/logo-service.ts` (keep routes thin, rule 5):
   - `replaceProjectLogo(projectId, file)`: validate mime is exactly `image/png | image/jpeg | image/webp` (reject everything else, including video/pdf/zip, which `ALLOWED_MIME_TYPES` otherwise allows) → `getProject` → `storeFile({ purpose: 'logo' })` → `setProjectLogo(new id)` → **only then** delete the previous logo file (best effort, log and swallow `ENOENT`). Order matters (rule 7): if anything fails, the old logo must still be intact and no orphan pointer may exist.
   - `removeProjectLogo(projectId)`: `setProjectLogo(null)` first, then delete the file. Idempotent when there is no logo.
   - Use `createFileStoreService` through its public `index.ts`, like `video/service.ts` does; wire it in `configureVideoModule` so tests can point it at a temp dir.
7. `video/routes.ts`: `PUT /:id/logo` (`uploadLogo`, 400 `FILE_REQUIRED` when missing, 400 `INVALID_FILE_TYPE` for non-image) and `DELETE /:id/logo`. Both return `ProjectDetail`. Mounted already under `/api/project`; no `app.ts` change needed for routes.
8. `app.ts` `beforeDelete`: also pass `project.logoFileId` to `deleteProjectFiles` so deleting a project does not strand its logo on disk.
9. The generic `POST /:id/files` accepts any `purpose` in `FILE_PURPOSES`, so `logo` becomes uploadable there too. Add the same image-only guard that `style-reference` has, so a non-image can never carry purpose `logo`.

## Remotion
10. `video/remotion-props.ts`: add `logoFileId` to `RemotionProjectSettings` (as **optional**, so existing tests/call sites that build settings objects keep compiling). When set: `resolveFile(project.id, project.logoFileId, resolver, 'logo', 'image/', 'Project logo')` and stage it as `renders/${renderId}/logo.${ext}` exactly like BGM; fill `logoRelPath`. A missing/deleted logo file must fail loudly with the existing `INVALID_RENDER_ASSET` error path, not silently render without it.
11. New `src/remotion/ProjectLogo.tsx` + pure layout helper in `src/remotion/logo-layout.ts` (unit-tested, same style as `frame-math.ts`):
    - Constants exported and named: `LOGO_OPACITY = 0.25`, box size = `0.18 * min(width, height)` (so 16:9 and 9:16 get the same physical size and 1:1 is sane), margin = `0.04 * min(width, height)` from the right and bottom edges.
    - `<Img src={staticFile(logoRelPath)}>` with `object-fit: contain`, `max-width`/`max-height` = box size, anchored bottom-right, `pointer-events: none`.
    - Render it in `VideoComposition.tsx` **once at composition level, after all `SceneSequence`s and outside `FilmLook`**. Do not render it per scene: it must not flicker, restart, or crossfade during scene transitions, and it must not get sepia/grain/vignette. Check `SceneSequence` z-order so keyword pop-ups still sit where they do today and are not covered or shifted.
    - Add `logoRelPath: null` to `DEFAULT_REMOTION_PROPS`. Fix any typed `RemotionInputProps` literals the compiler flags (`npm run typecheck` includes `tsconfig.remotion.json`).
12. Preview (`renderScenePreview`) and draft renders keep the logo (only `bgm` is dropped for previews today); do not special-case them.

## Client (Studio)
13. `asset/api.ts`: `uploadProjectLogo(projectId, file)` (PUT, `FormData`, copy the error-parsing pattern of `uploadVisualStyleSample`, return `ProjectDetailSchema`) and `removeProjectLogo(projectId)`.
14. `StudioPage.tsx`: in the media panel next to BGM add a compact "Logo video" block: hidden `<input type="file" accept="image/png,image/jpeg,image/webp">` behind a button (`Tải logo lên` / `Đổi logo`), a small preview resolved from `filesById.get(project.logoFileId)` via `api.fileUrlForSummary` on a light checkerboard background so transparent PNGs are visible, a `Xoá logo` button, `busy` handling like the neighbours, toasts `Đã cập nhật logo.` / `Đã xoá logo.` / the server message on error. Client-side pre-check: reject non-image or >5 MB with a Vietnamese toast before sending. Show `Chỉ áp dụng cho Remotion.` when `renderEngine === 'ffmpeg'` (still allow uploading). After upload/remove call `refresh()` and clear the file input's value so re-selecting the same file works. Keep new code in a small component file if it would push `StudioPage.tsx` further past the size rule (rule 10); do not reformat the existing one-line JSX.

## Tests
- Project: legacy doc without `logoFileId` reads as `null`; `duplicateProject` resets it; `setProjectLogo` bumps version once.
- `remotion-props`: logo staged as `renders/<id>/logo.<ext>` with `logoRelPath` set; `null` when no logo; wrong `purpose`, non-image MIME, or missing file → `INVALID_RENDER_ASSET`.
- `logo-layout`: bottom-right anchoring and size/margin for 1920x1080, 1080x1920, 1080x1080.
- Routes (follow `video.test.ts` / file-store route tests): PUT happy path returns `logoFileId` and the file exists; replacing deletes the previous file and keeps exactly one `logo` file; non-image → 400 `INVALID_FILE_TYPE`; no file → 400; oversize → 4xx Vietnamese message; DELETE clears and removes the file; DELETE with no logo is a no-op 200; `POST /:id/files` with `purpose=logo` and a PDF → 400; deleting the project removes the logo file.
- Client: `api` tests for upload (FormData, error mapping) and remove, in the style of `asset-api.test.ts`.
- All existing tests stay green.

## Verification (run, do not assume)
Typecheck, lint, full test suite, and `npm run build`. Then add `scripts/verify-remotion-logo.ts` modeled on `verify-remotion-film-look.ts`: render a short real Remotion clip with a transparent PNG logo at 16:9 **and** 9:16, extract a mid-clip still, and **look at it**: logo bottom-right, faint, not clipped, not tinted by film look, stable across a scene boundary. Then in the running app: upload a logo in Studio, render, confirm it in the playback, replace it, remove it, and render once more to confirm it is gone. Report what you actually saw, including the still paths.

## Constraints
- Update `AGENTS.md` `## Status` and Decisions log in the same commit (rule 11); mention that FFmpeg ignores the logo. Update `project/MODULE.md` and `video/MODULE.md` for the new field/service.
- No new dependencies, no `eslint.config.js` changes, no `.env` changes, no deletions of existing files.
- Stage only files you changed (`git add <paths>`, never `-A`); skip files that differ only by CRLF (`git diff --ignore-cr-at-eol --stat -- <file>`).
- One commit: `feat(video): per-project logo watermark`. Do not push.

## Report back (Hung will bring it to Claude for senior review)
Commit hash; list of files changed/added; tests added with counts before/after; the exact order of operations in `replaceProjectLogo` and `removeProjectLogo`; how the composition z-order was verified; the still images from the verify script; anything you deliberately did differently from this brief and why.
