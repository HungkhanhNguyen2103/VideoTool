# Task 22 — Plan review (commit `632c4ea`)

Reviewed `docs/superpowers/plans/2026-09-25-visual-prompt-sfx-implementation.md` in full against the approved spec (`944a428`) and the original request. Also re-read the current, pre-change source for `src/server/modules/script/visual-prompts.ts` and `src/server/modules/project/service.ts`'s `applyEmptySceneVisualPrompts(WithResult)` to confirm the plan's described extensions are accurate diffs against what's actually there today, not against a stale mental model.

**Approved. Proceed to implementation exactly as planned.**

Specific things I checked and confirmed correct:

1. **Backward compatibility (my flagged item from the spec review):** `EmptyScenePromptUpdate` makes both `visualPrompt` and `sfxPrompt` optional. Existing callers in `script.test.ts` (and `visual-prompts.ts`'s own current call site) pass `{ sceneId, visualPrompt }` with no `sfxPrompt` — this still satisfies the new type structurally, so nothing breaks. `applyEmptySceneVisualPrompts` stays a `ProjectDetail`-only wrapper, unchanged signature. Good.

2. **Atomic independent-field guard shape:** Task 2's `visual${index}`/`sfx${index}` array-filter identifiers, each with their own `{id, field: ''}` predicate, is the correct generalization of the existing single-field pattern I read at `service.ts:236-241` — confirmed this is exactly how the current code already does it for one field, just duplicated per field per scene. The top-level `scenes.$elemMatch` predicate being built from "exact eligible field clauses" (not a blanket OR of all requested scenes) is the right call — it's what prevents the race case in Review Focus item 4 (a concurrent edit fills every field the update wanted to touch → no version-only phantom update).

3. **Skip-condition rewrite:** current code (`visual-prompts.ts:71-73`) computes `prefilled = scenes.filter(visualPrompt !== '').length` and skips the chapter only when `prefilled === scenes.length`. The plan's replacement — skip only when every scene has both `visualPrompt !== ''` and `sfxPrompt !== ''` — is exactly the retroactive-backfill behavior I asked for: a chapter that's fully visual-prompted but has empty `sfxPrompt` everywhere (the user's real 67-scene project) will no longer be skipped, and will get an AI call whose response can only actually change `sfxPrompt` for those scenes (visual prompt writes are no-ops because the atomic guard sees non-empty current values). Matches spec's explicitly-accepted tradeoff (chapters with intentionally-empty SFX get reconsidered on every run).

4. **`chapterScenes`/prompt/parser threading:** `sfxPrompt` flows scene → prompt input → AI contract (`sfxPrompt: z.string().trim().max(120).default('')`) → parsed batch → per-scene update, all optional/defaulted so an older provider response (or a test fixture that doesn't set it) still parses. The "(none)" fallback line convention for the prompt matches every other optional-context line already in this file (`Opening hook`, `Previous chapter summary`, etc. from Task 15).

5. **Non-goals respected:** no video/SFX-generation code touched, no scene-split code touched, no client/UI files in scope, `VisualPromptJobResult`'s public shape is unchanged (SFX counts stay log-only) — all consistent with what I required.

6. **Test coverage (Review Focus section):** covers exactly the 5 cases I'd have asked for if they weren't already there — omitted-field parsing, prompt-line rendering with/without existing SFX, dual-field independence in both directions (visual-filled+sfx-empty and vice versa), and the concurrency race for the SFX guard specifically. No gaps I can see.

No changes requested. Go ahead and implement task-by-task as planned; report each commit as usual and I'll verify independently before you move to the next task, same process as every prior task in this repo.

**STOP after this report.**
