# Task 55 - Voiceover fails with TTS 400 on a scene with empty narration

## Evidence
Studio "Tao voiceover" -> api log: `VieNeu TTS request failed after retry. Error: TTS server returned 400` (two 400s = attempt + retry),
stack `generateSceneVoiceover` (tts-service.ts:22) <- routes.ts:62.
`lib/tts_server.py` returns 400 ONLY for empty text (`Van ban khong duoc de trong.`; bad fields would be 422).
In the Vasa project, scene 01 shows `1s`; `estimateNarrationDurationSec` = max(1, round(words/150*60)), so 1s means ~0 words -> empty narration.

## Confirmed root cause (Hung's screenshot of Scene 01 detail: narration area is blank, visual prompt exists)
`finalizeScript` (script/service.ts ~l.351) creates ONE scene per chapter paragraph: `paragraphs.map(narration => scene)`, with
`chapter.paragraphs.length ? chapter.paragraphs : ['']`. A blank or whitespace paragraph (or a chapter with no paragraphs) therefore becomes an
empty-narration scene. `z.string().min(1)` in the output schemas accepts " ". Visual prompts were still generated for that scene (opening hook context).
Hung suspects scene 01 is the opening HOOK. `project.openingHook` is a separate field and is never turned into narration.

## Missing feature found by Hung: no way to edit a scene's narration after finalize
`PatchSceneSchema` (asset/routes.ts) accepts only visualPrompt, assetType, sfxPrompt, motionPrompt. Studio scene detail shows narration read-only
(StudioPage.tsx ~l.349). Narration can only be edited on the review page BEFORE finalize; re-finalizing recreates all scenes and wipes
visual prompts/assets/voiceovers. So an empty/wrong scene found in Studio cannot be fixed without losing work.

## Do
00. Add `narration` (string, trimmed, min 1, max e.g. 2000) to `PatchSceneSchema`, `patchProjectScene` and the Studio scene detail
   (Edit button like visual prompt). On change: set `durationSec = estimateNarrationDurationSec(narration)`; if the scene has `audioFileId`,
   clear `audioFileId` and `wordTimings` (voiceover no longer matches) and show a hint "Tao lai voiceover"; keep assets/visual/motion prompts.
   Keep the chapter's `paragraphs` and `durationSec` totals consistent (update the matching paragraph via scene index within the chapter, or
   document why chapters and scenes may diverge after this edit). Tests incl. optimistic concurrency, empty narration rejected (422), audio cleared.
0. Before anything else: `finalizeScript` must ignore paragraphs where `trim()` is empty, and must refuse (422 `EMPTY_CHAPTER`,
   message names the chapter) when a chapter has no non-blank paragraph, instead of creating `['']`. Output schemas for paragraphs use `z.string().trim().min(1)`.
   Chapter PATCH (`patchChapter`) must also drop blank paragraphs.
   Do NOT auto-insert `openingHook` as narration; instead, in the chapter review UI, show the hook with an "Insert as first paragraph" action
   (only when chapter 1's first paragraph differs from the hook). Ask Hung before changing hook behaviour beyond this button.
1. Find out how an empty-narration scene gets created (scene split output, chapter with empty paragraph, manual edit). Reproduce in a test
   (`scene-split.ts` line ~69 uses `chunk.trim()`; check `parseSceneSplitBatch` accepts `chunks` whose trim() is empty - `z.string().min(1)` does NOT reject "  ").
   Fix at the source: drop blank chunks; if a scene ends with no narration, merge it away.
2. `generateSceneVoiceover`: if `scene.narration.trim()` is empty, throw `AppError` 422 `EMPTY_NARRATION` with message
   `Scene N has no narration text, so no voiceover can be generated.` (no TTS call, no retry).
3. "Generate all voiceovers" (client loop or job): skip empty scenes, continue with the rest, and show a summary toast
   `Voiceover done for X scenes; skipped Y scenes with no narration (scene numbers ...)`.
4. `vieneu.ts`: when the TTS server returns 4xx, do NOT retry (only retry 5xx/network) and include the server `detail` in the thrown message.
5. Studio: badge `Khong co loi dan` on such scenes; disable its voiceover button.
6. Tests for each point. No new dependencies, no other modules.

## Report back
Commit hash, tests, typecheck/lint, and what caused the empty scene in the Vasa project (scene number, how it was produced).
