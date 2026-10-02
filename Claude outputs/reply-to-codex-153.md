# Task 56 - Render timing, smarter concurrency, draft render

## Why
Hung's full render is slow and sometimes fails; we have NO timing data. Machine: Windows, 24 GB RAM (often ~96% used), Intel UHD + NVIDIA RTX.
Facts from code (please re-verify): `remotion-renderer.ts` forces `concurrency: 1` whenever `inputProps.parallax === 'auto'`, even if no scene has a
depth map or the scene is a video; `REMOTION_CHROMIUM_OPTIONS = { gl: 'angle' }`; codec h264; progress is logged in 10% buckets only.
This task changes ONLY the Remotion path (FFmpeg engine untouched).

## Part A - Timing in the job log (separate commit `feat(video): log remotion render timings`)
In `RemotionRenderer.render` log with `appendLog` (when provided) and `logger.info`:
- bundle time (`getBundle`; also say "bundle cached" if reused), staging time, `selectComposition` time, `renderMedia` time, read-output time, total.
- Final summary line: `Remotion render done: <frames> frames in <s>s (<fps_eff> frames/s), concurrency <n>, <width>x<height>@<fps>, scenes <n> (video <v>, depth <d>), output <MB>`.
- Progress lines every 10% also include elapsed seconds and current frame rate estimate.
- Log the effective concurrency used (resolve it explicitly instead of leaving it implicit: log what you pass, or `default` if omitted).
- Log peak process RSS (process.memoryUsage().rss sampled each progress callback) and `os.freemem()` at start, so we can see RAM pressure.
No behaviour change in this commit. Tests with fake renderMedia/selectComposition verify the log lines.

## Part B - Concurrency only when it is actually needed (commit `perf(video): limit remotion concurrency only for depth scenes`)
- Force `concurrency: 1` only if at least one scene in the render is actually going to use depth/parallax
  (reuse `depth-eligibility.ts`: image scene with a usable depthMap and parallax 'auto'). Otherwise leave Remotion's default.
- Add optional env `REMOTION_CONCURRENCY` (positive int, validated in config.ts, documented in `.env.example`, empty = Remotion default) that overrides the default
  when depth is not forcing 1. Never allow it to exceed `os.cpus().length`.
- Log which rule applied (`concurrency 1: depth scenes present` / `env override N` / `default`).
- Tests: no depth scenes + parallax 'auto' -> no concurrency option; depth scene present -> 1; env override honoured and capped.

## Part C - Draft render (commit `feat(video): add draft render for fast previews`)
- `POST /:id/render` accepts optional body `{ draft?: boolean }` (default false; validate with zod, strict). Payload of the `render-full-video` job carries it.
- Remotion engine only. Draft = `scale: 0.5` and `everyNthFrame: 2` in `renderMedia` (confirm both options exist and behave as expected in the installed
  `@remotion/renderer` 4.0.527; if `everyNthFrame` changes the output fps or breaks audio sync, use scale only and say so). Also disable parallax in draft
  (no depth scenes processed) so draft is fast and low-RAM. Keyword popups and transitions stay on so the draft is representative.
- Draft output must NOT replace the project's final render file or set status 'rendered': store it as a separate file (purpose/label clearly draft) and show it in Studio
  as "Ban nhap" with a download/preview link; the final "Render video" behaviour is unchanged.
- FFmpeg engine: draft button disabled with tooltip "Chi co o engine Remotion".
- Studio: a second button next to "Render video": "Render nhap (nhanh)". Same busy/disabled rules as render. Job log shows "DRAFT" in the summary line.
- Tests: draft flag passes scale/everyNthFrame and skips parallax; final render path unchanged; draft file does not overwrite renderFileId; FFmpeg engine rejects draft (422).

## Do NOT
Add dependencies, change the FFmpeg renderer, change bundle caching, add GPU/NVENC settings (separate task after we have measurements), or alter composition visuals for non-draft renders.

## Verify and report
Commit hashes, focused tests, typecheck/lint EXIT codes. Then a REAL run on a small project (a few scenes, 720p, 24 fps; Hung can provide) and paste the full job log for:
(1) a normal render, (2) a draft render. Report render times, frames/s, peak RSS, and whether the draft is visually acceptable.
Note: `@remotion/studio` in `node_modules` was missing `dist/renderEntry.js` (broken install). Hung is reinstalling it; if renders still fail on your machine, say so and include the first error line.
