# Phase 5 Prompt 2 — Remotion Render Engine (Design Brief)

Phase 5 Prompt 1 is complete and accepted. This prompt fills in the `RemotionRenderer` stub left in `src/server/modules/video/remotion-renderer.ts` (currently throws `RENDER_ENGINE_NOT_IMPLEMENTED`, 501) with a real implementation, and lets the Studio UI actually select the Remotion engine.

Design-only prompt: commit a spec, then wait for review before implementation.

---

## 0. External prerequisite (new)

`@remotion/renderer` needs a compatible Chromium browser to render frames. By default it downloads one on first use (similar to how Playwright manages its own browser). Document this in `MODULE.md` as an external/first-run prerequisite, same category as the FFmpeg/ffprobe binaries and the VieNeu TTS server from Prompt 1 — not something this prompt manages or bundles.

---

## 1. Where the Remotion project lives

New top-level directory `src/remotion/` (sibling to `src/server`, `src/client`, `src/contracts`) — this is Remotion's own bundle target, built at render time via `@remotion/bundler`'s `bundle()` (webpack under the hood), **not** part of the server's `tsup` build or the client's Vite build.

**Important build-isolation requirement:** verify neither `tsup` (server build) nor Vite (client build) picks up `src/remotion/**/*.tsx` — check `tsconfig`/build tool include-exclude globs and adjust if needed so `npm run build` doesn't try to compile React/JSX through the Node-only server bundle. Confirm this explicitly in the spec and flag it as a review focus item — a build config oversight here would silently break `npm run build` or bloat the server bundle with unused React/webpack code.

Files:
- `src/remotion/index.ts` — Remotion entry point (registers the root).
- `src/remotion/Root.tsx` — `<Composition>` registration.
- `src/remotion/VideoComposition.tsx` — the composition component (renders scenes as a `<Series>`/sequence of per-scene segments).
- `src/remotion/SceneSequence.tsx` — one scene's visual + audio layers.

---

## 2. New npm dependencies

```
npm install remotion @remotion/renderer @remotion/bundler
```

