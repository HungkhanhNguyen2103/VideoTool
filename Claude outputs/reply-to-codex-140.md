# Task 44 spec (revised) — AI-authored motion prompt for video-type scenes

Supersedes my earlier version of this file — same task number, Hung wants the AI to author
`motionPrompt` automatically as part of the existing visual-prompt generation job, not just a
manually-typed field. Manual editing in Studio is still included too (as an override), but AI
generation is now the primary path.

## Why
Hung's own external generation flow (outside this repo) turns the exported scene JSON into actual
assets. For image scenes it needs one prompt. For video scenes his flow needs **two** prompts:
prompt 1 = character/context (the existing `visualPrompt`), prompt 2 = `motionPrompt`, a short
animation/motion instruction fed to his image-to-video step. No video-generation API integration
is needed inside this repo — this is a data-contract + AI-prompt-generation + Studio UI change so
the export JSON carries what his external flow needs.

## 1. Contract changes
- `src/contracts/project.ts` — `SceneSchema`: add `motionPrompt: z.string().default('')` (same
  pattern as `sfxPrompt`). Add it to every other scene object literal that constructs a
  `SceneDoc`/`Scene` in the codebase — grep for `sfxPrompt: ''` to find every construction site
  (e.g. `scene-split.ts` `replacements()`) and add `motionPrompt: ''` alongside it.
- `src/contracts/asset.ts` — `FlowSceneExportSchema`: add `motionPrompt: z.string()`, always
  present (empty string for image scenes — a stable JSON shape is easier for the external flow to
  parse than a conditionally-present key).

## 2. AI generation (the main part)
This extends the existing visual-prompt generation job (`generateVisualPrompts` in
`src/server/modules/script/visual-prompts.ts`, built by `buildVisualPromptPrompt` in
`src/server/modules/script/ai/build-prompt.ts`, parsed by `parseVisualPromptBatch` /
`VisualPromptBatchSchema` in `src/server/modules/script/ai/output-schema.ts`).

- `VisualPromptSceneInput` (build-prompt.ts): add `assetType: AssetType` and
  `motionPrompt?: string` fields.
- `VisualPromptBatchSchema`: add `motionPrompt: z.string().trim().max(400).default('')` to each
  item in `prompts`.
- `buildVisualPromptPrompt()`:
  - Extend the JSON contract string passed to `systemMessage()` to also require a `motionPrompt`
    field per scene object: a short English animation/motion instruction (camera move + what the
    subject does — e.g. "camera slowly pushes in; the engineer turns his head down toward the
    camera he is holding") intended for an image-to-video motion model. Only write a non-empty
    `motionPrompt` when that scene's asset type is `video`; return an empty string for `image`
    scenes. Keep it to roughly one or two sentences. Existing motion prompts are references;
    preserve their intent, same as the existing visual/SFX prompt instruction.
  - In the per-scene user-message lines, add the scene's asset type and existing motion prompt,
    e.g.: `Scene N\nNarration: ...\nAsset type: image|video\nExisting visual prompt: ...\nExisting
    SFX prompt: ...\nExisting motion prompt: ... (or "(none)")`.
- `chapterScenes()` in `visual-prompts.ts`: pass `assetType: scene.assetType` and
  `motionPrompt: scene.motionPrompt` into each `VisualPromptSceneInput`.
- Skip/"already filled" logic in `generateVisualPrompts()`: a scene should count toward
  `fullyPrefilled` only if `visualPrompt !== '' && sfxPrompt !== '' && (scene.assetType !== 'video'
  || scene.motionPrompt !== '')`. This means: image-scene behavior is completely unchanged: a
  video scene whose motion prompt hasn't been generated yet is NOT treated as fully prefilled, so
  the chapter isn't skipped purely because visual/SFX prompts already exist. (Note: since
  `assetType` can be toggled by the user in Studio at any time, a scene switched to video *after*
  its visual/SFX prompts were generated will correctly be picked up as needing a motion prompt the
  next time this job runs for that chapter — mention this in your report so Hung knows he may need
  to re-run visual-prompt generation for a chapter after switching a scene to video.)
