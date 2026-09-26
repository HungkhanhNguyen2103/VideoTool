# Task 15 — Selectable visual style presets for visual prompt generation

## Context

Today, `generate-visual-prompts` (`src/server/modules/script/visual-prompts.ts`) has no user-chosen visual style at all. It computes a `styleNote` on the fly: seeded once from an `excerpt()` of any pre-existing scene visual prompts, then overwritten every chapter by whatever `styleNote` string the AI itself decided to return in that chapter's response, carried forward as "Previous style note" to the next chapter. There is no enum, no preset file, and no request parameter for style anywhere in the codebase (`POST /:id/scenes/generate-visual-prompts` only accepts `{ projectId }`).

This task adds a fixed, code-defined list of visual style presets (mirroring the existing `scriptPresetId` pattern exactly — see `src/server/modules/script/ai/presets/`), selectable once at project creation (same UX tier as `scriptPresetId`/`aiProvider`), and makes that preset's style directive get **repeated verbatim in every chapter's visual-prompt request** — not just seeded once and left to drift like the current `styleNote` behavior.

## Scope — file by file

1. **`src/contracts/project.ts`**
   Add near `SCRIPT_PRESET_IDS`:
   ```ts
   export const VISUAL_STYLE_IDS = ['cinematic', 'anime', 'watercolor', 'photorealistic'] as const;
   export type VisualStyleId = (typeof VISUAL_STYLE_IDS)[number];
   ```
   Add `visualStylePresetId: z.enum(VISUAL_STYLE_IDS).default('cinematic')` to `CreateProjectRequestBase` (right next to `scriptPresetId`) and to `ProjectDetailSchema` (right next to `scriptPresetId` there too).

2. **`src/server/modules/project/docs.ts`**
   Add the same `visualStylePresetId: z.enum(VISUAL_STYLE_IDS).default('cinematic')` field to `ProjectDocSchema`, next to its existing `scriptPresetId` field, so it's persisted. Check `src/server/modules/project/service.ts`'s `createProject` to confirm the new field flows through automatically (it likely does if it just spreads the parsed input into the doc) — if it needs an explicit mapping anywhere, add it there too.

3. **New directory `src/server/modules/script/ai/presets/visual-styles/`** with 4 markdown files: `cinematic.md`, `anime.md`, `watercolor.md`, `photorealistic.md`. Each follows the exact frontmatter format used by `src/server/modules/script/ai/presets/documentary.md` (`---\nid: <id>\nversion: 1\n---`) but with a single `## Style` section (not `## System`/`## Instructions`) containing a concise (2-4 sentence) visual style directive appropriate to the name — e.g. `cinematic.md`'s `## Style` might read something like: "Render every scene as a still from a modern cinematic documentary: naturalistic but dramatic lighting, shallow depth of field, muted/desaturated color grading, wide and medium shots favored over extreme close-ups, photographic realism in texture and detail." Write similarly appropriate, concrete, specific 2-4 sentence directives for `anime`, `watercolor`, and `photorealistic` — anime should specify a clean modern anime/cel-shaded illustration look; watercolor should specify soft painterly watercolor-on-paper texture with visible brush strokes and bleeding edges; photorealistic should specify photographic realism with realistic lighting/materials and no stylization, as if shot on a real camera.

4. **New file `src/server/modules/script/ai/presets/visual-style-loader.ts`**
   Add `export type VisualStylePreset = { id: VisualStyleId; version: number; style: string };` and `export function loadVisualStylePreset(id: VisualStyleId, presetDirectory?: string): VisualStylePreset` — copy the structure of `loadScriptPreset` in `loader.ts` closely (frontmatter parsing, version validation, `resolvePresetDirectory`-style directory resolution pointing at the new `visual-styles/` subdirectory instead), but extract a single `## Style` section instead of `## System`/`## Instructions`. Reuse `resolvePresetDirectory`'s dist/source directory-detection logic (adapt the path to point at `presets/visual-styles` rather than `presets`).

