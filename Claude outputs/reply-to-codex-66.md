# Task 15 — Selectable visual style presets + missing narrative context in visual prompt generation

This task has two parts. Do both in the same task — they touch the same function (`buildVisualPromptPrompt`) and it's more coherent to land them together. Read this whole document before writing code.

## Part A — Selectable visual style presets

### Context

Today, `generate-visual-prompts` (`src/server/modules/script/visual-prompts.ts`) has no user-chosen visual style at all. It computes a `styleNote` on the fly: seeded once from an `excerpt()` of any pre-existing scene visual prompts, then overwritten every chapter by whatever `styleNote` string the AI itself decided to return in that chapter's response, carried forward as "Previous style note" to the next chapter. There is no enum, no preset file, and no request parameter for style anywhere in the codebase (`POST /:id/scenes/generate-visual-prompts` only accepts `{ projectId }`).

Add a fixed, code-defined list of visual style presets (mirroring the existing `scriptPresetId` pattern exactly — see `src/server/modules/script/ai/presets/`), selectable once at project creation (same UX tier as `scriptPresetId`/`aiProvider`), and make that preset's style directive get **repeated verbatim in every chapter's visual-prompt request** — not just seeded once and left to drift like the current `styleNote` behavior.

### Scope — file by file

1. **`src/contracts/project.ts`**
   Add near `SCRIPT_PRESET_IDS`:
   ```ts
   export const VISUAL_STYLE_IDS = ['cinematic', 'anime', 'watercolor', 'photorealistic'] as const;
   export type VisualStyleId = (typeof VISUAL_STYLE_IDS)[number];
   ```
   Add `visualStylePresetId: z.enum(VISUAL_STYLE_IDS).default('cinematic')` to `CreateProjectRequestBase` (right next to `scriptPresetId`) and to `ProjectDetailSchema` (right next to `scriptPresetId` there too).

2. **`src/server/modules/project/docs.ts`**
   Add the same `visualStylePresetId: z.enum(VISUAL_STYLE_IDS).default('cinematic')` field to `ProjectDocSchema`, next to its existing `scriptPresetId` field, so it's persisted. Check `src/server/modules/project/service.ts`'s `createProject` to confirm the new field flows through automatically (it likely does if it just spreads the parsed input into the doc) — if it needs an explicit mapping anywhere, add it there too.

3. **New directory `src/server/modules/script/ai/presets/visual-styles/`** with 4 markdown files: `cinematic.md`, `anime.md`, `watercolor.md`, `photorealistic.md`. Each follows the exact frontmatter format used by `src/server/modules/script/ai/presets/documentary.md` (`---\nid: <id>\nversion: 1\n---`) but with a single `## Style` section (not `## System`/`## Instructions`) containing a concise (2-4 sentence) visual style directive appropriate to the name — e.g. `cinematic.md`'s `## Style` might read something like: "Render every scene as a still from a modern cinematic documentary: naturalistic but dramatic lighting, shallow depth of field, muted/desaturated color grading, wide and medium shots favored over extreme close-ups, photographic realism in texture and detail." Write similarly appropriate, concrete, specific 2-4 sentence directives for `anime` (clean modern anime/cel-shaded illustration look), `watercolor` (soft painterly watercolor-on-paper texture with visible brush strokes and bleeding edges), and `photorealistic` (photographic realism with realistic lighting/materials and no stylization, as if shot on a real camera).

4. **New file `src/server/modules/script/ai/presets/visual-style-loader.ts`**
   Add `export type VisualStylePreset = { id: VisualStyleId; version: number; style: string };` and `export function loadVisualStylePreset(id: VisualStyleId, presetDirectory?: string): VisualStylePreset` — copy the structure of `loadScriptPreset` in `loader.ts` closely (frontmatter parsing, version validation, `resolvePresetDirectory`-style directory resolution pointing at the new `visual-styles/` subdirectory instead), but extract a single `## Style` section instead of `## System`/`## Instructions`. Reuse `resolvePresetDirectory`'s dist/source directory-detection logic (adapt the path to point at `presets/visual-styles` rather than `presets`).

