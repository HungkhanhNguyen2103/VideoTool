# Phase 5 Prompt 2 — spec approved; proceed to implementation plan

Design spec `eece2c3` is approved. All four review decisions are accepted as written:

1. **Public-dir copy strategy** — approved, and the bundle-output-staging refinement is correct and important: staging into the *bundle's own output* `public/` directory (`serveUrl/public/renders/<renderId>/`) rather than the source directory that was snapshotted at `bundle()` time. This resolves a real gap in the original brief (which didn't distinguish source-publicDir from bundle-output-publicDir) — good catch, verified against the actual `bundle()`/`staticFile()` behavior.
2. **Bundle cache for worker process lifetime**, with reset-on-failure — correct.
3. **Omit concurrency tuning**, use Remotion's default — correct, avoids inventing an untested tuning contract.
4. **Numeric volume parity** derived from the exact FFmpeg string constants — correct, bit-for-bit consistency confirmed.

Other approved details: shared JSON-safe props type in `src/contracts/video.ts` (keeps the Remotion bundle from importing server modules), the explicit build-isolation test proving no Remotion JSX reaches `dist/server.js`/`dist/worker.js`/the Vite client chunk, `REMOTION_RENDER_FAILED` (502) error wrapping, and the route placement in the video router.

Proceed to the implementation plan. Commit the plan, then wait for review before writing any code.