Optionally add `@remotion/cli` as a dev dependency and an npm script for local visual iteration on compositions (matching the reference tool's old `remotion preview` script):

```json
"remotion:preview": "remotion preview src/remotion/index.ts"
```

This script is a developer convenience only — it is never invoked by the render pipeline itself. Include it if trivial; skip it and note why if it conflicts with the existing script conventions.

---

## 3. Composition props and dynamic duration

Remotion supports `calculateMetadata` on a `<Composition>` — an async function that computes `durationInFrames`/`fps`/`width`/`height` from the actual input props at render time. Use this instead of a fixed-duration composition, since every project has a different total length.

Props shape (design the exact Zod/TS type in the spec, this is the required content):

```ts
type RemotionInputProps = {
  fps: number;
  width: number;
  height: number;
  scenes: Array<{
    id: string;
    assetType: 'image' | 'video';
    assetRelPath: string;       // relative to the Remotion public dir, resolved via staticFile()
    voiceRelPath: string | null;
    sfxRelPath: string | null;
    durationSec: number;
  }>;
  bgmRelPath: string | null;    // relative path, or null if no project BGM
};
```

Frame math: `durationInFrames = Math.round(totalDurationSec * fps)` for the whole composition; each scene's `<Sequence from={cumulativeFrames} durationInFrames={Math.round(scene.durationSec * fps)}>`.

---

## 4. Getting files into Remotion's reach — public-dir copy strategy

Remotion's headless renderer serves files through its own bundle's `publicDir`, resolved via the `staticFile()` helper — it does not read arbitrary absolute filesystem paths from inside the composition, and it should not depend on the main Express API server being up and serving `/files` during a render (that would couple render correctness to server uptime/port for no good reason).

**Required approach:**

1. Maintain one stable `publicDir` on disk (new env var `REMOTION_PUBLIC_DIR`, default something like `./data/remotion-public`).
2. Bundle the Remotion project **once** (cache the bundle result as a module-level singleton — bundling is the expensive step, do not rebundle per render, same pattern as `getTtsClient()`/`getFreesoundClient()` singletons from Prompt 1).
3. Before each render (full or preview), create a fresh per-render subfolder under `publicDir` named by a new ULID (`renders/{renderId}/`). Resolve every needed file through file-store's `resolveFilePath(projectId, fileId)` and copy (not symlink — stay portable across Windows) each into that subfolder with predictable names (e.g. `scene-01-asset.png`, `scene-01-voice.wav`, `scene-01-sfx.mp3`, `bgm.mp3`).
4. Build `RemotionInputProps` with paths relative to `publicDir` (e.g. `renders/{renderId}/scene-01-asset.png`), used inside the composition via `staticFile(relPath)`.
5. Call `renderMedia({ composition, serveUrl, codec: 'h264', outputLocation, inputProps })`.
6. Read the output file into a buffer (matching `VideoRenderer`'s existing `Promise<Buffer>` return type), then delete the per-render subfolder in `finally` — success or failure.

Document this decision explicitly in the spec (this is a real design choice with a real alternative — passing HTTP URLs against the running server's own `/files` route — state why the copy-based approach was chosen or, if the spec proposes the HTTP-URL alternative instead, justify that trade-off explicitly; either is acceptable but must be a stated decision, not an assumption).

---

## 5. Rendering the scenes — no silent-audio tricks needed

Unlike the FFmpeg renderer (which needed generated silent audio tracks so the concat demuxer had uniform streams across segments), Remotion composites layered React components directly — there is no concatenation step and no uniform-stream requirement. Simplify accordingly:

- `assetType: 'image'`: `<Img src={staticFile(assetRelPath)} style={{ objectFit: 'contain', width: '100%', height: '100%' }} />`, held for the sequence's full duration.
- `assetType: 'video'`: `<OffthreadVideo src={staticFile(assetRelPath)} style={{ objectFit: 'contain', width: '100%', height: '100%' }} />` (prefer `OffthreadVideo` over `Video` for render-time frame accuracy), clipped to the sequence's duration by the enclosing `<Sequence>`.
- Wrap each scene in `<AbsoluteFill style={{ backgroundColor: 'black' }}>` so the letterboxing behavior matches the FFmpeg renderer's `pad=...:color=black`.
- `voiceRelPath`, if present: `<Audio src={staticFile(voiceRelPath)} />` at full volume.
- `sfxRelPath`, if present: `<Audio src={staticFile(sfxRelPath)} volume={SFX_VOLUME_NUMBER} />`. **Reuse the exact same level as the FFmpeg renderer** — export a numeric counterpart of `SFX_VOLUME`/`BGM_VOLUME` from `src/server/modules/video/docs.ts` (currently string filter-value constants `'0.31622777'`/`'0.1'`; add `Number(SFX_VOLUME)`/`Number(BGM_VOLUME)` or equivalent shared numeric exports) so the two render engines sound consistent at the same mix levels.
- If neither `voiceRelPath` nor `sfxRelPath` is set: simply omit the `<Audio>` components — no silence generation needed.
- `bgmRelPath`, at the composition root level (not per-scene): `<Audio src={staticFile(bgmRelPath)} volume={BGM_VOLUME_NUMBER} loop />`, spanning the whole composition. Remotion's `<Audio loop>` handles looping natively — no `aloop`/`atrim` filter construction needed.

`renderScenePreview` builds the same composition with exactly one scene and no `bgmRelPath` (matching the FFmpeg preview's scope — one scene, no project BGM).

---

## 6. `RemotionRenderer` implementation

Replace the stub in `src/server/modules/video/remotion-renderer.ts`:

```ts
export class RemotionRenderer implements VideoRenderer {
  async renderScenePreview(project: ProjectDetail, scene: SceneDoc): Promise<Buffer> { ... }
  async renderFullVideo(project: ProjectDetail, appendLog: (msg: string) => Promise<void>): Promise<Buffer> { ... }
}
```

Both methods: resolve file paths, stage the public-dir copy, build props, call `renderMedia`, read the output buffer, clean up. `renderFullVideo` calls `appendLog` at reasonable milestones (staging complete, render started, render complete) — `renderMedia` supports an `onProgress` callback; forward a coarse progress log line at meaningful intervals (e.g. every 10%), not once per frame.

`getVideoRenderer(engine)` in `src/server/modules/video/index.ts` (from Prompt 1) already branches on `RENDER_ENGINES` — no change needed there beyond returning the real `RemotionRenderer` instance instead of the stub.

---

## 7. New project-service method — enabling the engine switch

Prompt 1 added `renderEngine` to the project schema (default `'ffmpeg'`) but no method to change it after creation. Add:

```ts
setProjectRenderEngine(projectId: string, engine: RenderEngine): Promise<ProjectDetail>
```

Atomic single-field update, same pattern as `setProjectBgm`/`setProjectRenderFile` — `$set` + `$inc: { version: 1 }`. Export from `project/index.ts`.

Add a route: `PATCH /:id/render-engine`, body `{ engine: 'ffmpeg' | 'remotion' }`, calls `setProjectRenderEngine`, returns updated `ProjectDetail`. Mount in the existing `video` router (or `project` router if that fits the existing route ownership better — Codex's call, document the reasoning).

---

## 8. Studio UI changes

The Studio page currently shows a disabled "Remotion (coming soon)" badge next to the FFmpeg engine indicator (from Prompt 1). Make it a real, clickable toggle:

- Two-option selector (FFmpeg / Remotion), calls the new `PATCH /render-engine` route, refreshes project state on success.
- No other UI changes needed — the existing Preview/Render buttons already call the same routes regardless of engine; the server-side factory dispatches to whichever `VideoRenderer` implementation is selected.

---

## 9. Tests

Headless Chromium rendering is heavy for a test suite (bundling + browser launch + frame rendering per test). Mirror the FFmpeg-binary approach from Prompt 1:

- **Pure unit tests, no Remotion runtime required:** frame-math helpers (`durationInFrames`, per-scene `from`/`durationInFrames` calculation), props-building from a `ProjectDetail`/scene list (mock `resolveFilePath`), and the public-dir staging logic (mock `fs` copy calls, assert correct relative paths are generated and cleanup happens in `finally` even on a simulated failure).
- **Conditional integration test:** detect whether `@remotion/renderer` can successfully launch its browser in this environment (small probe, similar spirit to the FFmpeg/ffprobe binary check). If it can, render one tiny scene (a 1x1 or small generated fixture image + short silence/no audio) through the real pipeline and assert a valid non-empty MP4 is produced. If it cannot, skip with an explicit documented reason — do not silently claim full Remotion coverage when the environment can't actually launch a browser.
- Route test: `PATCH /:id/render-engine` updates `renderEngine` and is reflected in a subsequent `getVideoRenderer` call (can be asserted via the factory function directly, no need to run a real render in this test).

Document exactly which Remotion-dependent behaviors were verified for real versus documented as environment-gaps, in both `MODULE.md` and the acceptance report — same discipline as Prompt 1's FFmpeg verification.

---

## 10. `MODULE.md` additions

Cover: the Chromium prerequisite and first-run download behavior, the public-dir copy strategy and why (vs. the HTTP-URL alternative), the bundle-once-render-many caching approach, frame-math/`calculateMetadata` usage, volume constant parity with the FFmpeg renderer, cleanup guarantees, and any environment limitation encountered while testing (e.g., sandboxed/headless environments sometimes need extra Chromium launch flags — document if this comes up, don't silently work around it without a note).

---

## 11. Commit discipline

Same rules as every prior phase: `AGENTS.md` + `MODULE.md` updated per meaningful commit, no `git add -A`, no push.

Suggested order:
1. `feat(remotion): scaffold composition and build-isolation config`
2. `feat(project): add setProjectRenderEngine`
3. `feat(video): implement RemotionRenderer with public-dir staging`
4. `feat(video): add render-engine route`
5. `feat(client): enable Remotion engine toggle in Studio`
6. `feat(video): add Remotion tests (pure + conditional integration)`
7. `docs(phase5): record Remotion render engine acceptance`

---

## 12. Review questions before planning

1. Confirm the public-dir copy strategy (§4) versus the HTTP-URL-against-running-server alternative — state which was chosen and why in the spec; this is the single biggest architectural decision in this prompt.
2. Is bundling once and caching the bundle result (rather than rebundling per render) acceptable given the process lifetime of the worker — could a long-running worker process ever need to invalidate a stale bundle (e.g., after a code deploy without a restart)? State the assumption (likely: worker restarts on deploy, so a process-lifetime cache is fine) or propose an invalidation strategy if you think it's needed.
3. Should `renderMedia`'s `concurrency` option be left at its default (auto-detected) or exposed via an env var? Your call — state the reasoning.
4. Confirm the exact numeric volume values used for Remotion's `<Audio volume={...}>` match the FFmpeg renderer's constants bit-for-bit (both should resolve to the same `0.31622777`/`0.1` values) — this is a correctness requirement, not a style preference, since the two engines should sound the same at the same mix levels.

---

## 13. Out of scope for this prompt

- Scene transitions, subtitles, auto-ducking (same exclusions as Prompt 1, now for the Remotion path too).
- A Remotion-specific visual style different from the FFmpeg output (letterboxing/black background should match).
- Live preview scrubbing/timeline UI in the Studio page beyond the existing Preview Render button.
- Do not push.

---

## 14. Report format

When done:
1. Checklist of each section.
2. Commits with hashes.
3. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
4. Confirm whether Remotion's Chromium was available/launchable in this environment during verification, and exactly which tests ran for real versus were skipped/documented as a gap.
5. Decisions made outside this spec.
6. Blockers or open questions.
7. Confirm the full video/render module (both engines) is complete.
