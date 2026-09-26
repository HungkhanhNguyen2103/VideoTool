# Task 29 — Add a 5th visual style preset: "Flat Cartoon" (`flat-cartoon`)

## Context

User attached a reference image (historical/military marching-army illustration) and asked to add it as a new visual style preset, alongside the existing 4 (`cinematic`, `anime`, `watercolor`, `photorealistic`). Confirmed name/id with the user: **Flat Cartoon** / `flat-cartoon`.

The reference image's style: flat, cel-shaded cartoon/vector illustration with clean bold black outlines, no photorealistic shading or gradients (flat color fills with minimal soft shadow blocking), chibi-like stylized character proportions (slightly oversized heads, simplified faces, compact bodies), a muted/desaturated earthy color palette (olive greens, tans, browns, dusty blues), and a historical/wuxia-military subject treatment (period clothing, banners, weapons, armor) — though the *subject matter* itself is driven by the scene's own narration/visual prompt content, not fixed to soldiers; only the *rendering style* should be this flat-cartoon look.

## Scope — mirror Task 15's preset pattern exactly

1. **`src/contracts/project.ts`**
   Extend `VISUAL_STYLE_IDS`: `['cinematic', 'anime', 'watercolor', 'photorealistic', 'flat-cartoon'] as const`. Nothing else in this file needs to change — `VisualStyleId`, both zod enums (`CreateProjectRequestBase`/`ProjectDetailSchema`) derive from this array automatically.

2. **New file `src/server/modules/script/ai/presets/visual-styles/flat-cartoon.md`**
   Same frontmatter/section shape as the other 4 (see `cinematic.md` for the exact format: `---\nid: flat-cartoon\nversion: 1\n---\n## Style\n<directive>`). Write a 2-4 sentence directive capturing: flat cel-shaded vector illustration, bold clean outlines, no photorealistic lighting/gradients, stylized chibi-like proportions (slightly oversized heads, simplified expressive faces), muted/desaturated earthy palette. Do NOT bake in "historical/military" as a fixed subject — that comes from the scene's own content; the preset only governs rendering style. Something like:

   > Render every scene as a flat, cel-shaded cartoon illustration with bold clean black outlines and no photorealistic lighting or gradients — flat color fills with minimal, simple shadow blocking only. Use stylized, slightly chibi-like character proportions: somewhat oversized heads, simplified expressive faces, and compact bodies. Favor a muted, desaturated earthy color palette (olive greens, tans, browns, dusty blues).

   (Feel free to word it more naturally, but keep the same substance and length as the existing presets.)

3. **Client — `src/client/features/project/components/NewProjectForm.tsx`**
   Add a 5th `<option>` to the existing `id="visual-style"` select: value `flat-cartoon`, label "Flat Cartoon" (match the plain-English style of the "Anime" option, which has no Vietnamese parenthetical — the other three do, e.g. "Cinematic (điện ảnh)"; use your judgment on whether "Flat Cartoon" needs a Vietnamese gloss too, but keep it short).

4. **Client — `src/client/features/asset/api.ts`**
   Add a 5th entry to `VISUAL_STYLE_OPTIONS`: `{ value: 'flat-cartoon', label: 'Flat Cartoon' }` (or with a short Vietnamese gloss, matching whatever you decide for #3 — keep both labels consistent with each other).

## Non-goals

- Don't change how `visualStylePresetId` is used anywhere else (`buildVisualPromptPrompt`, `loadVisualStylePreset`, the PATCH route from Task 27, the `<select>` controls from Task 28) — a 5th enum value flows through all of that automatically since it's all driven off `VISUAL_STYLE_IDS`.
- Don't touch `scriptPresetId` or its presets — unrelated.
- Don't add more than this one new preset.

## Tests

- `visual-style-loader.test.ts` (from Task 15) — check whether it iterates `VISUAL_STYLE_IDS` generically or hardcodes the 4 known ids/labels; if it loops generically, the new preset is covered automatically (add a case only if the test asserts something preset-specific, like exact style text, for each one). If it's a fixed list, add the `flat-cartoon` case following the existing pattern.
- Same check for `build-prompt.test.ts`/any project-contract test that enumerates `VISUAL_STYLE_IDS` values or asserts the exact count of options (e.g. `expect(VISUAL_STYLE_IDS).toHaveLength(4)` would need bumping to 5 — search for this).
- Add/update a client test if `NewProjectForm`/`asset-api.test.ts` has anything asserting the exact option list.

## Process rules (same as always)

Stage only the exact files changed, `git diff --stat` first. Never `git add -A`/`git add .`/`git commit -a`. Run `npm run typecheck`, `npm run lint`, and relevant test files before reporting done. Small/additive, same shape as adding any of the original 4 presets — implement directly, no spec/plan needed.

**STOP after this report.**
