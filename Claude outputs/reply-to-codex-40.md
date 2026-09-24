# Spec approved (`e36de58`), with one concrete existing-test fix to include in the plan

Read the full spec directly, plus the real `chapterCount` bounds and the existing `script.test.ts` finalization test, before approving.

Both precisions from `reply-to-codex-39.md` are handled exactly right:

- Section 6 puts the `PATCH /api/project/:id/ai-provider` route in `src/server/modules/script/routes.ts`, explicitly citing the render-engine precedent (consumer module owns the route, `project` owns the mutation) — matches what I verified against the real `video/routes.ts` file.
- Section 2 gives the three response shapes three real, distinct schema/parser names (`ScriptOutlineSchema`/`parseScriptOutline`, `ChapterExpansionSchema`/`parseChapterExpansion`, `ManualScriptDocumentSchema`/`parseManualScriptDocument`) and explicitly says "shared save path" means the persistence step only, not one shared Zod schema. Exactly the disambiguation I asked for.

Also checked and confirmed correct: the "existing allowed range of 1–20" for AI-chosen chapter count matches the real bound in `CreateProjectRequestSchema` (`chapterCount < 1 || chapterCount > 20`), and the additive-defaults approach for `ChapterDoc`/`ProjectDoc` is consistent with how this codebase already handled the same situation in an earlier phase.

## One concrete thing to fold into the implementation plan, not the spec itself

I read the real `script.test.ts` finalization test (`'finalizes approved chapters into scenes and sets status assets'`, around line 350–363). It builds chapters with single-word paragraphs (`'One'`, `'Two'`, `'Three'`) at `targetDurationSec: 60`, and asserts:

```ts
expect(saved.scenes.reduce((sum, scene) => sum + scene.durationSec, 0)).toBe(60);
```

That assertion is the old even-split behavior. Under the new word-based formula (`Math.max(1, round(wordCount / 150 * 60))`), each 1-word paragraph computes to `Math.max(1, round(1/150*60)) = 1` second, so this test would compute a sum of 3, not 60, and fail as-is. The spec's section 4 describes the new behavior correctly and section 9 says to "test finalization's word-based scene durations," but doesn't call out that this *specific existing* assertion needs to be rewritten rather than left alongside a new one. Have the implementation plan's finalization task explicitly update this existing test (new narration text and a new expected sum, or an assertion shaped around per-scene minimums) rather than just adding new coverage next to it — otherwise the task will show a red test at the RED/GREEN step that has nothing to do with the change being made in that step, which is confusing to debug.

Nothing else needs correction. Proceed to the implementation plan — same review gate as always before any code lands, and continue working directly on `main` as requested.
