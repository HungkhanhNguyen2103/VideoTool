# Task 22 — Have visual prompt generation also suggest an SFX prompt per scene

## Context

The user pointed out that "Tạo tất cả SFX" is currently useless for most existing projects: `scene.sfxPrompt` is a manually-typed field (edited per scene in the Task 17 detail dialog) and is empty for essentially every scene unless the user typed something in by hand. Bulk SFX generation (`generateProjectSfx` → `generateSceneSfx`) already correctly skips any scene with an empty `sfxPrompt` (see `src/server/modules/video/service.ts`), so with nothing populated, the bulk action does nothing.

The ask: when `generate-visual-prompts` runs, have the AI also suggest a short SFX prompt per scene (ambient/foley sound fitting the scene), alongside the visual prompt it already generates — so `sfxPrompt` gets populated automatically as part of the existing visual-prompt generation flow, and the bulk SFX button then has something to act on. This should also **retroactively backfill** already-generated projects (like the user's current one, where every scene already has a `visualPrompt` but no `sfxPrompt`) when "Tạo visual prompt" is run again — not just apply to brand-new projects.

This task touches an AI JSON contract, prompt construction, and a DB-write function with an existing optimistic-concurrency safety guard, so please read all of the following files fully before writing a plan: `src/server/modules/script/ai/output-schema.ts`, `parse-output.ts`, `build-prompt.ts`'s `buildVisualPromptPrompt` and `VisualPromptPromptInput`/`VisualPromptSceneInput`, `src/server/modules/script/visual-prompts.ts` in full, and `src/server/modules/project/service.ts`'s `applyEmptySceneVisualPromptsWithResult` in full (the atomic `arrayFilters`-guarded update — note it matches on the scene's *current* value being `''` at write time, specifically to avoid clobbering a concurrent edit; any new sfxPrompt-writing logic needs the same kind of protection, independently per field, since a scene could have one field already filled and the other still empty).

## Required behavior

1. **AI contract** (`output-schema.ts`): add an optional `sfxPrompt` string (e.g. `z.string().trim().max(120).default('')`) to each item in `VisualPromptBatchSchema`'s `prompts` array, alongside the existing `sceneIndex`/`visualPrompt`. Unlike `visualPrompt` (always required, `min(1)`), `sfxPrompt` may legitimately be an empty string — not every scene needs a distinct sound effect (e.g. a pure dialogue/narration beat with no foley moment).

2. **Prompt construction** (`build-prompt.ts`): 
   - Add `sfxPrompt: string` to `VisualPromptSceneInput` (the existing scene shown to the AI, alongside `narration`/`visualPrompt`) so the AI can see what's already there, mirroring how `Existing visual prompt: ${scene.visualPrompt || '(none)'}` already works — add an equivalent `Existing SFX prompt: ${scene.sfxPrompt || '(none)'}` line per scene.
   - Update the system message contract text to require `{sceneIndex, visualPrompt, sfxPrompt}` per item, and explain `sfxPrompt`: a short (a few words) ambient/foley sound description fitting the scene's action or setting, in the same language as the narration, or an empty string when no distinct sound effect fits.

3. **`visual-prompts.ts`**:
   - `chapterScenes()` must include `sfxPrompt: scene.sfxPrompt` in the mapped scene input.
   - Change the per-chapter skip condition: today it skips a whole chapter when every scene already has a non-empty `visualPrompt` (`prefilled === scenes.length`). Change this so a chapter is only skipped when every scene already has **both** a non-empty `visualPrompt` and a non-empty `sfxPrompt`. This is what makes the retroactive backfill work: on an already-visual-prompted project, chapters will now be considered "needs generation" again (because `sfxPrompt` is still empty), the AI gets called, its `visualPrompt` suggestions are safely no-ops (already filled, atomic guard prevents overwrite), and its `sfxPrompt` suggestions get applied. Accept the tradeoff that a chapter where the AI correctly decides "no scene needs SFX" (all `sfxPrompt` returned as `''`) will keep being reconsidered on every future run, since there's no separate "considered but intentionally empty" marker — call this out explicitly in your report rather than silently deciding it's fine, but don't add a new schema field to solve it unless you think it's clearly warranted.
   - When applying the AI's batch, extend the update path to also carry `sfxPrompt` per scene, and only apply it where the scene's current `sfxPrompt` is `''` **and** the AI actually returned a non-empty suggestion (don't write an empty string over anything, and don't touch a scene whose `sfxPrompt` is already populated). This needs the same atomic guard style as the existing `visualPrompt` path — read `applyEmptySceneVisualPromptsWithResult` closely and extend it (or add a sibling function/second atomic pass) so both fields' "only if currently empty" guarantees hold independently and safely under concurrent edits. Prefer whichever of these is less error-prone to reason about and test: a single function handling both fields with per-scene/per-field conditional `$set`, or two independent atomic passes (one for `visualPrompt`, unchanged, one new one for `sfxPrompt`) — your call, but explain which you picked and why in your report.
   - Update `VisualPromptJobResult`/logging as needed to reflect that SFX prompts may also have been filled (doesn't need to be a big change — use your judgment on whether to add a count or just leave the existing `updatedScenes` semantics as visual-prompt-focused and mention sfx fills only in the log line).

## Non-goals

- Do not change `generateSceneSfx`/`generateProjectSfx` (the actual Freesound audio-generation logic) — they already correctly consume `sfxPrompt` and correctly skip when it's empty.
- Do not add a UI control for this — it's purely a change to what the existing `generate-visual-prompts` job does server-side. The existing SFX prompt input field in the Task 17 detail dialog will just show whatever value got filled in, same as it shows manually-typed values today.
- Do not change the `split-scenes` job or its prompt.

## Tests

Update/extend the existing coverage for `buildVisualPromptPrompt` (prompt-boundary tests), `parseVisualPromptBatch`/schema tests, and `visual-prompts.test.ts` to cover: sfxPrompt appearing in the built prompt with `(none)` fallback; a batch response with sfxPrompt values getting applied only to scenes with an empty `sfxPrompt`; a scene with an already-filled `sfxPrompt` not being overwritten even if the AI returns a different suggestion for it; the revised skip condition (chapter re-processed when visualPrompt is filled but sfxPrompt isn't, chapter still skipped when both are filled everywhere); and, if you touch `applyEmptySceneVisualPromptsWithResult` or add a sibling function, dedicated unit coverage for its concurrency guard on the new field (mirroring whatever test already exists for the `visualPrompt` guard, likely in `project.test.ts` or similar — find it first).

## Process

Given the AI-contract change, the DB-write concurrency subtlety, and the skip-condition behavior change (which affects existing, already-working functionality), please write a short spec first (as you did for Tasks 14/15) rather than jumping straight to a design summary — I'd like to review the exact skip-condition wording and the atomic-update approach before you write an implementation plan. Same process as before: spec → my review → plan → my review → implement task-by-task with commits, checking in after each.

**STOP after this report.**
