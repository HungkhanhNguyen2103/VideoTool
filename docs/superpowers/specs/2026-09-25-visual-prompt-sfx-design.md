# Visual Prompt SFX Suggestions Design

## Goal

Make each visual-prompt generation run also suggest a short, optional SFX prompt for every scene, so the existing bulk SFX job has useful input and can backfill older projects safely.

## Scope and constraints

- The visual-prompt AI response gains an optional `sfxPrompt` string with a maximum length of 120 characters and a default of `''`.
- A non-empty SFX suggestion describes a short ambient or foley sound fitting the scene's action or setting, in the narration language. An empty string is valid when no distinct sound effect fits.
- Existing visual prompts and existing SFX prompts are never overwritten. Each field is guarded independently against its current database value being non-empty at write time.
- A chapter is skipped only when every scene has both a non-empty `visualPrompt` and a non-empty `sfxPrompt`. A chapter with visual prompts already filled but missing SFX prompts is sent to the AI again for backfill.
- Existing per-scene and bulk Freesound generation remains unchanged; this task only supplies `scene.sfxPrompt`.
- `VisualPromptJobResult` keeps its existing shape and visual-prompt-focused `updatedScenes`/`skippedScenes` semantics. Per-chapter and final log messages include the number of SFX prompts filled.
- If the AI returns empty SFX suggestions for every scene, the chapter remains eligible on future runs because there is no separate marker for “considered and intentionally empty.” This repeated consideration is accepted for this task; no new schema field is added.

## AI contract and prompt construction

`VisualPromptBatchSchema.prompts[]` accepts `sceneIndex`, required non-empty `visualPrompt`, and optional/defaulted `sfxPrompt`. Parsing an older response without `sfxPrompt` produces `sfxPrompt: ''` so the contract remains provider-tolerant.

`VisualPromptSceneInput` includes the current `sfxPrompt`. The visual-prompt user message includes `Existing SFX prompt: ${scene.sfxPrompt || '(none)'}` beside the existing visual-prompt reference. The system contract requires all three response fields and explains the short ambient/foley-or-empty behavior.

## Orchestration and persistence

`chapterScenes()` forwards each scene's current SFX prompt. The orchestration loop computes whether every scene has both fields populated before deciding to skip. For an eligible chapter, the AI batch is mapped to updates containing both `visualPrompt` and `sfxPrompt`; empty SFX suggestions are passed through as no-op values and are never written.

`applyEmptySceneVisualPromptsWithResult` is extended rather than duplicated. It deduplicates updates per scene while preserving the last value for each supplied field, validates all scene IDs before writing, and performs one atomic `findOneAndUpdate` with separate array-filter identifiers for visual and SFX fields:

- `visualPrompt` is set only through an array filter requiring that scene's current `visualPrompt` to be `''`.
- `sfxPrompt` is set only through a separate array filter requiring that scene's current `sfxPrompt` to be `''`, and only for non-empty suggestions.
- The top-level predicate requires at least one eligible empty field among the target scenes, preventing a version bump when concurrent edits fill every target.

The result preserves `updatedSceneIds` for visual prompts and adds an internal `updatedSfxPromptSceneIds` list for orchestration logging and tests. A single successful atomic update increments the project version once even when it fills both fields on multiple scenes. The pre-image is used to report exactly which visual and SFX fields were still empty at write time, preserving the existing concurrency accounting pattern.

## Failure and compatibility behavior

Existing parse/index retry, cancellation gates, chapter failure isolation, style-note continuity, and visual-prompt write behavior remain unchanged. A malformed or invalid response still retries once through the existing `SCRIPT_PARSE_ERROR` path. A response without `sfxPrompt` is valid and simply contributes no SFX writes.

## Tests

- Prompt-boundary coverage checks the SFX contract text, the existing-SFX line, and `(none)` fallback.
- Parser coverage checks non-empty SFX parsing, defaulting an omitted field to `''`, and the 120-character limit.
- Visual-prompt orchestration coverage checks SFX fills, preserves pre-existing SFX prompts, reprocesses visual-only chapters, and skips chapters where both fields are populated.
- Project-service coverage checks independent SFX empty-field writes, duplicate last-value handling, and a concurrent SFX edit that must not be overwritten while another empty SFX target still updates.
- Existing visual-prompt tests continue to cover index validation, cancellation, retry, failure isolation, and visual-field concurrency behavior.
