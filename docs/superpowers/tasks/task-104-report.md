# Task 104 — large render output and H.264 quality cap

Date: 2026-10-21  
State: Part C implementation and verification complete on `main`; work remains unstaged and uncommitted while awaiting planner review and `ACCEPTED-for-commit`.

## Output flow

`renderFullProject` now creates a render temp directory beside `FILES_DIR` and gives the renderer an `outputPath`. FFmpeg writes final/draft output to that path and reports its `stat` size. Remotion writes directly there, reports the `stat` size, and removes only its staged `public/renders/<renderId>/` inputs. The file store moves the output by rename, or streams it on `EXDEV`; neither full renderer reads the final MP4 into a `Buffer`.

On successful storage, the service updates the final or draft project pointer and removes the render temp directory. If file metadata insertion fails, the file-store restores the source path; the video service then moves the completed file to `render-failed/<projectId>-<timestamp>/render.mp4` and logs the path. If that preservation move also fails, it leaves the original temp directory in place and logs the error/path. If project-pointer mutation fails after storage, the file remains in `FILES_DIR`, and a Vietnamese job log includes its stored file ID and absolute path. Tests cover both final and draft pointer failures and the database insertion failure path.

This keeps the deliberate Task 104 Part A rollback deviation: a failed metadata insert restores the render source instead of deleting the stored copy, allowing the service to preserve the completed render. The rationale is also in `src/server/modules/file-store/MODULE.md`.

## Quality and disk estimate

Remotion uses `REMOTION_H264_CRF` 22 by default, overridable with validated `REMOTION_CRF` 0–51. FFmpeg scene encoding uses named `FFMPEG_H264_CRF = 22` and `FFMPEG_H264_PRESET = 'medium'`. Both draft and final Remotion output use the same CRF; draft output remains half scale. CRF is a quality target, not a maximum file-size guarantee. The one-second still-image output was 4,922 bytes, which is not a useful estimate for complex moving footage. No long-video before/after rate or subjective quality comparison was run.

Disk preflight runs before renderer invocation. It uses `stat` device IDs to group render temp, file-store, and Remotion staging paths; `statfs` available blocks for free space; and the following named estimates:

- Output: `durationSeconds × 3 MiB/s`.
- Per requirement path: estimated bytes × 1.25 plus a 1 GiB reserve.
- Remotion: referenced media bytes plus estimated normalized SFX bytes, in addition to output.
- FFmpeg: two output-sized working copies without BGM (scene segments plus final concat), or three with BGM (segments, concat, final BGM mix), plus normalized SFX temp files.
- Different render-temp and `FILES_DIR` devices: one additional output-sized copy for the `EXDEV` streaming fallback.

For a 3,600-second input, the output estimate alone is 11,324,620,800 bytes (10.55 GiB). With headroom and reserve, the output volume needs about 14.18 GiB before staged media. The FFmpeg output-volume estimate is about 27.37 GiB without BGM and 40.55 GiB with BGM, plus normalized SFX bytes; a separate `EXDEV` destination volume needs another estimated 14.18 GiB. These are formula results, not measured one-hour renders. The estimate is heuristic and can under- or over-estimate content-dependent CRF output.

## Long-video readiness audit

| Task §7 item | Status | Evidence and remaining limit |
|---|---|---|
| Render → store → serve → download; >2 GiB assumptions and Range | **ok** | Full output uses path/stat APIs (`src/server/modules/video/ffmpeg-renderer.ts:85,105,112`; `src/server/modules/video/remotion-renderer.ts:110,222-223,259-260`; `src/server/modules/file-store/service.ts:72-102`). File `sizeBytes` is a JS number (`src/contracts/file.ts:19-30`). Studio uses the stored `/files/<storedPath>` URL for `<video>` and draft download (`src/client/features/asset/StudioPage.tsx:812-813`); SEO download is `src/client/features/seo/components/PublishPanel.tsx:16-17`. Express serves it through `express.static` (`src/server/app.ts:63`), and a real Range request returned 206. No YouTube publishing/upload implementation was found under `src/server`. Real >2 GiB MP4 rendering/playback is **unverified**; the sparse 2.5 GiB file-store test passed without allocating the file in memory. |
| Free-space preflight | **fixed** | `render-disk-preflight.ts:5-7,30-35,68-103`; service integration is `video/service.ts:223-275`. It logs the estimate and raises `INSUFFICIENT_RENDER_DISK_SPACE` with a Vietnamese message. The pure test verifies device grouping and insufficient-space reporting; the real one-second render passed preflight. The preflight is a snapshot, not a cross-process reservation, so concurrent renders may overcommit a shared volume. A shared reservation mechanism is a follow-up, roughly 1–2 days including cross-worker coordination and failure cleanup. |
| 2–3 hour queue lease, timeout, retries, cancellation, and Mongo log size | **risk** | `job/service.ts:21-22,117-154` renews the active owner’s lock every 60 seconds against the five-minute recovery threshold. A fake-time integration test advances a running handler by 60 seconds and confirms it is not recovered. `job/repo.ts:6-7,19-32,57-64` limits logs to the newest 1,000 entries and 8 KiB per UTF-8 message (about 7.82 MiB plus BSON entry overhead). There is no whole-job timeout in `claimAndRun`; the worker awaits the handler (`src/worker/main.ts:19-20,32-35`). However, SIGINT/SIGTERM shutdown has a 10-second forced process exit (`src/worker/main.ts:61-64`), so a service restart can terminate a long render. Cancellation works at the queue boundary, but the render handler only checks before starting; FFmpeg/Remotion cannot be interrupted by the current flag. A cancel during render may still finish/store the output before the job is marked cancelled. Process loss can requeue and restart a render from the beginning up to configured `maxAttempts` (default 3); no resume exists. Graceful long-render shutdown and cooperative renderer cancellation are follow-ups, roughly 1–2 days including Windows child-process termination and race tests. A real 2–3 hour render job was not run. |
| Remotion stage, 900-scene props, concurrency, and memory | **risk** | `remotion-staging.ts:1,50-68` uses `copyFile`, not hard links, for per-scene source media; normalized SFX is written into the same stage, and cleanup removes the render directory. A synthetic 900-scene staging run copied 900 distinct 1 KiB images (921,600 bytes total) and produced 251,938 JSON bytes of `inputProps`. This is a synthetic empty-popup/image-only fixture; actual media sizes and an actual 900-scene render are **unverified**. `remotion-renderer.ts:148-154,222-227` leaves concurrency unset by default except depth scenes (1) or a configured override. Installed Remotion 4.0.527 defaults to `round(min(8, max(1, available CPUs / 2)))`; this host reports 12 available CPUs, yielding a default of 6. The prior failing-run 7.6 GB free-memory snapshot was not reproduced, and a 900-scene memory stress render was not run. Concurrency defaults were not changed. |

