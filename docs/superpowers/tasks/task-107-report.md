# Task 107 — Blender spike report

**Status: complete.** Blender 5.2.2 LTS rendered the full first 21 seconds at 720×1280 and 1080×1920. The RTX 3050 Laptop GPU was used. The scene is recognizable, but its visual match is still rough; see the scores below.

## Commit and files

- Local `main` commit: `66eb1c6` — `feat(tools): Blender explainer-3d spike (first 21 s)`; not pushed.
- User-provided Blender: `E:\Blender\blender-5.2.2-windows-x64\blender.exe`, Blender 5.2.2 LTS, build hash `d13f752e3b9c`. No Blender binary was copied into the repository.
- The procedural builder, JSON timeline, render wrapper, README, and `.gitignore` are under `tools/explainer-3d/`. The report remains untracked as requested. Render files and reference frames are ignored.
- Blender 5.2.2's output-format enum has no FFmpeg option in this build. `-Format ffmpeg` therefore writes PNG frames and uses system FFmpeg/libx264 to create H.264 MP4 at CRF 22. The builder also rounds Ocean `spatial_size` up to the integer type Blender requires. The camera-facing room wall was removed after the first test showed it blocked the whole bridge.

## Comparison and visual scores

Comparison sheet, with private reference frames and the six Blender stills side by side:

`E:\ToolV2\ProjectHK\video-tool\tools\explainer-3d\out\compare\comparison.png`

The sheet and source frames stay under ignored folders. I followed the extracted reference frames at 21 seconds: they show muted wooden approaches, not orange-red ramps.

| Element | Score | Reason |
|---|---:|---|
| Water | 2/5 | Teal channel and wave movement read clearly, but the waves are chunky and repetitive. |
| Foam | 1/5 | Sparse, large white patches do not match the fine, dense whitecaps. |
| Wood and bark | 2/5 | Deck planks read as wood, but repeat uniformly and have no convincing bark detail. |
| Ropes | 2/5 | Cables and hangers appear, but the towers are plain uprights without the reference's tower structure. |
| Ships | 1/5 | The yacht is blocky and the sailing ship is too small and simplified. |
| Lighting and haze | 2/5 | The pale cyan palette is close, while room panels and haze look flat. |
| Camera motion | 2/5 | One smoothly keyed camera avoids cuts, but later framing and scale do not follow the reference well. |
| Overall | 2/5 | The scene reads as a bridge-building explainer but is not close enough for production. |

## Render timings

Both full passes used Eevee, 16 render samples, no denoiser, 30 fps, and 630 frames. Frame percentiles use Blender's per-frame `Time` log entries; p95 is nearest-rank. FFmpeg used `libx264 -preset medium -crf 22 -pix_fmt yuv420p`.

| Output | Median / frame | p95 / frame | Blender render | FFmpeg encode | Total | Peak sampled GPU memory / utilization |
|---|---:|---:|---:|---:|---:|---:|
| 720×1280 | 0.40 s | 0.70 s | 308.0 s | 8.7 s | 316.7 s (5m 17s) | 2,592 MiB / 98% |
| 1080×1920 | 0.70 s | 0.91 s | 464.2 s | 19.0 s | 483.1 s (8m 03s) | 1,867 MiB / 97% |

NVIDIA was sampled once per second: 287 samples for 720p and 446 for 1080p. Mean sampled utilization was 51.9% and 58.2%. Memory is the system-wide `nvidia-smi` reading, not a process-only figure. There were no out-of-memory errors. The H.264 files are 3.32 MB (720p) and 6.28 MB (1080p); retained PNG sequences use 653 MB and 1.42 GB.

The six 540×960 still tests used 8 samples. Wrapper wall times, including scene build and Blender startup, were 3.6 s (0 s), 7.8 s (3 s), 6.6 s (7.5 s), 4.5 s (10.5 s), 4.0 s (15 s), and 3.0 s (21 s).

## 92-second estimate

This is an extrapolation from 2,765 frames at 30 fps, not a measured 92-second render:

- 720p: `2,765 × 0.40 s` median = 1,106 s, or **18.4 minutes**. At p95: `2,765 × 0.70 s` = **32.3 minutes**.
- 1080p: `2,765 × 0.70 s` median = 1,935.5 s, or **32.3 minutes**. At p95: `2,765 × 0.91 s` = **41.9 minutes**.

## Determinism and verification

The same 720p frame (frame 316, 16 samples) was rendered twice. File SHA-256 values differed (`E028535AC81D48F667C9462CA4D44420C731A7568E76D1AA9AC10987FACD81DE` and `D280D359A9FE7F8F729D170D84DFD08E136E7B846C9E452453278ABBE6C154D4`), but decoded pixels and PNG IDAT pixel streams were identical. Only Blender's PNG `Date` and `RenderTime` text chunks differed.

`ffprobe` confirmed both MP4s are H.264, 30 fps, 630 frames, and 21.000 seconds. FFmpeg decoded both complete files with no errors. Python syntax, timeline JSON, PowerShell parsing, `npm run typecheck`, `npm run lint`, and `npm run build` passed; the build retains the existing Vite chunk-size warning. No application test suite was run. Manual UI playback was not available because the computer-use runtime failed to initialize; the six timed stills and complete video decodes were checked instead.

## Limits and recommendation

The weakest parts are the simplified boats, plain bridge uprights, sparse foam, uniform wood, and mismatched camera framing. The first 21 seconds only are present; narration, subtitles, and audio are out of scope. The reference includes a watermark and subtitles; neither was copied into the Blender render.

**Recommendation:** Yes, Blender is viable as an offline renderer on this RTX 3050: use Eevee at 16 samples and encode H.264 with FFmpeg CRF 22. Do not use this scene as the production look yet; improve tower architecture, ship silhouettes, water/foam shader, wood detail, and camera framing first.
