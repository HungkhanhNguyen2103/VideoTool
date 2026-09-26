# Task 14 — AI-assisted semantic scene splitting (verbatim-preserving)

## Context

Today, scene creation is purely mechanical: `finalizeScript` in `src/server/modules/script/service.ts` maps **1 paragraph = 1 scene**, with `scene.narration` set to the entire paragraph text verbatim. This means a scene can be arbitrarily long if the chapter's paragraph is long, and there's no concept of "one scene = one visual idea." `scene.narration` is fed directly to TTS in `generateSceneVoiceover` (`src/server/modules/video/tts-service.ts`), so any text that ends up in `narration` gets spoken aloud exactly as written.

This task adds an **opt-in, AI-assisted re-splitting step** that runs after `finalizeScript` (project status `assets`, scenes already exist) and further splits each chapter's existing scenes into finer-grained scenes — one per distinct visual idea — while guaranteeing the narration text is never reworded, added to, or removed: only split at existing whitespace boundaries in the original text.

## Hard constraint — read this twice

The AI's job is ONLY to choose where to cut. It must never paraphrase, correct, translate, or otherwise alter the wording. You must validate this in code (never trust the AI's claim): for every scene the AI returns split chunks for, join the chunks with a single space, collapse all whitespace runs to single spaces in both the joined result and the original narration, trim both, and assert they are equal. If they are not equal, treat it exactly like the existing "invalid batch" retry path in `visual-prompts.ts` (retry once with the validation error appended to the prompt; if still invalid, mark that chapter failed and move on — do not throw and abort the whole job).

## Scope — file by file

1. **`src/server/modules/script/ai/output-schema.ts`**
   Add:
   ```ts
   export const SceneSplitBatchSchema = z.object({
     scenes: z.array(z.object({
       sceneIndex: z.number().int().positive(),
       chunks: z.array(z.string().min(1)).min(1),
     })),
   });
   ```

2. **`src/server/modules/script/ai/parse-output.ts`**
   Add `parseSceneSplitBatch(raw: string)` mirroring the existing `parseVisualPromptBatch` (just calls `validate(raw, SceneSplitBatchSchema)`).

3. **`src/server/modules/script/ai/build-prompt.ts`**
   Add `buildSceneSplitPrompt(input: { project: ProjectDetail; chapter: ChapterDoc; scenes: readonly { sceneId: string; sceneIndex: number; narration: string }[] }): BuiltPrompt`, following the same shape/style as `buildVisualPromptPrompt`. System message must instruct, explicitly: "You are only choosing where to cut existing text into visual beats. Do NOT reword, correct, translate, summarize, add, or remove any word. Every chunk must be an exact contiguous substring of the supplied narration. For each scene, split it into 1 or more chunks (1 chunk means no split is needed) such that each chunk represents one distinct visual idea/beat, and joining all chunks for that scene with a single space reproduces the original narration exactly (aside from whitespace). Return exactly one entry per supplied sceneIndex, echoing sceneIndex exactly — do not invent, omit, duplicate, or renumber." Include each scene's `sceneIndex` and full `narration` in the user message, same style as `buildVisualPromptPrompt`.

4. **New file `src/server/modules/script/scene-split.ts`** (mirror the structure of `visual-prompts.ts` closely):
   - Export type `SceneSplitJobContext` identical in shape to `VisualPromptJobContext` (`reportProgress`, `isCancelled`, `appendLog`).
   - Export type `SceneSplitJobResult = { splitScenes: number; skippedChapters: number; failedChapters: number[] }`.
   - Export `async function splitProjectScenes(projectId: string, context: SceneSplitJobContext): Promise<SceneSplitJobResult>`.
   - Logic per chapter (iterate `project.chapters`, using the same `nextScene` offset technique as `chapterScenes()` in `visual-prompts.ts` to slice `project.scenes` per chapter by `chapter.scenesCount`):
     - If any scene in that chapter has a non-null `assetFileId`, non-null `audioFileId`, non-null `sfxFileId`, or non-empty `visualPrompt`, **skip** that chapter entirely (log via `appendLog`: `Chapter ${chapter.no}: scenes already have downstream data; skipped.`) and count it in `skippedChapters`. Do not call the AI for that chapter.
     - Otherwise, call the AI (reuse `getAiClient(project.aiProvider)`) with `buildSceneSplitPrompt`, parse with `parseSceneSplitBatch`, validate: (a) the returned `sceneIndex` set matches expected exactly (same style as `validateIndexes` in `visual-prompts.ts` — reuse that exact validation logic or an equivalent local copy), and (b) the verbatim-reconstruction check described above for every scene. On validation failure, retry once with the error appended to the prompt (same 2-attempt loop as `visual-prompts.ts`); if still invalid, log the failure, add the chapter number to `failedChapters`, and continue to the next chapter — do not touch that chapter's scenes.
     - On success, build the new scene list for that chapter: for each original scene, if its returned `chunks.length === 1`, keep the original scene object completely unchanged (same `id`, same everything) — this is a no-op, not a replacement. If `chunks.length > 1`, replace that one scene with N new scene docs, one per chunk, each `{ id: newId(), narration: chunk.trim(), visualPrompt: '', durationSec: estimateNarrationDurationSec(chunk), assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', sfxFileId: null }` — copy the exact scene doc shape `finalizeScript` already uses in `service.ts`.
     - Track `splitScenes` as the count of scenes that were actually split (chunks.length > 1 cases, counting the resulting new scenes minus 1 each, or however you want to define "how many splits happened" — pick a sensible definition and document it in a code comment).
     - Update that chapter's `scenesCount` (new total scene count for the chapter) and `durationSec` (sum of new scene durations).
     - Call `context.reportProgress(Math.round(((chapterIndex + 1) / project.chapters.length) * 100), result)` after each chapter, same as `visual-prompts.ts`.
   - After the loop, if any chapter was actually changed, call `replaceProjectChapters(projectId, updatedChapters, snapshot)` and `replaceProjectScenes(projectId, allScenesFlattened)` once, using the full recomputed `chapters` and `scenes` arrays (chapters/scenes that were skipped keep their original values unchanged in these arrays). If NO chapter changed at all (everything skipped or failed), don't call either replace function.
   - You'll need a chapter snapshot for `replaceProjectChapters`'s history param — `service.ts` has a local unexported `snapshotOf` helper. Export it from `service.ts` (add `export` to its declaration) and import it here, rather than duplicating its logic.
   - Import `replaceProjectChapters`, `replaceProjectScenes`, `getProject` from `../project`; import `estimateNarrationDurationSec`, `newId` the same way `service.ts` does.
   - Append a final summary log line mirroring the style of `visual-prompts.ts`'s last `appendLog` call.

