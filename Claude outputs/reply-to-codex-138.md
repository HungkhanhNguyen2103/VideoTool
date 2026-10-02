# Task 43a approved + Task 43b (2.5D parallax) — PROTOTYPE ONLY

## Task 43a — approved (`fd17c91`)
I checked the grain crops for frames 45/46/47 and the flat-area crop. The
grain now jumps per held frame (2-frame hold visible), there's no lattice
on flat areas, and text stays clean. The user accepts the +53% render cost
on film-look scenes for now. A possible later optimisation, **not now**:
pre-grade still images once instead of applying a CSS filter every frame.

---

# Task 43b — 2.5D parallax: prototype and comparison

**This is a research prototype, not a feature.** Do not wire anything into
the app's render pipeline, schemas or UI. Put all code under
`scripts/prototypes/parallax/` (committing that is fine). Put the outputs in
the gitignored verification folder. The user will look at the results and
decide whether to build the real feature.

## Goal
Make a still image feel 3D: the foreground moves more than the background
during a slow camera move, instead of today's flat Ken Burns zoom. Compare
two techniques on real project images.

## Step 1 — depth maps
- Model: **Depth Anything V2 Small** (or explain a better option for our
  GPU). Run it in the existing Python TTS/Whisper environment on the RTX
  3050 4 GB. Load it lazily, `local_files_only` after a pre-download step,
  like Whisper.
- Measure load time, per-image time (1920×1080 input), and peak VRAM **with
  VieNeu and Whisper also loaded**. Also report the CPU time as a fallback
  reference.
- Save the depth maps as 16-bit PNGs and show them to me: send the image
  and its depth map side by side.

## Step 2 — two techniques, same 3 test scenes
Pick 3 Kodak images with different structure: (a) a person in the
foreground (the lab engineer), (b) an interior with depth (the boardroom),
and (c) one with a flat or unclear foreground.

**A. Depth displacement (single layer).** Displace pixels by depth while
the virtual camera moves (a WebGL shader in Remotion via `@remotion/three`
or a raw WebGL canvas, or a CPU/ffmpeg equivalent if simpler for the
prototype). No inpainting. Report how the edges stretch.

**B. Layer split + inpainting.** Split into 2–3 depth layers, inpaint the
background behind the foreground (e.g. LaMa or OpenCV Telea as a cheap
baseline, and say which), then move the layers at different speeds.
Report the time and VRAM for inpainting too.

For both: a 4–5 s move per scene, with a gentle camera push-in and a slight
lateral move. Amplitude must stay subtle (documentary, not a gimmick).
Render the same move with the current **Ken Burns** for comparison.

## Deliverables (verification folder, exact paths)
- Per scene: a side-by-side or back-to-back mp4 of **Ken Burns | A | B**,
  plus PNG stills at 0% / 50% / 100% for each, since I can only inspect
  images. Add a zoom crop on the foreground edge at 100% for A and B,
  which is where artefacts appear.
- A short table covering, per technique: offline preprocessing time per
  image, extra render time per scene versus Ken Burns, VRAM, and failure
  cases seen (halo, stretching, smeared hair or glasses, inpaint blur).
- Your recommendation: A, B, or "not worth it", with reasons, plus a rough
  estimate of what the production version would take (caching, backfill,
  fallback to Ken Burns, setting).

No changes to `src/`. Don't touch the Python server's production
endpoints, beyond a clearly separate prototype script or env if you need
one.

**STOP after this report.**