5. **`src/server/modules/script/ai/build-prompt.ts`**
   - Add `visualStylePresetId: VisualStyleId` to `VisualPromptPromptInput`.
   - In `buildVisualPromptPrompt`, load the preset via `loadVisualStylePreset(input.visualStylePresetId)` and add a new line to the user message, placed prominently near the top (right after `Language:`), e.g. `` `Required visual style (must follow for every scene): ${preset.style}` ``. Keep the existing `Previous style note: ${styleNote...}` line as-is — it now serves as a supplementary continuity note (recurring motifs/character appearance/setting continuity) layered ON TOP of the enforced style preset, not as the sole style driver. Do not remove or rename that existing line; just add the new required-style line alongside it.

6. **`src/server/modules/script/visual-prompts.ts`**
   - Update `generateVisualPrompts` to pass `visualStylePresetId: project.visualStylePresetId` into `buildVisualPromptPrompt`'s input (destructure it off `project`).
   - No other logic changes needed here — the AI-authored `styleNote` continuity mechanism stays exactly as-is, just now supplementary to the enforced preset.

7. **Client — `src/client/features/project/components/NewProjectForm.tsx`**
   - Add `visualStylePresetId: 'cinematic'` to the form's default values object (next to the existing `scriptPresetId: 'documentary'` default).
   - Add a new `<select>` field in the same `fieldset`/`grid` block as the existing "Preset kịch bản" and "Nhà cung cấp AI" selects (`id="visual-style"`, `{...register('visualStylePresetId')}`), with a label "Phong cách hình ảnh" and options: Cinematic (điện ảnh), Anime, Watercolor (màu nước), Photorealistic (ảnh thực). Match the exact `<select className={styles.input} ...>` markup style already used for the two neighboring selects.

8. **Client — wherever `CreateProjectRequestSchema`/form validation types are imported client-side** (check `src/client/features/project/components/NewProjectForm.tsx`'s imports and any shared form-schema file it uses) — make sure the new field is accepted by whatever client-side zod schema mirrors `CreateProjectRequestSchema`, if one exists separately from the shared contract import. If the client already imports the schema directly from `src/contracts/project.ts` (likely, given this is a shared-types monorepo-style layout), no extra client schema change is needed — verify this rather than assuming.

## Non-goals — do not touch

- Do not add a way to change `visualStylePresetId` after project creation (no PATCH route) — `scriptPresetId` has no such route either, so this stays consistent with that existing pattern.
- Do not remove or restructure the existing AI-authored `styleNote` field/mechanism — it stays, now working alongside the enforced preset rather than being the only style driver.
- Do not touch `qa.ts`, chapter generation prompts, or anything under `src/server/modules/script/ai/presets/*.md` (the existing script-tone presets) — this is a separate, independent preset family living in its own `visual-styles/` subdirectory with its own loader.
- Do not add more than the 4 specified presets in this task.

## Tests

- New `visual-style-loader.test.ts` mirroring `loader.test.ts`'s existing test structure/coverage (valid load, unknown id, malformed frontmatter, mismatched declared id, missing `## Style` section) for all 4 real preset files plus the error paths.
- Update `build-prompt.test.ts` (or wherever `buildVisualPromptPrompt` is currently tested, check `script.test.ts`/`visual-prompts.test.ts`) to assert the required-style line appears in the built prompt for a given `visualStylePresetId`, and that the existing `Previous style note` line is still present alongside it.
- Update `visual-prompts.test.ts` to assert `generateVisualPrompts` passes the project's `visualStylePresetId` through correctly (e.g. via a spy/mock on `buildVisualPromptPrompt` or by asserting on the prompt text sent to the fake AI client).
- Add/update a `project.test.ts` or contract-level test asserting `visualStylePresetId` defaults to `'cinematic'` when omitted from `CreateProjectRequestSchema` input, and rejects an unknown value.

## Process rules (same as every prior task in this repo)

Never run `git add -A` / `git add .` / `git commit -a` — stage only the exact files you changed, after checking `git diff --stat` first. Check for and remove a stale zero-byte `.git/index.lock` if no git process is actually running. Run `npm run typecheck`, `npm run lint`, and the relevant `vitest` files before reporting done. Keep the diff strictly to what's described above — no drive-by refactors, and do not touch the ~60 unrelated files this repo currently shows as line-ending-only diffs in `git status` (leave them alone entirely).

**STOP after this report.**
