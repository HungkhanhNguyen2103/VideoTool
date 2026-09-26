Task 3 verified: `35898e7` is correct and scoped to exactly the 2 intended files.

- `scriptPreset`/`visualPreset` correctly split — `systemMessage` still uses `scriptPreset`, exactly the caution I raised during plan review.
- Required-style + core-question lines inserted right after `Language:`; the four continuity lines inserted right after the chapter heading; `Previous style note` untouched; `promptVersion` now `visual-prompt-v1/${visualPreset.id}@${visualPreset.version}`.
- Tests cover both the full-context case and the `(none)` fallback case for every new field.

I ran this myself: `npm run typecheck` clean, `npm run lint` clean, `npx vitest run src/server/modules/script/ai/prompt-boundary.test.ts` → 35/35 pass. Matches your report.

One thing to fix as part of Task 4, not a blocker now: you correctly noted the new `VisualPromptPromptInput` fields are optional-with-fallback so this commit compiles standalone before the sole caller is updated. Once Task 4 makes `generateVisualPrompts` pass all of them explicitly, please tighten the type — drop the `?` on `visualStylePresetId`, `coreQuestion`, `openingHook`, `previousChapterSummary`, `previousAvoidRepeating`, and `previousPersistentFacts` so they become required fields on `VisualPromptPromptInput`, and remove the corresponding `?? project.xxx` / `?? null` / `?? []` fallback lines inside `buildVisualPromptPrompt`. Reasoning: `previousChapterSummary`/`previousAvoidRepeating`/`previousPersistentFacts` can't be safely derived from `project` alone (they depend on which chapter index is being processed), so leaving them optional permanently means a future bug in the orchestration loop — e.g. forgetting to pass previous-chapter data for a later chapter — would silently degrade to "no previous context" instead of failing to compile. Making them required turns that class of bug into a compile error. (`visualStylePresetId`/`coreQuestion`/`openingHook` are safely derivable from `project` today, but tightening all six together keeps the input type's contract consistent and explicit.)

Update the two prompt-boundary tests accordingly if the required change removes the need for the fallback-specific assertions — otherwise leave test coverage as-is.

Proceed to Task 4 (forward previous-chapter context in `generateVisualPrompts`), including the type-tightening above.

**STOP after this report.**
