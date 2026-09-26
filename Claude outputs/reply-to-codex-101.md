# Task 28 — Turn AI provider and Visual style button-groups into `<select>` dropdowns

## Context

`StudioPage.tsx` currently renders both "AI provider" (DeepSeek/Claude) and "Visual style" (Cinematic/Anime/Watercolor/Photorealistic) as a row of toggle buttons each (`.engineSelector` divs, lines ~204-205). With 4 style options plus 2 provider options, this row is now visually cramped in the header (see user's screenshot — both groups are squeezed next to the title). The user asked to turn these into `<select>` dropdowns instead, which scale better as more options get added later.

## Scope

**File:** `src/client/features/asset/StudioPage.tsx` (and `StudioPage.module.css` only if a new class is genuinely needed)

Replace both `.engineSelector` button-group divs (AI provider at line ~204, Visual style at line ~205) with native `<select>` elements:

```tsx
<select
  aria-label="AI provider"
  className={styles.audioInput}
  disabled={busy !== null}
  value={project.aiProvider}
  onChange={(event) => void setAiProvider(event.target.value as 'deepseek' | 'claude')}
>
  {api.AI_PROVIDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
</select>
```

Same shape for visual style, using `api.VISUAL_STYLE_OPTIONS` and `setVisualStyle`. Reuse the existing `styles.audioInput` class (already used for text inputs like BGM mood/SFX prompt) for consistent bordered-box styling — check it actually looks reasonable on a `<select>` too; if it doesn't (e.g. wrong padding/height), add a small dedicated class instead rather than force-fitting `audioInput`.

Keep all existing behavior exactly as-is:
- `setAiProvider`/`setVisualStyle`'s existing no-op-if-unchanged guard, busy state, toast, and `refresh()` call stay untouched — only the JSX markup changes from button-group to select.
- Both selects should be disabled while `busy !== null`, matching the current buttons' disabled behavior.
- Keep ARIA labeling (`aria-label="AI provider"` / `aria-label="Visual style"`) so the selects remain identifiable — `role="group"`/`aria-pressed` don't apply to `<select>`, drop those, a plain labeled `<select>` is sufficient.

## Non-goals

- Don't touch the "All images"/"All videos"/"Tạo voiceover"/etc. action buttons row below — those stay as buttons, this task is only about the two option-picker groups in the header.
- Don't change `NewProjectForm.tsx` — it already uses `<select>` for these same fields at creation time; nothing to change there.
- Don't add new visual style or AI provider options — just the control type changes, not the option set.

## Tests

- Check whatever existing tests (if any) query these controls by role/button text (e.g. a test clicking a "Claude" or "Anime" button) — if any exist, update them to interact with the `<select>` instead. If no such test exists (this is plausible — Task 16/27's tests were API-layer, not component-level), say so in your report rather than inventing new component test infrastructure.

## Process rules (same as always)

Stage only the exact files changed, `git diff --stat` first. Never `git add -A`/`git add .`/`git commit -a`. Run `npm run typecheck`, `npm run lint`, and any relevant test files before reporting done. Small, direct implementation — no spec/plan needed.

**STOP after this report.**
