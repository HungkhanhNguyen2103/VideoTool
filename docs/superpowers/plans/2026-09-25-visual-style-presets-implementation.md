# Selectable Visual Style Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-level visual style selection and pass persistent narrative context into every visual-prompt generation request.

**Architecture:** Store a defaulted `visualStylePresetId` on projects, load one versioned markdown directive per style, and compose that directive plus script continuity metadata into the existing visual prompt builder. Keep AI-authored style notes as supplementary per-run continuity and preserve the existing visual-prompt orchestration, retry, cancellation, and write paths.

**Tech Stack:** TypeScript, Zod 4, Express/MongoDB project contracts, React/react-hook-form, Vitest, Node filesystem APIs, Vite/tsup packaging.

**Spec:** `docs/superpowers/specs/2026-09-25-visual-style-presets-design.md`

## Global Constraints

- Supported visual styles are exactly `cinematic`, `anime`, `watercolor`, and `photorealistic`.
- New projects default to `cinematic`; legacy project reads also default to `cinematic` through `ProjectDocSchema`.
- There is no post-creation style mutation route.
- The selected style directive is loaded from a versioned markdown preset and repeated verbatim in every visual-prompt request.
- The existing AI-authored `Previous style note` remains in the prompt as supplementary continuity context.
- Visual-prompt generation reads `coreQuestion`, `openingHook`, and the previous chapter's summary, avoidance list, and persistent facts; it does not read or write `openLoops`.
- Existing script presets and generation prompts remain unchanged.
- Production copying must preserve flat `presets/*.md` files and recursively copy only `.md` files under `presets/visual-styles/`.
- Stage exact files only; never use `git add -A`, `git add .`, or `git commit -a`.

## Review Focus

- A legacy MongoDB project without `visualStylePresetId` parses as `cinematic` while `scriptPresetId` keeps its existing behavior. (Task 1)
- An unknown, mismatched, malformed, missing, or empty visual-style preset fails with `SCRIPT_PRESET_INVALID` before an AI call. (Task 2)
- Production packaging includes all four nested style files and still copies the three existing root-level script presets. (Task 2)
- The visual prompt repeats the required style and keeps the rolling `Previous style note`, with all null/empty narrative fields rendered as `(none)`. (Task 3)
- Later chapters receive only the immediately previous chapter's continuity metadata, while chapter one receives null/empty values. (Task 4)
- The project form compiles against the shared schema and exposes exactly the four allowed labels. (Task 5; verified by typecheck/build plus contract default/rejection coverage in Task 1)

---

## File Structure

- `src/contracts/project.ts`: visual-style IDs and defaulted request/detail contract field.
- `src/server/modules/project/docs.ts`, `service.ts`: persisted legacy-safe field and explicit create/detail mapping.
- `src/server/modules/script/ai/presets/visual-styles/*.md`: four authored style directives.
- `src/server/modules/script/ai/presets/visual-style-loader.ts`: validation and source/dist style directory resolution.
- `scripts/copy-script-presets.mjs`: flat root copy plus recursive `.md` copy for visual styles.
- `src/server/modules/script/ai/build-prompt.ts`: visual prompt input, style loading, context lines, and version.
- `src/server/modules/script/visual-prompts.ts`: previous-chapter context forwarding.
- `src/client/features/project/components/NewProjectForm.tsx`: creation-time style select.
- Tests: `src/server/modules/script/ai/presets/visual-style-loader.test.ts`, `src/server/modules/script/ai/prompt-boundary.test.ts`, `src/server/modules/script/visual-prompts.test.ts`, `src/server/modules/project/project.test.ts` or a focused contract test, and the relevant client form test if available.

### Task 1: Add the project visual-style contract and persistence

**Files:**
- Modify: `src/contracts/project.ts`
- Modify: `src/server/modules/project/docs.ts`
- Modify: `src/server/modules/project/service.ts`
- Test: `src/contracts/project.test.ts`

**Interfaces:** Produces `VISUAL_STYLE_IDS`, `VisualStyleId`, and `visualStylePresetId` on `CreateProjectRequest`, `ProjectDetail`, and `ProjectDoc`; legacy document parsing returns `cinematic`.

- [ ] **Step 1: Write failing contract and service tests**