5. **Client — `src/client/features/project/components/NewProjectForm.tsx`**
   - Add `visualStylePresetId: 'cinematic'` to the form's default values object (next to the existing `scriptPresetId: 'documentary'` default).
   - Add a new `<select>` field in the same `fieldset`/`grid` block as the existing "Preset kịch bản" and "Nhà cung cấp AI" selects (`id="visual-style"`, `{...register('visualStylePresetId')}`), with a label "Phong cách hình ảnh" and options: Cinematic (điện ảnh), Anime, Watercolor (màu nước), Photorealistic (ảnh thực). Match the exact `<select className={styles.input} ...>` markup style already used for the two neighboring selects.
   - Check wherever `CreateProjectRequestSchema`/form validation types are imported client-side. If the client already imports the schema directly from `src/contracts/project.ts` (likely, given this is a shared-types layout), no extra client schema change is needed — verify this rather than assuming.

### Non-goals for Part A

- Do not add a way to change `visualStylePresetId` after project creation (no PATCH route) — `scriptPresetId` has no such route either, so this stays consistent with that existing pattern.
- Do not add more than the 4 specified presets in this task.

## Part B — Thread existing narrative-continuity fields into visual prompt generation

### Context — why this matters

`buildChapterExpansionPrompt` (script generation) already receives rich cross-chapter context: `coreQuestion`, `openingHook`, `previousChapterSummary`, `previousAvoidRepeating`, `previousPersistentFacts`, `openLoops`. These fields already exist on `ProjectDetail` (`project.coreQuestion`, `project.openingHook`) and on each `ChapterDoc` (`chapter.chapterSummary`, `chapter.avoidRepeating`, `chapter.persistentFacts` — see `src/contracts/script.ts` lines 36-38 and `src/contracts/project.ts` lines 157-158).

`buildVisualPromptPrompt`, by contrast, receives none of this. It only gets `project.title`, `project.brief`, the current chapter's `no`/`title`, an AI-authored rolling `styleNote`, and the scenes' own narration text. This was thin even before Task 14; it gets thinner once scenes are split into smaller visual beats (Task 14), because each individual scene's narration shrinks and carries even less standalone context for the AI to infer setting/character/continuity from.

Fix this by threading the same already-existing continuity fields into the visual-prompt prompt, mirroring exactly how `service.ts` already looks up the previous chapter for `buildChapterExpansionPrompt` (see `src/server/modules/script/service.ts` lines ~134-136 and ~200-202: `previousChapter?.chapterSummary ?? null`, `previousChapter?.avoidRepeating ?? []`, `previousChapter?.persistentFacts ?? []`).

### Scope — file by file

1. **`src/server/modules/script/ai/build-prompt.ts`**
   - Extend `VisualPromptPromptInput` with:
     ```ts
     coreQuestion: string;
     openingHook: string | null;
     previousChapterSummary: string | null;
     previousAvoidRepeating: string[];
     previousPersistentFacts: string[];
     ```
     (Also add `visualStylePresetId: VisualStyleId` here for Part A, per the plan above — both changes land in the same type.)
   - In `buildVisualPromptPrompt`, load the visual style preset via `loadVisualStylePreset(input.visualStylePresetId)` and add lines to the user message. Follow this shape, placed right after `Language:` and before the existing `Chapter ${chapter.no}: ${chapter.title}` line:
     ```
     Required visual style (must follow for every scene): ${preset.style}
     Core question: ${coreQuestion}
     ```
     Then, right after the existing `Chapter ${chapter.no}: ${chapter.title}` line, add (matching the `(none)` fallback convention already used elsewhere in this file):
     ```
     Opening hook: ${openingHook || '(none)'}
     Previous chapter summary: ${previousChapterSummary ?? '(none)'}
     Avoid repeating: ${previousAvoidRepeating.join(' | ') || '(none)'}
     Persistent facts: ${previousPersistentFacts.join(' | ') || '(none)'}
     ```
   - Keep the existing `Previous style note: ${styleNote...}` line exactly as-is — it stays as a supplementary AI-authored visual continuity note (recurring motifs, character appearance, setting continuity across chapters within this generation run), now layered on top of both the enforced style preset AND the persistent script-level context, not as the sole style/context driver. Do not remove or rename it.

