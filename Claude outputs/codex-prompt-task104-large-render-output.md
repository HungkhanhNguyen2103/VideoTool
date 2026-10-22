# Task 104 — Render output larger than 2 GiB must not be read into memory (and cap the H.264 size)

Work directly on `main` (no feature branch, no worktree). Never push. Do not stage temp files (`.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`, `docs/superpowers/plans/*`, the stray `01M4W…` files in the repo root). Keep LF line endings in commits. Follow AGENTS.md (rule 11: Status line in the same commit; import through each module's `index.ts`). Code, comments and commit messages are English; user-facing log/notice text is Vietnamese where the surrounding code already is.

## Why (real failure, reproduced by the user)

A full Remotion render of a 146-scene project (989 s, 1080p) ran for 28:51 and then failed with:
`Remotion render failed: File size (2543312697) is greater than 2 GiB` (HTTP 502 `REMOTION_RENDER_FAILED`).
Root cause: Remotion finished and wrote the MP4, then `RemotionRenderer.render` (`src/server/modules/video/remotion-renderer.ts`, the `this.readOutput(staged.outputPath)` call) reads the whole file into a `Buffer` with `fs.readFile`, which Node refuses above 2 GiB. The `finally` block then removes the staged output, so the 29 minutes of rendering are lost. The same buffer-based pattern exists in `FfmpegRenderer.renderFullVideo` (`readFile(concatPath)` / `readFile(outputPath)`), in `VideoRenderer.renderFullVideo(): Promise<Buffer>`, in `renderFullProject` (`video/service.ts`, passes `buffer: output` to `storeFile`) and in `createFileStoreService().storeFile` (`file-store/service.ts`, `writeFile(path, params.buffer)`). Also, `Remotion` renders `codec: 'h264'` with its default quality (no `crf`/`videoBitrate`), which produced about 20 Mbps (2.5 GB for 16.5 minutes); YouTube re-encodes anyway, so that size is wasteful.

## Goals

1. A full render (Remotion and FFmpeg, final and draft) never loads the final MP4 into memory; its size is not limited by Node's 2 GiB `readFile` limit.
2. The Remotion H.264 output is capped to a sane quality so typical long videos stay well below 2 GiB, while staying visually fine for YouTube.
3. A failure after a successful render must not silently throw the finished file away without telling the user where it was (see Failure handling).

## 1. File store: store from a path (`src/server/modules/file-store`)

Add `storeFileFromPath({ projectId, originalName, mimeType, sourcePath, purpose, extension? })` next to `storeFile` in `createFileStoreService`, exported through the module's `index.ts` and wired wherever `storeFile` is injected/configured today (video `service.ts` has a mutable `storeFile` configured for tests — mirror that for the new function; read how it is configured before changing it).
- Generate the id and `storedPath` exactly as `storeFile` does (same `extensionFor`).
- `stat` the source for `sizeBytes`; reject zero-byte files with a clear error.
- Move the source into `filesDir` with `rename`; if `rename` fails with `EXDEV` (different volumes, likely on Windows with a temp dir on another drive), fall back to streaming copy (`pipeline(createReadStream, createWriteStream)`) then unlink the source. Never use `readFile`/`writeFile` of the whole file.
- Insert the same `FileDoc` and return `FileSummary` as `storeFile` does. If the DB insert fails after the move/copy, remove the stored file and rethrow.
- `storeFile` (Buffer) stays unchanged for small files.
- Check how stored files are served to the browser/download (routes in `file-store/routes.ts` and anything that serves `render` purpose files). If any step buffers the whole file in memory or lacks `Range` support, report it and fix only if it is a small change; otherwise list it under limitations. Do not guess.

## 2. Renderers return a file, not a Buffer

Change `VideoRenderer.renderFullVideo` (in `ffmpeg-renderer.ts`) to write the final MP4 to a caller-provided output path and resolve with `{ sizeBytes: number }` (or just `void` plus a size read by the caller via `stat`; choose the simplest and keep one shape for both engines). `renderScenePreview` keeps returning a `Buffer` (previews are small and used by the preview route) — do not change it.
- `RemotionRenderer.render`: Remotion's `outputLocation` becomes the caller's path directly (no staged copy to read back), or is moved to it before the staging directory is removed. The final output file must survive the existing `finally` cleanup of the staged `public/renders/<renderId>/` directory (that directory is deleted; the output must live outside it). Replace the `Remotion read output time` log with a log of the final size (`output … MB`, already printed) and keep the memory log lines. Remove the `readOutput`/`readFile` option if it is no longer used (update tests that injected it).
- `FfmpegRenderer.renderFullVideo`: write the concat/BGM result to the caller's path (`-y` to the final path or rename the temp result there); no `readFile` of the final file.
- Draft renders follow the same path.
- `renderFullProject` (`video/service.ts`): create a temp directory with `mkdtemp` under the OS temp dir (or a `tmp` folder next to `FILES_DIR` if the OS temp is on a different volume — pick one, justify it in the report, and note the `EXDEV` fallback), pass the output path to the renderer, call `storeFileFromPath`, then `setProjectRenderFile` / `setProjectDraftRenderFile` exactly as today, and remove the temp directory in `finally`.

## 3. Failure handling

If the render succeeded but storing fails (move/DB), keep the rendered file instead of deleting it: leave it in a clearly named folder (for example `<FILES_DIR>/../render-failed/<projectId>-<timestamp>/render.mp4`), log its absolute path with `appendLog` in Vietnamese ("Render đã xong nhưng lưu thất bại; file giữ tại: …"), and still surface the original error. Do not do this for failures that happen before the render finishes. Mention in `MODULE.md` that this folder is not auto-cleaned.

## 4. Quality cap

- Remotion: add `crf` to `renderOptions` (H.264 CRF 22 as a named constant `REMOTION_H264_CRF`; allow an env override such as `REMOTION_CRF` validated to 0–51, default 22). Check the Remotion version in `package.json` and the `RenderMediaOptions` type before choosing between `crf` and `videoBitrate` (they cannot be combined); keep draft renders (scale 0.5) on the same CRF. Log the chosen CRF once per render.
- FFmpeg: read `buildSceneArguments`/`buildConcatArguments`/`buildBgmArguments`; if the scene encode has no explicit quality setting, add a sensible one (`-crf 22`, `-preset` as already used or `medium`); do not change audio settings. If it already sets quality, leave it and say so.
- Do not add a UI setting in this task.

## 5. Tests

- File store: `storeFileFromPath` with a small real file (moved, original removed, doc fields and `sizeBytes` correct), zero-byte rejected, `EXDEV` fallback via an injected `rename` that throws `EXDEV` (copy path used, source removed), DB failure removes the stored file. A test with a ≥ 2 GiB file must NOT allocate real memory: use `fs.truncate` on a temp file to create a sparse 2.5 GiB file only if the test is skipped by default (`it.skipIf(!process.env.RUN_LARGE_FILE_TESTS)`) and confirm the code path never calls `readFile` (spy), otherwise assert the `readFile` spy is never called with the output path in the small-file test.
- Renderers: Remotion renderer tests (`remotion.test.ts`) updated for the new return shape; assert the output file exists after the staged directory is cleaned, assert `readFile` is never invoked on it, assert `crf` is in the options passed to `renderMedia` and that an invalid env override falls back to 22. FFmpeg renderer tests updated for the path-based output; pure argument builder tests updated for any new quality flags.
- `renderFullProject` service tests (`video.test.ts`): final and draft store via path, temp directory removed in all cases, `setProjectRenderFile` receives the stored id and active scene ids as before, render succeeded + store failed keeps the file and logs the path, render failed before completion leaves nothing behind.
- All existing tests pass; keep `app.test.ts` known pre-existing SPA fallback failure untouched.

## 6. Docs and Status

Update `src/server/modules/video/MODULE.md` (renderers write to a path, no buffer of the final video, temp directory and failure-keep behavior, quality constant/env override, the 2 GiB limit and why) and `src/server/modules/file-store/MODULE.md` (`storeFileFromPath`). Add the AGENTS.md Status line in the same commit.

## 7. Long-video readiness (videos up to 1 hour)

The create-project form accepts durations up to 3600 s, so a 1-hour project is a supported input. Measured on the failing project: 989 s of video took 28:51 to render (about 1.75× real time), so a 1-hour video needs roughly 105 minutes and, even at CRF 22, an output of several GB. Audit the following, record each in the report as `ok` / `fixed` / `risk` with evidence (file and line), and fix only what is small and local to this task; anything bigger becomes a named follow-up in the report:

- Nothing in the render → store → serve → download chain assumes a file under 2 GiB or under 4 GiB (Buffers, `Number` size fields are fine up to 2^53, string/JSON conversions, ZIP, upload to external services such as YouTube publishing if that code exists). Studio preview/download of a multi-GB MP4 must use streaming with HTTP `Range`.
- Free disk space: add a preflight check before a full render that estimates the need (staged assets + output, and a second copy when the `EXDEV` copy fallback will be used) and fails early with a clear Vietnamese message instead of failing after an hour. Put the estimate formula and threshold in named constants and log the estimate.
- Job lifecycle: confirm a job running 2–3 hours is not reclaimed, duplicated or timed out by the queue/worker (lease/heartbeat/timeouts, `maxAttempts`), that cancel still works, and that the persisted job log cannot grow without bound or hit MongoDB's 16 MB document limit (check how `appendLog` stores lines and whether progress lines are capped).
- Remotion staging: with ~900 scenes, check what `remotion-staging.ts` copies into `public/renders/<renderId>/` (copies vs links), the resulting disk use, the size of `inputProps` for 900 scenes, and the concurrency/memory settings against the 7.6 GB free memory seen in the failing run. Do not change concurrency defaults without evidence.
- Add one test per fixed item and list unfixed risks with a rough size/time estimate for a 3600 s project.

## Out of scope

Chunked/parallel rendering, resume of failed renders, splitting a video into parts, a UI for quality, changes to scene previews, and any change to the Remotion composition. Do not touch the asset upload code from Task 103.

## Verification (run and report real output)

`npm run typecheck`, `npm run lint`, the touched vitest files plus `src/server/modules/video` and `src/server/modules/file-store`, and `npm run build`. Run a real Remotion render of a short project (or the existing acceptance render of a one-second MP4) and report the file size and that it was stored via the path route. If you can, produce a render whose output exceeds 2 GiB (for example by temporarily forcing a very low CRF on a long synthetic project) — if that is impractical, say so and rely on the sparse-file test. Do not claim the 2 GiB case is verified unless it was run.

## Report

Write `docs/superpowers/tasks/task-104-report.md` (untracked): commits, files changed, the final output flow, the CRF decision and expected size effect, serving/download findings, the 1-hour readiness table (item, status, evidence), verification, what you could not verify, any deviation. Commit message: `fix(video): stream large render output and cap h264 quality`. Do not push.