Create `src/contracts/project.test.ts` with a complete `validCreateInput` fixture and a complete `validLegacyDoc` fixture. Assert `CreateProjectRequestSchema.parse(validCreateInput).visualStylePresetId` is `cinematic`, assert parsing `{ ...validCreateInput, visualStylePresetId: 'oil' }` throws, and assert `ProjectDocSchema.parse(validLegacyDoc).visualStylePresetId` is `cinematic`. The legacy fixture must omit only `visualStylePresetId` and retain the existing `scriptPresetId` field.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run src/contracts/project.test.ts src/server/modules/script/ai/prompt-boundary.test.ts`

Expected: FAIL because the field and enum are not defined.

- [ ] **Step 3: Implement the contract and explicit project mapping**

Add:

```ts
export const VISUAL_STYLE_IDS = ['cinematic', 'anime', 'watercolor', 'photorealistic'] as const;
export type VisualStyleId = (typeof VISUAL_STYLE_IDS)[number];
```

Add `visualStylePresetId: z.enum(VISUAL_STYLE_IDS).default('cinematic')` beside `scriptPresetId` in the create request and project detail schemas. Import the enum in `docs.ts` and add the same default to `ProjectDocSchema`. In `toDetail` and `createProject`, explicitly copy `doc.visualStylePresetId` and `input.visualStylePresetId` so the stored and returned values are visible even when callers rely on schema defaults.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx vitest run src/contracts/project.test.ts src/server/modules/script/ai/prompt-boundary.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/contracts/project.ts src/server/modules/project/docs.ts src/server/modules/project/service.ts src/contracts/project.test.ts
git commit -m "feat(project): add visual style preset field"
```

### Task 2: Add style preset files, loader, and production packaging

**Files:**
- Create: `src/server/modules/script/ai/presets/visual-styles/cinematic.md`
- Create: `src/server/modules/script/ai/presets/visual-styles/anime.md`
- Create: `src/server/modules/script/ai/presets/visual-styles/watercolor.md`
- Create: `src/server/modules/script/ai/presets/visual-styles/photorealistic.md`
- Create: `src/server/modules/script/ai/presets/visual-style-loader.ts`
- Modify: `scripts/copy-script-presets.mjs`
- Test: `src/server/modules/script/ai/presets/visual-style-loader.test.ts`
- Modify: `src/server/modules/script/ai/presets/loader.test.ts`

**Interfaces:** Produces `VisualStylePreset` and `loadVisualStylePreset(id, presetDirectory?)`; production output contains `dist/presets/visual-styles/*.md`.

- [ ] **Step 1: Write failing loader and packaging tests**

Cover all four real files, unknown requested ID, mismatched declared ID, malformed frontmatter, invalid version, missing/empty `## Style`, and production copying. Extend the existing packaging test to assert the root files remain exactly `documentary.md`, `explainer.md`, and `hubris-trap.md`, and assert `dist/presets/visual-styles` contains exactly the four style files after running the copy script twice.

```ts
expect(loadVisualStylePreset('cinematic').style).toContain('cinematic');
expect(() => loadVisualStylePreset('unknown' as never)).toThrow(expect.objectContaining({ code: 'SCRIPT_PRESET_INVALID' }));
expect(() => loadVisualStylePreset('cinematic', malformedDirectory)).toThrow(expect.objectContaining({ code: 'SCRIPT_PRESET_INVALID' }));
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run src/server/modules/script/ai/presets/loader.test.ts src/server/modules/script/ai/presets/visual-style-loader.test.ts`

Expected: FAIL because the directory, loader, and recursive copy behavior are absent.

- [ ] **Step 3: Add the four authored markdown directives**

Each file starts with `---`, its matching `id`, `version: 1`, and `---`, then one non-empty `## Style` section of 2–4 concrete sentences. Keep style text focused on image composition and rendering characteristics; do not add `## System` or `## Instructions` sections.

- [ ] **Step 4: Implement the loader**

Reuse the script loader's frontmatter/version/error behavior and `SCRIPT_PRESET_INVALID` code, but validate `VISUAL_STYLE_IDS` and extract only `## Style`. Resolve a supplied directory directly for tests. For the default source path, resolve the directory containing `visual-style-loader.ts`'s `visual-styles` folder; for a bundled `dist/server.js` module URL, resolve `dist/presets/visual-styles`.