The task’s original 989-second, 28:51 render measurement implies about 105 minutes for 3,600 seconds at the same 1.75× real-time ratio; this is the task-provided measurement, not a new timing run. A worker crash or 10-second forced shutdown can still cause a full restart, and concurrent disk checks do not reserve capacity.

## Verification

- `npm run typecheck` — pass, exit 0.
- `npm run lint` — pass, exit 0.
- `MONGOMS_SYSTEM_BINARY='C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe' RUN_LARGE_FILE_TESTS=1 npx vitest run src/server/modules/video src/server/modules/file-store src/server/modules/job` — 22 files passed, 307 tests passed. Includes the opt-in sparse 2.5 GiB test.
- `MONGOMS_SYSTEM_BINARY='C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe' npm test` — 102 files passed, 1 skipped file; 1,293 tests passed, 1 skipped test; exit 0.
- `npm run build` — pass, exit 0; Vite reports the existing informational client-chunk warning above 500 kB.
- Real disposable one-second Remotion full render — passed. The 4,922-byte MP4 was stored through the path API; `/files/<storedPath>` returned 200 with matching Content-Length, and `Range: bytes=0-15` returned 206 with 16 bytes and matching Content-Range. The test used a temporary project, Mongo test database, media directory, and Remotion bundle directory, then removed them.
- `git diff --check` — pass; Git emitted only its existing LF-to-CRLF working-tree warnings for CRLF-configured files.

## `readFile` audit

Remaining production reads under `src/server/modules/video` are not final full-render reads:

- `depth-map-service.ts:38` reads a source image to send to the depth-map provider.
- `ffmpeg-renderer.ts:79` reads the small scene-preview MP4 returned by the preview route.
- `ai/presets/loader.ts:13` reads a local prompt markdown file.
- `remotion-renderer.ts:310` reads the small preview output; full renders use `stat` at line 259.
- `scene-duration-service.ts:48` reads source voiceover audio for duration probing.
- `word-timing-service.ts:26` reads source voiceover audio for alignment.

Test-only reads cover source fixtures, configuration/font/composition files, staged fixture bytes, retained/stored output assertions, and build artifacts (`remotion.test.ts`, `video.test.ts`, `source-encoding.test.ts`). None reads the final full-render output inside a production renderer.

## Tests changed

- `video.test.ts` now checks the exact stored render ID and active-scene IDs passed to `setProjectRenderFile`, and the existing final/draft/failure cases assert temp-directory cleanup or the sole retained `render-failed/render.mp4`. Two new cases prove final and draft project-pointer failures log the stored file ID/path and preserve the stored file. A real one-second full-render/path-store/Range acceptance test was added.
- `render-disk-preflight.test.ts` adds formula/EXDEV-copy estimation and same-device grouping/insufficient-space message coverage.
- `job.test.ts` adds 60-second lease renewal and UTF-8 truncation/1,000-entry rolling-window regressions. The UTF-8 test caught a boundary case that initially produced 8,194 bytes; the implementation now stays within 8,192 bytes.
- Earlier Part A/B tests remain in the same pending Task 104 change: file-store path move/EXDEV/rollback/sparse-file cases; renderer output-path/CRF/no-final-read cases; and config validation for `REMOTION_CRF`. Existing buffer assertions were updated to inspect path-based output and the renderer’s returned size.

## Remaining unverified items

- A real render larger than 2 GiB, a 3,600-second render, and a real 2–3 hour worker job were not run. The sparse 2.5 GiB file test and 60-second fake-time lease test are the available checks.
- Actual 900-scene production media staging size and memory behavior at 7.6 GB free are unverified; the reported staging and props measurements are synthetic.
- H.264 CRF 22’s rate/visual effect on the original long project is unverified; CRF output remains content-dependent.
- In-flight FFmpeg/Remotion cancellation, 10-second forced worker shutdown, and cross-process disk reservations remain named risks above.

## Files in this task change

`AGENTS.md`; `src/server/app.ts`; `src/server/config.ts`; `src/server/config.test.ts`; `src/server/main.ts`; `src/worker/main.ts`; `src/server/modules/file-store/{MODULE.md,index.ts,service.ts,file-store.test.ts}`; `src/server/modules/job/{MODULE.md,repo.ts,service.ts,job.test.ts}`; `src/server/modules/video/{MODULE.md,docs.ts,ffmpeg-renderer.ts,index.ts,remotion-renderer.ts,remotion.test.ts,service.ts,video.test.ts,render-disk-preflight.ts,render-disk-preflight.test.ts}`; and this report.