5. **`src/server/modules/script/routes.ts`**
   - Add `router.post('/:id/scenes/split', ...)` right after the existing `/:id/scenes/generate-visual-prompts` route, reusing the exact same `assertVisualPromptSourceReady(project)` guard (it's already the right readiness check: scenes exist and chapter counts line up) before enqueueing `{ type: 'split-scenes', projectId: project.id, payload: { projectId: project.id } }`.

6. **`src/worker/registry.ts`**
   - Add `handleSplitScenes` following the exact same pattern as `handleGenerateVisualPrompts` (cancellation check, call `splitProjectScenes(projectIdFrom(job), context)`), register it under `'split-scenes'` in `jobHandlers`.

7. **Client — `src/client/features/asset/api.ts`**: add `splitScenes(projectId: string): Promise<{ jobId: string }>` calling `POST /api/project/:id/scenes/split`, mirroring `generateVisualPrompts`.

8. **Client — `src/client/features/asset/StudioPage.tsx`**: add a new button "Tách nhỏ scene" next to the existing "Tạo visual prompt" button (same `<div className={styles.actions}>` row), calling a new `splitScenes()` handler mirroring `generateVisualPrompts()` exactly (same busy-state/job-tracking pattern), disabled under the same conditions (`busy !== null || scenes.length === 0 || api.isProjectJobActive(jobId, progress)`).

## Non-goals — do not touch

- Do not change `finalizeScript`'s existing 1-paragraph-1-scene behavior — it stays exactly as-is as the first step; this task only adds an optional second pass.
- Do not change `visual-prompts.ts`, `qa.ts`, or any other job type.
- Do not add a way to "undo" a split, or to split an already-split scene further — running the job twice on the same project should just skip everything the second time (since scenes will already have their downstream fields checked — actually note: freshly-split scenes still have empty `visualPrompt`/`assetFileId` etc, so running split-scenes twice in a row WOULD re-split already-split scenes again. This is acceptable for this task — do not add extra guards against it beyond what's specified above).
- Do not change scene ID stability for the `chunks.length === 1` case — that's the one case where the scene object must be byte-for-byte unchanged (same id).

## Tests

- `output-schema`/`parse-output`: a focused test (wherever similar schema tests already live, likely alongside `visual-prompts.test.ts` or a new `scene-split.test.ts`) for `SceneSplitBatchSchema`/`parseSceneSplitBatch`.
- `scene-split.test.ts` (new file, mirror `visual-prompts.test.ts` structure and its fake AI client helpers): cover (a) a chapter where all scenes split cleanly into multiple chunks, verifying reconstruction and new scene docs; (b) a chapter where the AI returns a mismatched reconstruction, verifying the retry-then-fail-chapter path; (c) a chapter skipped because a scene already has `assetFileId` set; (d) the `chunks.length === 1` no-op case preserving the original scene `id`.
- Update `worker.test.ts` and `worker/registry.ts`'s existing test coverage pattern for the new `'split-scenes'` handler (mirror how `generate-visual-prompts` is tested there).
- A route-level test in `script.test.ts` for `POST /:id/scenes/split` covering the readiness guard (422 when scenes aren't finalized) and successful enqueue.

## Process rules (same as every prior task in this repo)

Never run `git add -A` / `git add .` / `git commit -a` — stage only the exact files you changed, after checking `git diff --stat` first. Check for and remove a stale zero-byte `.git/index.lock` if no git process is actually running. Run `npm run typecheck`, `npm run lint`, and the relevant `vitest` files before reporting done. Keep the diff strictly to what's described above — no drive-by refactors, and do not touch the ~60 unrelated files this repo currently shows as line-ending-only diffs in `git status` (leave them alone entirely).

**STOP after this report.**