- [ ] **Step 5: Implement recursive markdown-only copying**

Keep the current root-level loop for files directly under `src/server/modules/script/ai/presets`. Add a small recursive helper that reads directory entries with file type information, copies only entries whose names end in `.md`, descends into directories, creates matching destination directories, and ignores unrelated non-md files. Run it for `visual-styles` so the flat root output remains unchanged.

- [ ] **Step 6: Run tests and build packaging**

Run: `npx vitest run src/server/modules/script/ai/presets/loader.test.ts src/server/modules/script/ai/presets/visual-style-loader.test.ts && npm run build`

Expected: PASS, with all four files present under `dist/presets/visual-styles`.

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/script/ai/presets/visual-styles src/server/modules/script/ai/presets/visual-style-loader.ts src/server/modules/script/ai/presets/visual-style-loader.test.ts src/server/modules/script/ai/presets/loader.test.ts scripts/copy-script-presets.mjs
git commit -m "feat(script): add visual style presets"
```

### Task 3: Extend visual prompt construction with style and narrative context

**Files:**
- Modify: `src/server/modules/script/ai/build-prompt.ts`
- Test: `src/server/modules/script/ai/prompt-boundary.test.ts`

**Interfaces:** `VisualPromptPromptInput` consumes `visualStylePresetId`, `coreQuestion`, `openingHook`, `previousChapterSummary`, `previousAvoidRepeating`, and `previousPersistentFacts`; `buildVisualPromptPrompt` returns a style-aware prompt version.

- [ ] **Step 1: Write failing prompt-boundary tests**

Update the shared `ProjectDetailSchema.parse` fixture with `visualStylePresetId: 'cinematic'` and pass all new input fields. Assert:

```ts
const result = buildVisualPromptPrompt({
  project: { ...project, visualStylePresetId: 'anime' }, chapter,
  styleNote: 'Muted colors', scenes: [{ sceneId: 'internal-id', sceneIndex: 1, narration: 'First beat', visualPrompt: 'Existing image' }],
  coreQuestion: 'Why did the river change?', openingHook: 'At dawn, it reversed.',
  previousChapterSummary: 'The river moved after the flood.', previousAvoidRepeating: ['Do not repeat the flood reveal'],
  previousPersistentFacts: ['The bridge is damaged'],
});
expect(result.user).toContain('Required visual style (must follow for every scene):');
expect(result.user).toContain('Core question: Why did the river change?');
expect(result.user).toContain('Previous style note: Muted colors');
expect(result.user).toContain('Avoid repeating: Do not repeat the flood reveal');
expect(result.promptVersion).toMatch(/^visual-prompt-v1\/anime@/);
```

Add a second case with null/empty values and assert `(none)` for opening hook, previous summary, avoidance, and persistent facts.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run src/server/modules/script/ai/prompt-boundary.test.ts`

Expected: FAIL because the input type and required prompt lines are absent and the old exact prompt version remains.

- [ ] **Step 3: Implement the prompt changes**

Import `VisualStyleId` and `loadVisualStylePreset`. Extend `VisualPromptPromptInput`. Load the style preset, add the required style and core question immediately after `Language:`, add the four continuity lines immediately after the chapter heading, keep `Previous style note: ${styleNote.slice(0, 500)}` unchanged, and set `promptVersion` to `visual-prompt-v1/${preset.id}@${preset.version}`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/server/modules/script/ai/prompt-boundary.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/script/ai/build-prompt.ts src/server/modules/script/ai/prompt-boundary.test.ts
git commit -m "feat(script): add visual style and narrative prompt context"
```

### Task 4: Forward project and previous-chapter context during generation

**Files:**
- Modify: `src/server/modules/script/visual-prompts.ts`
- Test: `src/server/modules/script/visual-prompts.test.ts`

**Interfaces:** `generateVisualPrompts` supplies the complete `VisualPromptPromptInput` for every chapter without changing its retry, cancellation, style-note, or project mutation behavior.

- [ ] **Step 1: Write failing forwarding tests**

Use the existing fake AI client and project fixtures. Spy on `buildVisualPromptPrompt` if the module's current mocking convention permits it; otherwise inspect each captured chat user message. Assert the first chapter gets `project.visualStylePresetId`, root `coreQuestion`/`openingHook`, `previousChapterSummary: null`, `previousAvoidRepeating: []`, and `previousPersistentFacts: []`. Add a two-chapter case asserting chapter two receives chapter one's summary, avoidance list, and persistent facts, never its own metadata.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run src/server/modules/script/visual-prompts.test.ts`

