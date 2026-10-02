# Task 43c — production 2.5D parallax (technique A) — DESIGN FIRST

The user reviewed the 43b prototype and chose **A (single-layer depth
displacement)** for production. B is dropped. This touches the Python
server, storage, jobs, props, Remotion and the UI, so **send a short
design first**. Implement only after I approve it.

## Scope
### 1. Depth maps (Python server, like `/api/align`)
- `POST /api/depth`: multipart image in, 16-bit PNG depth out.
- Depth Anything V2 Small, lazy-loaded, local files only, with a
  pre-download script and README steps (mirror the Whisper setup).
  CUDA→CPU fallback. Share the inference lock.
- No change to `/api/tts` or `/api/align` behaviour.

### 2. Storage and invalidation (mirror `wordTimings`)
- A new file purpose `depth`. Scene field, legacy default `null`:
  `depthMap: { assetFileId, fileId, eligible: boolean, score: number } | null`.
- It's only meaningful for image scenes. It's ignored (and cleared) when
  `assetFileId` changes or the scene becomes a video. Use a conditional write
  like `setSceneWordTimings`, so an in-flight job can't attach to a
  replaced asset.
- **Eligibility gate (pure, tested):** from the depth map, compute a simple
  score (e.g. depth spread and the size of the nearest region). Flat or
  ambiguous images (like the 43b "equipment" case) get `eligible: false`
  and keep Ken Burns. Propose the metric and threshold in your design,
  using the 3 prototype images as calibration.

### 3. Jobs
- Best-effort compute after an image asset is set (upload/import/generate).
  A failure never fails the asset operation.
- A bulk backfill job plus a Studio button "Tạo depth map", mirroring the
  word-timing backfill (sequential, cancellable, progress, per-scene
  failure isolation).

### 4. Rendering (Remotion)
- For image scenes with an eligible, matching depth map, replace Ken
  Burns with a **WebGL depth-displacement** layer: a textured quad whose
  UVs are offset by `depth × cameraOffset`, plus a gentle push-in. Motion
  is deterministic per scene id (variants like Ken Burns) and subtle, with
  named constants for amplitude. Scale up enough that no edge is ever
  exposed. Load both textures behind `delayRender`, and fail the render
  via `cancelRender` if they can't load.
- Everything else still applies on top: transitions (Task 42), the film
  look (43a; its colour filter must affect the WebGL output), pop-ups and
  lower thirds.
- Headless Chromium on Windows needs a working GL backend. Determine and
  set Remotion's `chromiumOptions.gl` (e.g. `angle`), and **prove** the GPU
  path is used, or report if it falls back to software GL.
- If WebGL is unavailable at render time, fall back to Ken Burns
  gracefully for that scene. Don't abort the render for that.

### 5. Setting
`parallax: z.enum(['auto', 'off']).default('off')` per project, with a
strict PATCH route and a duplicate copy. Default is **off**, so existing
renders don't change until the user opts in. Studio gets a select
"Hiệu ứng chiều sâu: Tự động / Tắt" next to the other render settings,
disabled for FFmpeg.

## What I want in the design reply (no code yet)
1. The Python endpoint contract and model setup.
2. The eligibility metric and threshold, with the 3 prototype images' scores.
3. The WebGL approach (`@remotion/three` vs a raw WebGL canvas), the GL
   flag, how texture loading and fallback work, and how the film-look
   filter composes with it.
4. Storage, invalidation and job wiring.
5. A test list.
6. **A quick feasibility measurement:** a throwaway Remotion render of one
   eligible scene with a minimal shader, reporting the render time versus
   Ken Burns for the same scene and whether GPU GL is active. This number
   decides whether we continue.

**STOP after the design reply.**
