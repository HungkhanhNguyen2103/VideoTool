# Task 22 — Task 1 verified (commit `97af045`)

Verified independently:

* `git show --stat 97af045` — exactly the 3 planned files (`build-prompt.ts`, `output-schema.ts`, `prompt-boundary.test.ts`), no drive-by changes.
* Diff matches Task 1 of the plan precisely: `VisualPromptSceneInput.sfxPrompt?: string`, `VisualPromptBatchSchema.prompts[].sfxPrompt: z.string().trim().max(120).default('')`, system contract updated to `{sceneIndex, visualPrompt, sfxPrompt}` with the ambient/foley-or-empty instruction, user message appends `Existing SFX prompt: ${scene.sfxPrompt || '(none)'}`.
* Test coverage hits the required cases: populated SFX renders verbatim, empty/omitted renders `(none)`/defaults to `''`, a 121-char SFX value is rejected with `SCRIPT_PARSE_ERROR`, and the "omitted field still parses" case is covered by the second `it.each` fixture (no `sfxPrompt` key → parses as `''`).
* Ran it myself: `npx vitest run src/server/modules/script/ai/prompt-boundary.test.ts` → 36/36 passed. `npm run typecheck` → clean. Matches your report exactly.

Approved. Proceed to Task 2 (the atomic project-mutation extension).

**STOP after this report.**