Expected: FAIL because the builder call currently supplies only project, chapter, scenes, and style note.

- [ ] **Step 3: Implement previous-chapter forwarding**

Inside the existing `for (const [chapterIndex, chapter] of project.chapters.entries())` loop, define:

```ts
const previousChapter = chapterIndex > 0 ? project.chapters[chapterIndex - 1] : null;
```

Pass `visualStylePresetId: project.visualStylePresetId`, `coreQuestion: project.coreQuestion`, `openingHook: project.openingHook || null`, and the previous chapter fields with `?? null`/`?? []`. Leave all other orchestration logic unchanged.

- [ ] **Step 4: Run focused tests and checks**

Run: `npx vitest run src/server/modules/script/visual-prompts.test.ts src/server/modules/script/ai/prompt-boundary.test.ts && npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/script/visual-prompts.ts src/server/modules/script/visual-prompts.test.ts
git commit -m "feat(script): forward narrative context to visual prompts"
```

### Task 5: Add project creation style selection and run final verification

**Files:**
- Modify: `src/client/features/project/components/NewProjectForm.tsx`

**Interfaces:** The form submits `visualStylePresetId` through `CreateProjectRequestSchema` and displays exactly four options.

- [ ] **Step 1: Implement the form field**

Add `visualStylePresetId: 'cinematic'` to `defaultValues`. In the existing preset/provider grid, add:

```tsx
<label htmlFor="visual-style">Phong cách hình ảnh</label>
<select className={styles.input} id="visual-style" {...register('visualStylePresetId')}>
  <option value="cinematic">Cinematic (điện ảnh)</option>
  <option value="anime">Anime</option>
  <option value="watercolor">Watercolor (màu nước)</option>
  <option value="photorealistic">Photorealistic (ảnh thực)</option>
</select>
```

- [ ] **Step 2: Run the full relevant verification**

Run: `npx vitest run src/contracts/project.test.ts src/server/modules/script/ai/presets/loader.test.ts src/server/modules/script/ai/presets/visual-style-loader.test.ts src/server/modules/script/ai/prompt-boundary.test.ts src/server/modules/script/visual-prompts.test.ts src/server/modules/project/project.test.ts && npm run typecheck && npm run lint && npm run build`

Expected: all selected tests pass; the pre-existing `project` todo remains skipped if included; typecheck, lint, and build pass; `dist/presets/visual-styles` contains four markdown files.
  
- [ ] **Step 3: Inspect and commit exact files**

Run `git diff --stat` and confirm the diff contains only Task 15 files. Stage exact paths from Tasks 1–5 and commit:

```bash
git add src/contracts/project.ts src/contracts/project.test.ts src/server/modules/project/docs.ts src/server/modules/project/service.ts src/server/modules/script/ai/presets/visual-styles src/server/modules/script/ai/presets/visual-style-loader.ts src/server/modules/script/ai/presets/visual-style-loader.test.ts src/server/modules/script/ai/presets/loader.test.ts scripts/copy-script-presets.mjs src/server/modules/script/ai/build-prompt.ts src/server/modules/script/ai/prompt-boundary.test.ts src/server/modules/script/visual-prompts.ts src/server/modules/script/visual-prompts.test.ts src/client/features/project/components/NewProjectForm.tsx
git commit -m "feat(project): add selectable visual style presets"
```

## Plan Self-Review

- Spec coverage: contract/persistence, four presets, loader validation, recursive packaging, prompt style/context, previous-chapter forwarding, form selection, and all requested tests map to Tasks 1–5.
- Placeholder scan: no TBD/TODO or unspecified implementation step remains; each task names files, test commands, expected failures, interfaces, and commit paths.
- Type consistency: `VisualStyleId` flows from `VISUAL_STYLE_IDS` through project contracts, `VisualPromptPromptInput`, `loadVisualStylePreset`, `buildVisualPromptPrompt`, and `generateVisualPrompts`.
- Review focus: each listed legacy, loader, packaging, prompt, chapter-context, and form risk has an owning test or compile verification task.
