# Tasks 105 and 106 — two small fixes (separate commits, in this order)

Work directly on `main` (no feature branch, no worktree). Never push. Do not stage temp files (`.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`, `docs/superpowers/plans/*`, the stray `01M4W…` files in the repo root). Keep LF line endings in commits. Follow AGENTS.md (rule 11: Status line in the same commit; import through each module's `index.ts`). Code, comments, AI prompts and commit messages are English; user-facing text is Vietnamese.

---

## Task 105 — Vietnamese cue matching in the shot/light planner

File: `src/server/modules/script/shot-plan.ts` (and `shot-plan.test.ts`). Commit message: `fix(script): match Vietnamese shot and light cues without accent collisions`.

### Problem

The planner lowercases narration, strips accents with `normalize()`, then matches short accent-less words with `\b(...)\b`. After stripping, ordinary Vietnamese words collide with cue words, so most Vietnamese scenes get a wrong `lightType` (and some wrong shot preferences). Known collisions (accent-stripped form → intended cue → common word it also matches):
- `duoc` (đuốc, torch → firelight) ← "được"
- `dem` (đêm, night) ← "đem"
- `toi` (tối, dark → night) ← "tôi", "tới"
- `trang` (trăng, moon → night) ← "trang", "trắng"
- `phong` (phòng, room → interior) ← "phong", "phóng", "phồng"
- `ham` (hầm, bunker → interior) ← "hàm", "ham"
- `hop` (họp, meeting → interior) ← "hộp", "hợp", "hớp"
- `lua` (lửa, fire → firelight) ← "lúa", "lừa", "lụa"
- `chay` (cháy, burning → firelight) ← "chạy", "chảy"
- `mua` (mưa, rain → overcast) ← "mua", "múa", "mùa"
- `may` (mây, cloud → overcast) ← "may", "máy", "mày"
This misclassification also feeds Task 102's `referenceTags` (night/interior tags), so it must be fixed before those tags can be trusted.

### Required behavior

1. Do not strip accents for Vietnamese matching. Lowercase with `toLowerCase()` and normalize to NFC, and match Vietnamese cues in their accented form, with Unicode-aware word boundaries (for example `(?<![\p{L}\p{M}])…(?![\p{L}\p{M}])` with the `u` flag) instead of `\b`, which does not work for Vietnamese letters.
2. Keep English cues case-insensitive with the same boundary rule.
3. Accent-less narration is still supported, but only when the text contains no Vietnamese diacritics at all (detect with a regex over the Vietnamese accented letters, including `đ`). In that case use an accent-less cue list restricted to cues that do not collide with common accent-less words (drop `duoc`, `dem`, `toi`, `trang`, `phong`, `ham`, `hop`, `lua`, `chay`, `mua`, `may` from the accent-less list; prefer multi-word or longer forms such as `ban dem`, `anh trang`, `trong nha`, `cuoc hop`). Document the rule in a comment above the cue table.
4. Keep the existing cue tables readable (one constant table); do not change shot rules, light rules, the rotation, the first-scene `wide` rule or chapter-start rules, only how cues are matched.
5. Multi-word Vietnamese cues ("trong nhà", "lá thư", "tài liệu", "vũ khí", "bình minh", "hoàng hôn", "sáng sớm", "chiều tà", "âm u", "hàng nghìn", "toàn quân", "nét mặt", "áp đảo", "quyết định") must match only as whole phrases.

### Tests

- False positives that must NOT trigger a cue: "được", "đem", "tôi", "tới", "trang", "trắng", "phóng", "hàm", "hộp", "hợp", "lúa", "lừa", "chạy", "chảy", "mua", "múa", "mùa", "máy", "mày". For each, assert the planner falls back to the no-cue default (alternating daylight/overcast, rotation shot) rather than a cue light.
- True positives (accented): đêm, tối, trăng → night; lửa, cháy, đuốc, pháo, nổ → firelight; trong nhà, phòng, hầm, lều, họp → interior; bình minh, hoàng hôn, sáng sớm, chiều tà → golden-hour; mưa, sương, mây, âm u → overcast; "lá thư", "tài liệu", "vũ khí" → detail preference; "hàng nghìn", "toàn quân", "đoàn" → wide/high-angle; "quyết định", "nét mặt" → medium/close; "áp đảo" → low-angle.
- Accent-less narration with no diacritics ("dem toi, anh trang") still matches the non-colliding forms and does not match the dropped colliding ones on their own.
- English cues unchanged; determinism, no adjacent equal shots, no triple equal lights, first scene wide, chapter starts (existing tests) still pass.
- A realistic Vietnamese paragraph test: a 10-sentence passage containing "được", "tôi", "trang", "chạy", "mua" in ordinary senses and one real "đêm" scene; only the "đêm" scene gets `night`.

### Docs

Update `src/server/modules/script/MODULE.md` (matching rule, accent-less rule, the collision list as the reason). Add the AGENTS.md Status line in the same commit. Existing projects' stored plans are NOT recomputed (the planner only writes for scenes whose visual prompt is still empty); say so in the report.

---

## Task 106 — Video scenes must end up with a motion prompt

Files: `src/server/modules/script/visual-prompts.ts`, `src/server/modules/script/ai/build-prompt.ts`, tests, and the Studio export control. Commit message: `fix(script): require motion prompts for video scenes`.

### Problem (reproduced by the user)

Importing the Flow scenes JSON into the Runner failed with `Scene #136: AssetType is "video" but 'motionPrompt' is empty or missing.` Cause: the visual-prompt job (`generateVisualPrompts`) tells the AI "only write a non-empty motionPrompt when the asset type is video" but never validates that a video scene actually got one. `validateIndexes` checks only the scene indexes. If the AI returns `""` (or omits it) for a video scene, the update guard `hasPromptValue(update.motionPrompt)` in `applyEmptySceneVisualPromptsWithResult` skips it silently, and the problem only appears in the external Runner.

### Required behavior

1. Prompt: in `buildVisualPromptPrompt`/the system message, state that `motionPrompt` is REQUIRED and non-empty for every scene whose Asset type is `video` and must be empty for image scenes. Mark the scenes that need one in each scene block (for example `Motion prompt required: yes/no`). Bump `promptVersion` to `visual-prompt-v4/${visualPreset.id}@${visualPreset.version}` and update every test and doc that expects `visual-prompt-v3`.
2. Validation with retry: after parsing a batch, for every video scene in the chapter whose stored `motionPrompt` is empty, require a non-empty trimmed `motionPrompt` in the returned item. If any is missing, throw the existing `SCRIPT_PARSE_ERROR` validation error naming the missing scene indexes, so the existing single retry path re-asks with `Validation error: … Return corrected JSON …`. Image scenes are unaffected.
3. Deterministic fallback after the retry: if the retry still leaves a video scene without a motion prompt, do not fail the chapter. Fill that scene with a fixed default chosen by the scene's `shotType` (a small named constant table in English, for example wide → "Slow push-in across the scene; light ambient movement in the background.", detail → "Very slow push-in on the object; subtle dust or light shift.", close/medium → "Gentle push-in on the subject; slight head or cloth movement.", high-angle/low-angle → "Slow tilt along the frame; subtle ambient movement."), and `appendLog` a warning `Scene N: motion prompt missing after retry; default used.` Count these in the final log line (`defaultMotionPrompts: n`) without changing `VisualPromptJobResult`'s public shape beyond what existing tests allow (if a field must be added, keep it optional).
4. Scenes that already have a stored motion prompt are never overwritten (existing behavior).
5. Studio: in the Studio header/export area, before "Copy JSON" and "Export JSON", show a Vietnamese warning notice when any ACTIVE video scene has an empty `motionPrompt`, naming the scene numbers (for example "Scene 136 là video nhưng chưa có motion prompt; Runner sẽ từ chối."). Do not block the export. Put the "which scenes" logic in a small pure helper with tests, in the same style as `scene-activity-ui.ts`. Reuse the existing notice component; no new design tokens.
6. Do not change the Flow export JSON shape or the Runner.

### Tests

- Mocked AI returns an empty `motionPrompt` for a video scene on the first call and a valid one on the retry → the scene is filled, one retry logged.
- Mocked AI returns empty on both calls → fallback default written, warning logged, chapter not marked failed, other scenes in the chapter still saved.
- Mocked AI returns a non-empty `motionPrompt` for an image scene → ignored (stored as empty), as today.
- A video scene that already has a motion prompt is skipped and not overwritten; image scenes never require one.
- Prompt text contains the "required" instruction and the per-scene flag; `visual-prompt-v4` appears where v3 did.
- Pure helper tests for the Studio warning (active only, video only, empty/whitespace motion prompt, inactive scene ignored).

### Docs

Update `src/server/modules/script/MODULE.md` (required motion prompt, retry, fallback table, v4) and the Studio/asset module doc if it describes the export control. Add the AGENTS.md Status line in the same commit.

---

## Verification for both tasks (run and report real output)

`npm run typecheck`, `npm run lint`, the touched and new vitest files plus `src/server/modules/script` and `src/client/features/asset`, and `npm run build`. `app.test.ts` has a known pre-existing SPA fallback failure; do not fix it here. For Task 106 also run a mocked end-to-end job on a two-chapter project with one inactive scene, one prefilled scene and two video scenes (one missing motion prompt on the first AI answer) and paste the resulting log lines.

## Report

Write one untracked report per task: `docs/superpowers/tasks/task-105-report.md` and `docs/superpowers/tasks/task-106-report.md` (commits, files changed, final rules, verification, what you could not verify, deviations). Do not push.
