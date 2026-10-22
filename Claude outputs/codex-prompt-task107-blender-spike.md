# Task 107 — Blender spike: reproduce the first 21 seconds of a reference 3D explainer, measure quality and render time

Work directly on `main` (no feature branch, no worktree). Never push. Do not stage temp files (`.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`, `docs/superpowers/plans/*`, the stray `01M4W…` files in the repo root). Keep LF line endings in commits. Follow AGENTS.md (rule 11: add the Status line in the same commit). Code, comments and commit messages are English. The user reads reports in Vietnamese-friendly plain language; keep the report factual and short.

## Why

The user (Hung) wants a new "Menu 2" in Video Tool: vertical (1080×1920, 30 fps) explainer videos made of ONE continuous 3D scene with a moving camera and no cuts, where each sentence of the narration triggers a change in the 3D model (add piers, hang ropes, raise towers, ...), with a Vietnamese voice-over and subtitles. His reference is a 92-second Chinese video explaining how Tower Bridge came about ("you are the inventor" framing). He wants quality as close to the reference as possible.
This task is a **spike**: build only the first 21 seconds in Blender, run it on his machine, and report (a) how close it looks, (b) how long each frame takes, so we can decide whether to build Menu 2 on Blender. Do NOT integrate with Video Tool in this task.

## Environment (facts, do not assume more)

- Windows 11 laptop: Intel i5-11400H, 24 GB RAM, NVIDIA GeForce RTX 3050 Laptop GPU (4 GB VRAM) plus Intel UHD Graphics, about 220 GB free disk. Use the NVIDIA GPU for rendering (check with `nvidia-smi` during a render that it is actually used; if Blender picked the Intel GPU, fix the Windows graphics preference or tell the user exactly what to click).
- Blender is NOT installed. Install the latest stable Blender LTS through `winget` (look up the exact package id first, for example `winget search blender`; do not guess it) or the official portable zip. Install outside the repo. Do not commit binaries. Record the exact version in the report and in `tools/explainer-3d/README.md`. If installation needs the user (admin prompt, large download approval), stop and say exactly what is needed instead of working around it.
- Blender's Python API and Eevee engine id differ between versions (for example `BLENDER_EEVEE_NEXT` vs `BLENDER_EEVEE`). Detect what the installed version accepts at runtime; do not hard-code one.
- `ffmpeg` is already available on the machine (the repo uses it); verify with `ffmpeg -version`.
- Run commands from PowerShell-compatible shell; keep all paths Windows-safe.

## Reference video

The user has the file; its path is `<REFERENCE_VIDEO_PATH>` (ask the user once if you cannot find it; common place is the Downloads folder or the Claude outputs folder). It is 1080×1920, 30 fps, 92.17 s, H.264, ~2 Mbps. It is another creator's video (watermark "@清茶小书"). Rules:
- Use it only as a private visual benchmark. Do not copy it, frames from it, its watermark, or its Chinese subtitles into the repo (the `reference/` folder must be git-ignored).
- Do not reproduce the watermark or any text in your render. No subtitles in this spike.
- Extract your own reference frames with ffmpeg for comparison (for example one frame every 1.5 s for 0–21 s).

## What the reference looks like (first 21 s)

Observed look: a clean 3D "diorama" in a pale cyan-white box room; a river channel with animated deep-teal ocean water, white foam/whitecap sparkles, slight translucent glow; soft light, soft shadows, mild atmospheric haze; wooden piers/poles with bark texture, a plank deck with weathered stone/wood texture, brown rope catenaries, a small white modern yacht, a toy-like wooden sailing ship, small rocks, two orange-red ramps at the end. The camera moves continuously with no cuts.

Beat storyboard (timestamps from the reference; the English glosses are an approximate reading of the Chinese subtitles, only to explain the action):

| t (s) | Narration idea | What changes in the 3D scene | Camera (approx.) |
|---|---|---|---|
| 0.0 | "This is a big river" | River channel with animated water, pale box room, a rock floating | Low, looking along the river, wave tops in foreground |
| 1.5 | "To make crossing easier" | Same | Slow move forward / up |
| 3.0 | "You built a bridge" | Deck planks drop in from above and align across the river | Camera rises to see the planks fall into place |
| 4.5 | "But piers block ships below" | Short piers appear under the deck; a white yacht arrives and cannot pass | High oblique view on deck and piers |
| 7.5 | "Reduce the piers and make them taller" | Fewer piers; tall wooden towers rise | Camera lowers and moves along the deck |
| 10.5 | "Hang the deck with ropes from the towers" | Rope catenaries and vertical hangers appear; yacht passes under | Pull back and rotate to show towers and ropes |
| 13.5 | "This is the suspension bridge you invented" | Full suspension bridge visible | Wide view, slight orbit |
| 15.0 | "But if the ship is tall" | A tall wooden sailing ship sails toward the bridge | Low wide view from the water |
| 16.5 | "It is still blocked by the deck" | Ship stops at the deck | Hold, slight push |
| 18.0 | "To raise the deck higher..." | Deck begins to rise; camera pulls back | Pull back and up |
| 21.0 | "...you need longer approach ramps" | Two orange-red ramps slide in at both ends | High, distant view of the whole channel |