2. **`src/server/modules/script/visual-prompts.ts`**
   - In `generateVisualPrompts`'s per-chapter loop, compute the previous chapter the same way `service.ts` does: `const previousChapter = chapterIndex > 0 ? project.chapters[chapterIndex - 1] : null;` (adjust variable naming to fit the existing loop, which already destructures `[chapterIndex, chapter]` from `project.chapters.entries()`).
   - Pass the new fields into `buildVisualPromptPrompt`'s input: `coreQuestion: project.coreQuestion`, `openingHook: project.openingHook || null`, `previousChapterSummary: previousChapter?.chapterSummary ?? null`, `previousAvoidRepeating: previousChapter?.avoidRepeating ?? []`, `previousPersistentFacts: previousChapter?.persistentFacts ?? []`, plus `visualStylePresetId: project.visualStylePresetId` from Part A.
   - No other logic changes needed here — the existing AI-authored `styleNote` continuity mechanism stays exactly as-is.

### Non-goals for Part B

- Do not change what `chapterSummary`/`avoidRepeating`/`persistentFacts` mean or how script generation computes them — visual prompt generation only *reads* these existing fields, it never writes them.
- Do not add `openLoops` to the visual prompt context — those are plot-level open questions relevant to script pacing, not to per-scene visual composition; leave them out to keep the prompt from bloating with irrelevant material.
- Do not touch `qa.ts`, chapter generation prompts (`buildChapterExpansionPrompt`, `buildRegenerationPrompt`), or anything under `src/server/modules/script/ai/presets/*.md` (the existing script-tone presets).

## Tests

- New `visual-style-loader.test.ts` mirroring `loader.test.ts`'s existing test structure/coverage (valid load, unknown id, malformed frontmatter, mismatched declared id, missing `## Style` section) for all 4 real preset files plus the error paths.
- Update wherever `buildVisualPromptPrompt` is currently tested (check `build-prompt.test.ts`) to assert:
  - the required-style line appears in the built prompt for a given `visualStylePresetId`, and the existing `Previous style note` line is still present alongside it;
  - `coreQuestion`, `openingHook`, `previousChapterSummary`, `previousAvoidRepeating`, and `previousPersistentFacts` all appear in the built user message, including their `(none)` fallback rendering when null/empty.
- Update `visual-prompts.test.ts` to assert `generateVisualPrompts`:
  - passes the project's `visualStylePresetId` through correctly;
  - passes `project.coreQuestion`/`project.openingHook` through correctly;
  - for chapter index 0, passes `previousChapterSummary: null`, `previousAvoidRepeating: []`, `previousPersistentFacts: []`;
  - for a later chapter, passes the *previous* chapter's `chapterSummary`/`avoidRepeating`/`persistentFacts` (not the current chapter's).
  (Use a spy/mock on `buildVisualPromptPrompt`, or assert on the prompt text sent to the fake AI client — whichever this test file's existing convention already uses.)
- Add/update a `project.test.ts` or contract-level test asserting `visualStylePresetId` defaults to `'cinematic'` when omitted from `CreateProjectRequestSchema` input, and rejects an unknown value.

## Process rules (same as every prior task in this repo)

Never run `git add -A` / `git add .` / `git commit -a` — stage only the exact files you changed, after checking `git diff --stat` first. Check for and remove a stale zero-byte `.git/index.lock` if no git process is actually running. Run `npm run typecheck`, `npm run lint`, and the relevant `vitest` files before reporting done. Keep the diff strictly to what's described above — no drive-by refactors, and do not touch the ~60 unrelated files this repo currently shows as line-ending-only diffs in `git status` (leave them alone entirely).

If this is large enough that you'd normally split it into your own sub-tasks (e.g. via `superpowers:subagent-driven-development`), that's fine — write your own spec/plan first as you did for Task 14, and check in with me before writing code, same as last time.

**STOP after this report.**
