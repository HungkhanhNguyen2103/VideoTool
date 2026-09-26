# Task 23 — sfxPrompt suggestions must be short English words, not narration language

## Context

Task 22 made visual-prompt generation also suggest `sfxPrompt` for each scene. The user just pointed out (screenshot of the Studio scene-detail dialog) that the generated SFX prompt is currently in Vietnamese (the narration language) — e.g. "Tiếng bút ký lên giấy, tiếng thở dài khe khẽ, tiếng cà phê nguội nhỏ giọt".

I checked why this matters: `sfxPrompt` is consumed directly by `getFreesoundClient().searchAndDownloadSfx(scene.sfxPrompt)` in `src/server/modules/video/service.ts` — Freesound's search index is English-tag-based, so a Vietnamese phrase will search poorly or return nothing relevant. The fix is to change the AI instruction so it always suggests SFX prompts as short English keywords/tags, regardless of the project's narration/script language.

## Scope — single file, prompt-instruction change only

**Modify:** `src/server/modules/script/ai/build-prompt.ts`

In `buildVisualPromptPrompt`, the current system-contract sentence (around line 198) reads:

> "sfxPrompt should be a short ambient or foley sound suggestion in the narration language, or an empty string when no sound is appropriate."

Change it to require short English keywords, e.g.:

> "sfxPrompt should be a short ambient or foley sound-search phrase in English (2-6 words, like a Freesound search query — e.g. 'pen writing on paper', 'quiet sigh', 'coffee dripping'), regardless of the narration language, or an empty string when no sound is appropriate."

Keep everything else in that sentence and the rest of the system contract unchanged (JSON shape, positive one-based indexes, non-empty visual prompts, "preserve their intent" for existing prompts).

Do not change the `max(120)` cap in `output-schema.ts` — English tag phrases will comfortably fit.

## Non-goals

- Do not touch `src/server/modules/video/service.ts` or any Freesound-calling code.
- Do not add any translation/normalization step for *existing* already-generated Vietnamese `sfxPrompt` values already stored in the DB — this only changes what gets suggested for scenes that still have an empty `sfxPrompt` going forward. (If the user wants existing Vietnamese SFX prompts redone, that's a separate follow-up — don't do it here.)
- Do not change the visual prompt instruction, the `(none)` fallback line, or anything about `coreQuestion`/`openingHook`/continuity fields.
- No UI changes.

## Tests

- Update/add a `prompt-boundary.test.ts` assertion that the system message's sfxPrompt instruction requires English output (e.g. assert it contains "in English") rather than "in the narration language".
- No other test files should need changes — this is a pure instruction-string edit; the schema, parser, and orchestration logic in `visual-prompts.ts` don't need to change.

## Process rules (same as always)

Stage only the exact file(s) changed after `git diff --stat`. Never `git add -A`/`git add .`/`git commit -a`. Run `npm run typecheck`, `npm run lint`, and `npx vitest run src/server/modules/script/ai/prompt-boundary.test.ts` before reporting done.

This is small enough to implement directly — no separate spec/plan cycle needed, just report the commit when done.

**STOP after this report.**
