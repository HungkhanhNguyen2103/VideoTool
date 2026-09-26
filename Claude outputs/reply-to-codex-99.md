# Task 27 — Expose visual style preset on the Studio page (view + change after creation)

## Context

Task 15 added `visualStylePresetId` (`cinematic`/`anime`/`watercolor`/`photorealistic`) but only as a one-time choice on project creation (`NewProjectForm.tsx`) — there's no way to see or change it afterward anywhere in the app. The user just asked why they don't see a visual style control on the asset/Studio page. This is the same gap Task 16 already closed for `aiProvider` (which also started creation-only, then got a PATCH route + a Studio selector). Do the same thing for `visualStylePresetId`, mirroring Task 16's pattern exactly.

## Scope — file by file

1. **`src/server/modules/project/service.ts`**
   Add `setProjectVisualStylePreset(id: string, visualStylePresetId: VisualStyleId): Promise<ProjectDetail>`, mirroring `setProjectAiProvider` (around line 177) exactly — same shape, just calling `updateProject(id, { visualStylePresetId })`. Import `VisualStyleId` from `../../../contracts/project` (already exported since Task 15).

2. **`src/server/modules/script/routes.ts`**
   Add a new route right next to the existing `router.patch('/:id/ai-provider', ...)` (same router, same file):
   ```ts
   const VisualStyleSchema = z.object({ visualStylePresetId: z.enum(VISUAL_STYLE_IDS) }).strict();
   ...
   router.patch('/:id/visual-style', async (req, res) => {
     const body = VisualStyleSchema.parse(req.body);
     res.json(await setProjectVisualStylePreset(req.params.id, body.visualStylePresetId));
   });
   ```
   Import `VISUAL_STYLE_IDS` from `../../../contracts/project` and `setProjectVisualStylePreset` from `../project`, alongside the existing imports on that file.

3. **`src/client/features/asset/api.ts`**
   Add, mirroring `AI_PROVIDER_OPTIONS`/`setAiProvider` (around line 19/113):
   ```ts
   export const VISUAL_STYLE_OPTIONS = [
     { value: 'cinematic', label: 'Cinematic (điện ảnh)' },
     { value: 'anime', label: 'Anime' },
     { value: 'watercolor', label: 'Watercolor (màu nước)' },
     { value: 'photorealistic', label: 'Photorealistic (ảnh thực)' },
   ] as const;
   export function setVisualStyle(projectId: string, visualStylePresetId: VisualStyleId): Promise<ProjectDetail> {
     // PATCH /api/project/:id/visual-style, same fetch/parse pattern as setAiProvider
   }
   ```
   Use the exact same label wording already used in `NewProjectForm.tsx`'s select options, for consistency.

4. **`src/client/features/asset/StudioPage.tsx`**
   - Add `async function setVisualStyle(preset: VisualStyleId)` mirroring `setAiProvider` (line ~171) exactly: no-op if unchanged, `setBusy('visual-style')`, call `api.setVisualStyle`, `await refresh()`, toast confirming the chosen style (Vietnamese, matching the existing toast style for AI provider).
   - Add a selector group right next to the existing AI provider `engineSelector` div (line ~204), same markup pattern (`role="group" aria-label="Visual style"`, `Button` per option, `variant={project.visualStylePresetId === option.value ? 'indigoline' : 'ghost'}`, `aria-pressed`).

## Non-goals

- Don't touch `scriptPresetId` — no PATCH route for it, this task is only about `visualStylePresetId`. (The user asked specifically about visual style, not script tone/preset.)
- Don't change how `visualStylePresetId` is used in prompt-building (`buildVisualPromptPrompt`/`loadVisualStylePreset`) — this task is purely about exposing the existing field for viewing/editing, not changing what it does.
- Don't add a way to preview what each style actually looks like (no image thumbnails etc.) — just the same text-label selector pattern already used for AI provider.
- Changing the style only affects *future* visual-prompt generation runs — it does not retroactively rewrite existing scene visual prompts. Don't add any backfill/regeneration logic here; that's out of scope.

## Tests

- Mirror whatever existing test coverage exists for `ai-provider` (`script.test.ts` has a PATCH route test around line 224/235) — add an equivalent for `/visual-style` (valid enum value succeeds, invalid value rejected).
- Mirror `asset-api.test.ts`'s existing `setAiProvider` test for the new `setVisualStyle` client function.

## Process rules (same as always)

Stage only the exact files changed, `git diff --stat` first. Never `git add -A`/`git add .`/`git commit -a`. Run `npm run typecheck`, `npm run lint`, and the relevant test files before reporting done. This is the same size/shape as Task 16 — implement directly, no separate spec/plan needed.

**STOP after this report.**
