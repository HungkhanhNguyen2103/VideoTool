# Task 87 — Remotion baseline measurement plan

> **For agentic workers:** Phase 1 only. Capture measurements and stop before optimization; do not begin Phase 2 in this pass.

**Goal:** Produce a reproducible Rạch Gầm full-render baseline and a ranked bottleneck list without changing rendered output.

**Architecture:** Use the live API/worker render path and Remotion's existing renderer. Add only measurement instrumentation if required to expose data returned by the installed renderer; keep all project-level visual settings and render options unchanged. Store the report and any temporary, ignored measurement helpers under `data/files/.verification/task-87/`.

**Tech Stack:** Windows PowerShell, Node.js, `@remotion/renderer` 4.0.527, FFprobe, local API/MongoDB, Remotion job worker.

**Spec:** User attachment `Pasted text.txt` — Task 87, Phase 1.

## Global Constraints

- Do not change output quality/look or FFmpeg behavior.
- Run one full Remotion job only when no other heavy job is active; monitor machine resources every 2 seconds.
- Do not print or commit secrets; do not stage unrelated changes or run `git add -A`.
- Complete Phase 1's measurements, ranked bottlenecks and proposed order, then stop before Phase 2.

## Review Focus

- Renderer defaults may be implicit; record the actual effective concurrency and all options passed.
- `renderMedia` may expose a bounded slow-frame list; use the installed API result rather than estimating slow frames.
- The target project currently has film look disabled; report that a same-settings film-look cost is not measurable rather than silently enabling it.
- Per-frame telemetry and file probes must not alter scene settings, stored media, or the existing final render pointer beyond the explicitly requested full render.
- A job can be queued without a worker; verify progress and stop safely if no worker claims it.

## Tasks

### Task 1 — Preflight and asset inventory

- Read current project and renderer settings; verify no active full render.
- Record OS, CPU/logical processors, memory, GPU, Node/Remotion/Chromium, and all effective renderer options.
- Probe all 44 render-used visual assets for resolution, codec, frame rate, duration, bitrate, and size; flag oversized images and unusual video characteristics.

### Task 2 — Baseline render telemetry

- Run one full Remotion job at unchanged project settings.
- Capture timestamped phase/job logs, frame progress, returned slowest frames, and system CPU/memory/disk counters every 2 seconds.
- Map slow frames to scene and features; report only feature-cost comparisons that can be run without changing persisted project settings.

### Task 3 — Report and stop

- Write `data/files/.verification/task-87/baseline.md` with measured data, gaps/limitations, ranked bottlenecks and proposed optimization order.
- Update Status/module documentation and commit the measurement-only work if all required data is available.
- Stop before any Phase 2 optimization and await review.