- Apply results: extend the `updates` mapping in `generateVisualPrompts()` to include
  `motionPrompt: item.motionPrompt` from the batch, alongside the existing `visualPrompt`/
  `sfxPrompt` mapping.
- `applyEmptySceneVisualPromptsWithResult` / `EmptyScenePromptUpdate` /
  `EmptyScenePromptWriteResult` (in `src/server/modules/project/service.ts`): add `motionPrompt?:
  string` to the update type, and mirror the exact existing `sfxPrompt` handling (the
  `hasPromptValue` check, the `arrayFilters`/`eligibleClauses` conditional-write-only-if-currently-
  empty pattern, the `set['scenes.$[id].motionPrompt']` line) so a scene's motion prompt is only
  overwritten by the AI job when it is currently empty — never clobbers a value Hung typed by hand
  in Studio. Add `updatedMotionPromptSceneIds: string[]` to the result type and compute it the same
  way as `updatedSfxPromptSceneIds`.
- `generateVisualPrompts()`'s log line: report a motion-prompt count too, mirroring how the SFX
  count (`changedSfx`) is currently logged (e.g. "... N motion prompts added; ...").

## 3. Server / export changes
- `src/server/modules/asset/service.ts` — `exportScenesJson()`: populate
  `motionPrompt: scene.motionPrompt` in the mapped object.
- Scene PATCH route (wherever `visualPrompt`/`sfxPrompt`/`assetType` are currently accepted —
  grep for the existing handler, likely in project or video routes) — accept and persist
  `motionPrompt` as a plain string field the same way `sfxPrompt` is accepted, so Hung can
  manually override the AI's suggestion.

## 4. Studio UI changes
- `src/client/features/asset/StudioPage.tsx`:
  - `patchScene()`'s body type: add `motionPrompt?: string`.
  - In the scene detail dialog, add a second prompt block labeled "Motion prompt" — same
    edit/save/cancel pattern as the existing "Visual prompt" editor. Show it whenever
    `expandedScene.assetType === 'video'` (hide for image scenes, but don't clear the stored value
    if the user toggles back and forth).
  - No change needed to the existing image/video toggle button itself.

## Explicitly out of scope
- No new AI provider integration, no new job type, no actual video-generation API call anywhere in
  this repo — `motionPrompt` is just AI-authored text, handed off in the export JSON exactly like
  `visualPrompt` already is.
- No change to `importAssetsFromZip`.
- No automatic "hero scene" selection logic — the existing manual per-scene image/video toggle in
  Studio already serves that purpose.

## Tests to add/update
- Contract: `motionPrompt` defaults to `''` on legacy/stored scenes without it.
- `buildVisualPromptPrompt()`: asserts the per-scene lines include asset type and existing motion
  prompt; asserts the system contract mentions the motionPrompt field and the image/video rule.
- `VisualPromptBatchSchema` / `parseVisualPromptBatch`: accepts a batch with `motionPrompt` present
  or absent (defaults to `''`).
- `generateVisualPrompts()` (visual-prompts.test.ts): 
  - a video-type scene with `visualPrompt`/`sfxPrompt` already filled but empty `motionPrompt` is
    NOT skipped (chapter is regenerated).
  - an image-type scene's skip behavior is unchanged from before this task.
  - the AI-returned `motionPrompt` is written only when the stored value is currently empty (a
    scene with a manually-typed motion prompt is untouched by generation).
  - the log line reports the motion-prompt count.
- `applyEmptySceneVisualPromptsWithResult` (project service test): writes `motionPrompt`
  conditionally on it being currently empty; returns `updatedMotionPromptSceneIds`.
- `exportScenesJson()`: returns `motionPrompt: ''` for an image scene and the stored value for a
  video scene.
- PATCH route: persists a manually-typed `motionPrompt`.

## Report format
Same as always: commit hash, a short summary of the diff, confirmation that lint/typecheck/tests/
build all pass. No render-verification needed (nothing touches Remotion or asset generation), so a
short example of one generated `motionPrompt` for a real video-type Kodak scene (plus a screenshot
of the new Studio motion-prompt textarea) is enough proof this actually produces sensible output.
