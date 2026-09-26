Spec reviewed (`4bde684`, `docs/superpowers/specs/2026-09-25-visual-style-presets-design.md`) — approved, no changes needed. Two things you added beyond my original request are correct and important, calling them out explicitly:

1. **Production packaging fix**: I checked `scripts/copy-script-presets.mjs` myself — it currently does `readdir(source).filter(name => name.endsWith('.md'))` against `src/server/modules/script/ai/presets` directly, non-recursive. A `visual-styles/` subdirectory would be silently skipped (it doesn't end in `.md`), so without your fix, `loadVisualStylePreset` would throw `ENOENT` in production while every test passes locally against source. Good catch — make sure the updated script is recursive in a way that still only picks up `.md` files (skip any non-md files/dirs it encounters), and preserves the existing flat behavior for the current `presets/*.md` files.

2. **Legacy-document default via `.default('cinematic')` on `ProjectDocSchema`**: correct, and deliberately different from `scriptPresetId`'s pattern (which has no default there) — `scriptPresetId` predates any document missing it, but `visualStylePresetId` is brand new, so existing project documents in the database genuinely lack the field and need the schema-level default to parse without throwing on read. Keep this distinction in the plan/implementation; don't "fix" it to match `scriptPresetId`'s no-default pattern.

3. Including the visual-style preset's id/version in `buildVisualPromptPrompt`'s returned `promptVersion` is a reasonable, low-risk addition (nothing downstream currently persists or compares that value for this specific builder — I checked `generateVisualPrompts` doesn't read `prompt.promptVersion` at all, and the only places that DO expose `promptVersion` externally belong to `buildManualScriptPrompt`, a different function). Just make sure whatever test currently asserts the exact `promptVersion` string for `buildVisualPromptPrompt` gets updated for the new format, if one exists.

Proceed to write the implementation plan.

**STOP after this report.**
