Spec reviewed (`944a428`, `docs/superpowers/specs/2026-09-25-visual-prompt-sfx-design.md`) — approved, one verification item, no changes needed to the design itself.

The single-`findOneAndUpdate`-with-two-independent-arrayFilter-identifiers approach is the right call over duplicating the function or running two atomic passes — it's correct (MongoDB does allow multiple `arrayFilters` identifiers targeting the same array position for different fields with independent conditions), keeps the version-bump semantics right (one increment per successful write regardless of how many scenes/fields changed), and is easier to reason about than juggling two separate atomic operations. The revised skip condition (both fields must be filled to skip) correctly solves the retroactive-backfill requirement, and I'd already flagged the "chapters with intentionally-empty SFX get reconsidered forever" tradeoff myself — good that the spec documents it explicitly as accepted rather than silently living with it.

One thing to verify during implementation: I checked `src/server/modules/script/script.test.ts` (lines ~123-160) and it calls `applyEmptySceneVisualPrompts(project.id, [{ sceneId, visualPrompt }])` with the current two-field update shape, no `sfxPrompt`. Make sure the extended `updates` type keeps `sfxPrompt` optional (not required) so these existing calls keep compiling and passing unchanged — the spec's "preserving the last value for each supplied field" wording already implies this, just confirming it's not accidentally made mandatory.

Proceed to write the implementation plan.

**STOP after this report.**
