# Task 44 — not yet complete, missing the AI-generation half

Commit `33904c4` only implements the manual-field / export / Studio-UI part of
`reply-to-codex-140.md`. I diffed the commit myself: `src/server/modules/script/ai/build-prompt.ts`,
`output-schema.ts`, `parse-output.ts`, and the real logic in `visual-prompts.ts` were **not touched
at all** — `visual-prompts.test.ts` only got a fixture literal updated (`motionPrompt: ''`) to
satisfy the schema, no new behavior and no new test for AI-authored motion prompts.

Please implement section "## 2. AI generation (the main part)" from `reply-to-codex-140.md` in
full — that section is what makes this task actually do what Hung asked for ("mình muốn AI viết
cả motionPrompt luôn"). To be explicit about what's still missing:

1. `VisualPromptSceneInput` (build-prompt.ts): add `assetType: AssetType` and
   `motionPrompt?: string`.
2. `VisualPromptBatchSchema` (output-schema.ts): add `motionPrompt: z.string().trim().max(400).default('')`
   to each item in `prompts`.
3. `buildVisualPromptPrompt()`: extend the JSON contract sent to the AI to require a `motionPrompt`
   per scene (non-empty only for `assetType: 'video'`, empty otherwise), and add each scene's asset
   type + existing motion prompt to the per-scene user-message lines.
4. `chapterScenes()` in `visual-prompts.ts`: pass `assetType` and `motionPrompt` through into each
   `VisualPromptSceneInput`.
5. Skip/"fully prefilled" logic in `generateVisualPrompts()`: a scene only counts as fully prefilled
   when `visualPrompt !== '' && sfxPrompt !== '' && (assetType !== 'video' || motionPrompt !== '')` —
   so a video scene missing its motion prompt is not skipped just because visual/SFX are already
   filled.
6. Apply results: include `motionPrompt: item.motionPrompt` in the `updates` mapping.
7. `applyEmptySceneVisualPromptsWithResult` / `EmptyScenePromptUpdate` / `EmptyScenePromptWriteResult`
   in `src/server/modules/project/service.ts`: mirror the existing `sfxPrompt`
   conditional-write-only-if-currently-empty pattern for `motionPrompt`, return
   `updatedMotionPromptSceneIds`.
8. Log line in `generateVisualPrompts()`: report the motion-prompt count too.

Tests needed (none of these exist yet):
- `buildVisualPromptPrompt()` includes asset type / existing motion prompt per scene, and the
  system contract mentions the motionPrompt rule.
- A video-type scene with visual/SFX already filled but empty motionPrompt is NOT skipped.
- An image-type scene's skip behavior is provably unchanged from before this task.
- AI-returned motionPrompt is written only when currently empty (manual edits aren't clobbered).
- `applyEmptySceneVisualPromptsWithResult` returns `updatedMotionPromptSceneIds` correctly.

Keep everything you already built (contract default, export JSON, PATCH route, Studio UI editor) —
that part is fine and stays as-is. This is additive on top of commit `33904c4`, not a redo.

Report format: commit hash, diff summary, lint/typecheck/tests/build status, and — since this is
the part that matters most — show one real example: a video-type Kodak scene's narration +
visualPrompt going in, and the actual `motionPrompt` string the AI wrote coming out, so I can judge
whether it's actually a sensible motion instruction and not just placeholder text.
