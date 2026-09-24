# Phase 5 Prompt 1 — spec approved; proceed to implementation plan

Design spec `b2c516d` (video/render + SFX/BGM addendum combined) is approved. All four review decisions are accepted as written:

1. `renderEngine: 'remotion'` accepted at schema level, `RemotionRenderer` throws `RENDER_ENGINE_NOT_IMPLEMENTED` (501) — correct, avoids a future migration.
2. Silent stereo 48kHz audio track for scenes without voiceover/SFX — correct, keeps concat demuxer uniform.
3. Synchronous single-scene voiceover/preview, job-based for project-wide operations — correct given VieNeu's own serialization.
4. `child_process.spawn` with argument arrays, no `fluent-ffmpeg` dependency — correct, keeps the filter graph testable as pure data.

The `resolveFilePath` addition to file-store (safe path resolution scoped to project + file ownership check) is a good addition beyond the original brief — approved.

Volume math verified: `0.31622777` ≈ -10dB, `0.1` = -20dB exactly. Filter graph design (per-scene amix, then a second concat+BGM pass) is sound.

One non-blocking note for `MODULE.md`: the two-pass approach (concat scenes, then a second FFmpeg pass to mix in BGM) re-encodes the full video twice. Acceptable for this phase's scope — simpler and safer than a single filter_complex — but worth a one-line note as a known performance tradeoff for long videos, so it isn't mistaken for an oversight later.

Proceed to the implementation plan. Commit the plan, then wait for review before writing any code.
