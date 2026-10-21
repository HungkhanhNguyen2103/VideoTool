# Blender explainer spike

**Status: rendered and benchmarked.** Blender 5.2.2 LTS rendered the full 21-second animation at both 720×1280 and 1080×1920, 30 fps, Eevee, 16 samples. The RTX 3050 Laptop GPU was active. See `docs/superpowers/tasks/task-107-report.md` for timings, visual scores, and limits.

This is a stand-alone, procedural Blender spike for the first 21 seconds of the Tower Bridge reference. It does not integrate with Video Tool. The visual match is still rough: the bridge is recognizable, but the ships, towers, foam, and materials do not reach the reference quality.

## Install and run

The render used the existing Blender binary at `E:\Blender\blender-5.2.2-windows-x64\blender.exe`, supplied by the user. It reports Blender **5.2.2 LTS**, build hash `d13f752e3b9c`; no Blender files were copied into the repository. The system FFmpeg build on PATH provides `libx264`.

Pass `-BlenderPath` to `render.ps1` or set `BLENDER_EXE`. The wrapper creates `out/spike-scene.blend`, writes timestamped logs and one-second NVIDIA GPU samples under `out/logs/`, and keeps outputs under the ignored `out/` directory. Blender 5.2.2's render-format enum does not include FFmpeg, so `-Format ffmpeg` renders a PNG sequence and encodes it with system FFmpeg to H.264, `libx264`, `-preset medium -crf 22 -pix_fmt yuv420p`.

The wrapper accepts `-Start` and `-End` in seconds, with the end exclusive. At 30 fps, `-Start 0 -End 21` renders frames 1–630, whose timestamps are 0 through 20.9667 seconds.

```powershell
# One reference comparison still at t = 3 s, 540 x 960
& .\tools\explainer-3d\scripts\render.ps1 `
  -Timeline "timeline/spike-21s.json" `
  -Width 540 -Height 960 -Start 3 -End 3.033333 `
  -Samples 8 -Format png -Out "out/stills/frame-03s" `
  -BlenderPath "E:\Blender\blender-5.2.2-windows-x64\blender.exe"

# Full 21 s at 720 x 1280, 30 fps
& .\tools\explainer-3d\scripts\render.ps1 `
  -Timeline "timeline/spike-21s.json" `
  -Width 720 -Height 1280 -Fps 30 -Start 0 -End 21 `
  -Samples 16 -Format ffmpeg -Out "out/video/spike-720p.mp4" `
  -BlenderPath "E:\Blender\blender-5.2.2-windows-x64\blender.exe"
```

Both full-resolution passes completed: 720×1280 took 308 s to render and 8.7 s to encode; 1080×1920 took 464.2 s to render and 19.0 s to encode. At 30 fps, `-Start 0 -End 21` renders frames 1–630, with timestamps 0 through 20.9667 seconds. A separate still at t = 21 s uses frame 631, one frame beyond the animation.

The original reference is private. Extracted frames are held only in the ignored `reference/` directory; never copy them, the source watermark, or its subtitles into tracked files. This spike has no subtitles or audio.

## Layout

- `timeline/spike-21s.json` — declarative beats, reusable operation names, camera positions, and timing.
- `scripts/build_scene.py` — creates procedural geometry, materials, keyframes, and the Blender scene file.
- `scripts/render.ps1` — PowerShell wrapper for scene creation, PNG or H.264 output, logs, and GPU sampling.
- `reference/` — private, ignored frames extracted from the user's reference.
- `out/` — ignored renders, scene files, GPU samples, and logs.

## Design and known limits

- Blender target: **5.2.2 LTS** (current Windows x64 LTS selected on 2026-10-21). The scene builder detects the accepted Eevee engine identifier at runtime and checks version-specific sample settings.
- No third-party models, textures, or HDRIs are used. The water, wood grain, rocks, bridge, yacht, and sailing ship are procedural. The two boats are intentionally simplified and are the weakest asset match.
- Water uses Blender's Ocean modifier, its foam color attribute, and a procedural whitecap mask. The scene uses a pale room, soft area lights, subtle volume haze, and a smooth camera path.
- The Task 107 frame review showed no orange-red approach ramps. The final reference beat depicts longer, muted wood-colored approaches, so the timeline uses that appearance.
- The camera-facing right wall was removed after the first render showed that it occluded the bridge. `OceanModifier.spatial_size` is rounded up to an integer for Blender 5.2.2.
- Still comparisons show pale cyan water and a continuous camera path, but the foam is sparse and blocky; wood grain, suspension towers, and both boats are simplified. The model does not reproduce the reference closely enough for production use.
- The 720p and 1080p videos both contain 630 H.264 frames at 30 fps and decode without FFmpeg errors. UI playback was not available in this environment; the six comparison stills and full-file decode were checked.
- A repeated 720p frame produced identical decoded pixels. Raw PNG hashes differed only in Blender's `Date` and `RenderTime` text chunks.
- Eevee used 16 render samples with no denoiser. `nvidia-smi` sampled the RTX 3050 at peak 98% utilization and peak 2,592 MiB (720p); the 1080p pass peaked at 1,867 MiB. These are system-wide sampled memory figures.

## Folder size and reference privacy

Do not commit binaries, `.blend` files, renders, logs, or extracted reference images. `.gitignore` excludes `out/` and `reference/` for this folder.

## Blender references

- [Blender 5.2 LTS release and downloads](https://www.blender.org/releases/5-2/)
- [Blender 5.2 Ocean Modifier Python API](https://docs.blender.org/api/5.2/bpy.types.OceanModifier.html)
