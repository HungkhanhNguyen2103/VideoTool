# Task 58 — Pipeline progress bar in Studio (client-only, derived data)

Goal: show the overall pipeline completion of a project at the top of Studio, computed purely from the project data already loaded in the client. No new API, no DB change, no new job.

## Pure helper (unit-tested)
Create `src/client/features/asset/pipeline-progress.ts`:

```ts
export type PipelineStepKey =
  | 'script' | 'visualPrompt' | 'assets' | 'voiceover' | 'sfx' | 'draft' | 'final';
export type PipelineStep = {
  key: PipelineStepKey;
  label: string;        // Vietnamese UI label
  weight: number;       // sums to 100
  done: number;         // items completed
  total: number;        // items expected (1 for whole-project steps)
  ratio: number;        // done/total, 0 when total is 0
};
export type PipelineProgress = { percent: number; steps: PipelineStep[] };
export function computePipelineProgress(project: Project): PipelineProgress;
```

Steps, weights and rules (weights are constants at the top of the file, with a comment that they are a rough effort estimate chosen by the owner and can be tuned):

| key | label | weight | done / total |
|---|---|---|---|
| script | Kịch bản & chia cảnh | 10 | 1/1 if `project.scenes.length > 0`, else 0/1 |
| visualPrompt | Visual prompt | 10 | scenes with non-empty `visualPrompt` / scenes |
| assets | Hình & clip | 35 | scenes whose render input is complete: image scene with `assetFileId`; video scene with a clip file AND an image/keyframe as `analyzeScene` defines it (reuse `analyzeScene` — do NOT duplicate its rules; count scenes whose status is neither `missing-asset` nor `missing-clip` nor `keyframe-only`) / scenes |
| voiceover | Voiceover | 15 | scenes with `audioFileId` / scenes |
| sfx | SFX | 5 | scenes with `sfxFileId` / scenes |
| draft | Render nháp | 10 | 1/1 if `draftRenderFileId !== null` |
| final | Render cuối | 15 | 1/1 if `renderFileId !== null` |

- `percent = Math.round(sum(weight * ratio))`, clamped 0–100.
- Zero scenes: every per-scene step has total 0, ratio 0, and does not throw.
- Pure function, no I/O, no Date, no randomness.

## UI
In `StudioPage.tsx`, above the scene list (near the existing readiness summary), add a compact panel:
- Heading "Tiến độ pipeline" with the percent as a number plus a progress bar (`role="progressbar"`, `aria-valuenow`).
- Under it, one line per step: label, `done/total`, small bar or check mark when `done === total && total > 0`.
- Collapsible (default collapsed to a single row: bar + percent; expand shows the step list).
- Recomputed from current project state on every render; must update after patch, voiceover, SFX, import ZIP and render without a page reload (use `useMemo` on the project object).
- Styles in `StudioPage.module.css`, matching existing tokens. Keep the scene card layout from `e0ab621` untouched.

## Tests
- Unit tests for `computePipelineProgress`: empty project; script only; all scenes done but no renders (expected percent by hand); everything done (100); video scene with keyframe only does NOT count as assets-complete; clip-cut/clip-padded scenes DO count (they are warnings, not blockers); rounding behavior.
- One UI test: panel renders the percent and expands to show steps.

## Out of scope
Server changes, new jobs, persistence of the percentage, Runner/Flow progress (the Runner is a separate tool and not observable here).

## Verification
Typecheck, lint, full tests pass. Open Studio on the Vasa project and compare the displayed `done/total` per step against the scene cards by eye; report any mismatch. One commit: `feat(studio): add pipeline progress panel`. Report hash, files changed, tests added, and the percent shown for the Vasa project.