Extract frames yourself and refine this storyboard before building; if your frames disagree with the table, trust the frames and note the difference in the report.

## Deliverables (all under `tools/explainer-3d/`, outside `src/` so the app build is unaffected)

- `README.md`: install steps actually used, how to run, folder layout, Blender version, known limits.
- `ASSETS.md`: every external asset (model, texture, HDRI) with source URL, license and author. Only CC0 or clearly permissive sources (for example Poly Haven, Kenney, Quaternius, ambientCG); procedural generation is preferred where simple (poles, planks, ropes, towers, ramps, rocks). No asset taken from the reference video. If the yacht and sailing ship cannot be found with a permissive license, build simple stylized versions in script and flag them as the weakest part.
- `timeline/spike-21s.json`: the declarative script for this spike. Schema: `{ fps, width, height, beats: [{ id, start, dur, ops: [...], camera: {...} }] }`. Ops are named, parameterised, reusable primitives (for example `river`, `drop_deck`, `add_piers`, `raise_towers`, `hang_ropes`, `spawn_ship`, `block_ship`, `raise_deck`, `slide_ramps`), not one-off hard-coded frames. Beat start/duration are in seconds (in the future they will come from the aligned Vietnamese MP3; for this spike use the reference timings). Keep the schema small and documented.
- `scripts/build_scene.py` (runs inside Blender): reads the timeline, builds the scene, and inserts keyframes for objects, ocean, ships and camera so the render is a pure function of the frame number (no runtime callbacks that depend on wall-clock time).
- `scripts/render.py` or `render.ps1`: CLI wrapper around `blender -b`: `--timeline`, `--width`, `--height`, `--fps`, `--start`, `--end`, `--samples`, `--out`, `--format png|ffmpeg`. Logs go to `out/logs/`.
- `.gitignore` entries for `tools/explainer-3d/out/` and `tools/explainer-3d/reference/`.
- Do not commit renders, reference frames or binaries.

## Water, lighting and camera (the hard parts, do them with care)

- Water: Blender Ocean modifier (or equivalent) with animated waves and foam/whitecap mask feeding a translucent teal shader; keep it bounded to the river channel inside the box room. Tune until wave scale and foam density look like the reference at the same camera distance. If Eevee cannot match the foam sparkle, say so and test one frame with Cycles (low samples) to show whether Cycles matters.
- Lighting: soft sun + pale HDRI or world colour, soft shadows, light haze, gentle filmic/AgX view transform; match the pale cyan-white palette.
- Camera: one camera animated with smooth easing (no cuts); document the keyframes in the timeline. Avoid jitter; check by playing the 720p output.

## Render plan and measurements (run all of it on the user's machine)

1. Still tests at 540×960 for t = 0, 3, 7.5, 10.5, 15, 21 s. Compare with the reference frames at the same times.
2. Full 0–21 s at 720×1280, 30 fps (630 frames), Eevee. Record seconds per frame (median and p95), total time, peak GPU memory (nvidia-smi sampling), disk used, samples/denoise settings.
3. If stage 2 time is acceptable, render 1080×1920 for the full 21 s, or for at least 30 representative frames if the full pass is too long; record the same numbers.
4. Determinism check: render one frame twice (same frame number, same settings) and compare file hashes; if different, report why (for example ocean seed, denoiser).
5. Extrapolate to 92 s (2,765 frames at 30 fps) from the measured seconds per frame, show the formula and the result for both resolutions. Mark it as an extrapolation.

## Report

Write `docs/superpowers/tasks/task-107-report.md` (untracked): commits, Blender version and install method, files, a **side-by-side comparison sheet** (reference vs ours at the six timestamps; save it under `tools/explainer-3d/out/compare/` and give the absolute path), a table scoring each element 1–5 against the reference (water, foam, wood/bark, ropes, ships, lighting/haze, camera motion, overall) with one line of reasoning each, the render-time table, the 92 s extrapolation, the determinism result, a list of what blocks closer parity (assets, shader, Eevee limits, VRAM), what you could not verify, and a recommendation (Blender yes/no, settings to use). Be honest: if it does not reach the reference, say how far.

## Verification

Run `npm run typecheck`, `npm run lint` and `npm run build` to confirm the app is unaffected by the new folder (nothing in `tools/` may be picked up by the repo's TypeScript/ESLint/Vite configs; adjust ignores only if needed and say so). Report real output.

## Out of scope

Integration with Video Tool or Menu 2, Remotion overlays (subtitles, stickers, inset photos), audio, Whisper alignment, VieNeu TTS, any UI, the remaining 70 s of the reference, and any Video Tool database or job change.

## Commit

One commit if reviewable: `feat(tools): Blender explainer-3d spike (first 21 s)` (the Status line in AGENTS.md in the same commit). Do not push. If you must stop early (Blender install blocked, GPU not used, assets missing), commit what works, document the blocker at the top of the report, and tell the user exactly what is needed.
