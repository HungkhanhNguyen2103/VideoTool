# Task 101 — Deterministic shot and light plan for scene visual prompts

Work directly on `main` (no feature branch, no worktree). Never push. Do not stage temp files (`.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`). Keep LF line endings in commits. Follow AGENTS.md (rule 11: add/refresh the Status line in the same commit; import through each module's `index.ts`). Code, comments, AI prompts and commit messages are English; any user-facing text is Vietnamese.

## Why

Scenes generated for one video look too similar. The visual-prompt job (`src/server/modules/script/visual-prompts.ts` + `buildVisualPromptPrompt` in `src/server/modules/script/ai/build-prompt.ts`) asks the AI per chapter for one visualPrompt per scene, and the only variety instruction is one soft sentence in `VISUAL_PROMPT_CONTRACT`: "Vary the shot type across consecutive scenes (wide, medium, close detail)...". The AI sees one chapter at a time, so rhythm across the whole video is not controlled, lighting and camera angle are never varied, and nothing checks the result. Downstream, the image generator does not alter prompts, so prompt variety is what decides whether scenes look different.

Goal: the server computes a deterministic **shot plan** (shot type + light type) for every active scene of the whole project, feeds it to the AI as a hard per-scene requirement, persists it on the scene, and logs a warning when a returned prompt does not follow it. The persisted fields will later drive per-scene style-reference tags (a separate future task; do NOT implement that here).

## 1. Contracts (`src/contracts`)

Add to `project.ts` (or a new `shot-plan.ts` exported the same way as other contracts):
- `SHOT_TYPES = ['wide', 'medium', 'close', 'detail', 'high-angle', 'low-angle'] as const`
- `LIGHT_TYPES = ['daylight', 'overcast', 'golden-hour', 'night', 'firelight', 'interior'] as const`
- Add optional `shotType` and `lightType` to `SceneSchema`: `z.enum(SHOT_TYPES).nullable().default(null)` and `z.enum(LIGHT_TYPES).nullable().default(null)`. Legacy documents without the fields must parse unchanged. Mirror the fields in the project doc schema (`src/server/modules/project/docs.ts`) and anywhere scenes are mapped between doc and contract (`project/service.ts` mapping near `customStyleReferenceFileId`-style mappers; search for `motionPrompt` to find every mapper).
- Contract tests for the defaults and for rejecting unknown values.

## 2. Planner (`src/server/modules/script/shot-plan.ts`, new, pure and deterministic)

`planSceneShots(scenes: readonly { narration: string }[], options?: { chapterStarts?: ReadonlySet<number> }): { shotType: ShotType; lightType: LightType }[]` — index-aligned with the input. No randomness, no clock, no AI. Same input gives the same output.

The planner receives ALL active scenes of the project in order (inactive scenes are excluded with the existing `activeScenes` helper from `src/contracts/scene-active.ts`), so rhythm is continuous across chapters. `chapterStarts` holds the indexes (in the active list) of the first active scene of each chapter.

Shot rules (hard constraints first, preferences second):
1. Never the same `shotType` as the previous scene. Avoid the same `shotType` as two scenes back unless no other candidate remains.
2. The first scene of the video is `wide`. The first scene of each other chapter prefers `wide` or `high-angle`.
3. Narration cues may choose among the allowed candidates (English and Vietnamese keywords, case-insensitive, accents optional): documents, letters, weapons, tools, maps, coins, "lá thư", "tài liệu", "vũ khí" → prefer `detail`; crowds, armies, fleets, whole regions, "hàng nghìn", "toàn quân", "đoàn" → prefer `wide` or `high-angle`; a single person speaking, deciding or reacting, "quyết định", "nét mặt" → prefer `medium` or `close`; looming threat, power, "áp đảo" → prefer `low-angle`. Keep the cue lists in one readable constant table so they are easy to extend.
4. With no cue, fall back to a fixed rotation such as `wide, medium, close, medium, detail, low-angle, high-angle` advancing one step per scene, skipping candidates that violate rule 1.

Light rules:
1. Infer from narration cues: night, moon, darkness, "đêm", "tối", "trăng" → `night`; fire, torches, explosions, shelling, "lửa", "cháy", "đuốc", "pháo", "nổ" → `firelight`; indoors, rooms, bunkers, tents, councils, meetings, "trong nhà", "phòng", "hầm", "lều", "họp" → `interior`; dawn, dusk, sunrise, sunset, "bình minh", "hoàng hôn", "sáng sớm", "chiều tà" → `golden-hour`; rain, fog, mist, clouds, "mưa", "sương", "mây", "âm u" → `overcast`.
2. No cue: alternate `daylight` and `overcast`.
3. Never the same `lightType` three scenes in a row; if a cue-driven or default value would make three, switch the third to the nearest alternative (for example `daylight` → `overcast`, `interior` stays `interior` only twice).

Unit tests (`shot-plan.test.ts`): determinism; over 60 neutral scenes no two adjacent equal shots and no triple equal lights; first scene `wide`; chapter starts respect rule 2; each cue family maps to the expected candidates (English and Vietnamese, with and without accents); empty and single-scene inputs; the plan length equals the input length.

## 3. Prompt wiring

In `visual-prompts.ts` (`chapterScenes` / `generateVisualPrompts`):
- Compute the plan once per job over all active scenes, derive `chapterStarts`, and attach `shotType` / `lightType` to each `VisualPromptSceneInput` (extend that type in `ai/build-prompt.ts` with optional fields).
- Only scenes whose `visualPrompt` is still empty are sent to the AI and written (existing behavior: prefilled scenes are skipped); keep that. Prefilled scenes still take part in the plan computation so neighbours stay consistent, but their stored plan fields are not overwritten.

In `ai/build-prompt.ts`, `buildVisualPromptPrompt`:
- Add to each scene block two lines: `Required shot: <shotType> — <English phrase>` and `Required light: <lightType> — <English phrase>`. Phrases, e.g. wide = "wide establishing shot, subject small in a large setting", medium = "medium shot, subject from the waist up", close = "close-up on a face or hands", detail = "tight detail shot of one object", high-angle = "high angle looking down on the scene", low-angle = "low angle looking up at the subject"; daylight = "clear daylight", overcast = "flat overcast light", golden-hour = "low golden-hour sun", night = "night, dark with a few light sources", firelight = "warm firelight with smoke", interior = "indoor light from a lamp, window or lantern". Put the phrase table in one exported constant so tests can reuse it.
- In `VISUAL_PROMPT_CONTRACT` replace the sentence "Vary the shot type across consecutive scenes (wide, medium, close detail) so the sequence has rhythm, ..." with: each scene lists a required shot and a required light that the visualPrompt MUST follow and state explicitly in its wording; recurring characters, places and objects keep identical identifying details (age, clothing, build, colors), but their pose, framing, background and composition must differ from the neighbouring scenes; keep the existing lower-right-corner rule.
- Bump `promptVersion` to `visual-prompt-v3/${visualPreset.id}@${visualPreset.version}` and update every test and doc that expects `visual-prompt-v2`.

## 4. Persistence

Extend the write path used by the job (`applyEmptySceneVisualPromptsWithResult` and its `EmptyScenePromptUpdate` type in `src/server/modules/project/service.ts`, plus the project module's `index.ts` exports if needed) so `shotType` and `lightType` are written together with `visualPrompt` for the same scene under the same guard (scene active and `visualPrompt` still empty). The existing concurrency behavior and the `updatedSceneIds` semantics must not change. A scene whose prompt was not written keeps its previous plan fields.

## 5. Soft validation (log only)

After parsing the AI batch, for each returned scene check that the prompt text loosely mentions the assigned shot and light (a small keyword regex table per shot/light type, e.g. wide → "wide|establishing|panoramic|distant", close → "close-up|close up|tight on", night → "night|moonlit|dark"). When it does not, `context.appendLog` a warning such as `Scene 12: prompt may not follow required shot "close" / light "night".` Do not retry, do not reject, do not change `VisualPromptJobResult`. Tests with mocked AI output for both a following and a non-following prompt.

## Out of scope

- No change to Runner/Flow export JSON, no `reference_tags` yet (next task will derive them from `shotType`/`lightType`).
- No UI work (do not show the fields in Studio yet), no change to SFX/motion prompts, popups, or the script-generation prompts.
- Do not touch the unused `asset/ai/presets/image-default.md`.
- No re-generation of existing prompts: only empty ones are filled, as today.

## Docs and Status

Update `src/server/modules/script/MODULE.md` (planner, rules, prompt v3, soft validation) and `src/server/modules/project/MODULE.md` (new scene fields and write path); add the AGENTS.md Status line in the same commit.

## Verification (run and report real output)

`npm run typecheck`, `npm run lint`, the new and touched vitest files plus `src/contracts`, `src/server/modules/script`, `src/server/modules/project`, and `npm run build`. Add a mocked end-to-end job test covering a two-chapter project with one inactive scene and one prefilled scene (plan computed over active scenes, prefilled scene untouched, fields persisted for filled scenes, warning logged for a non-following prompt). If you can run a real provider call safely, run one small real project and paste the 10 resulting prompts with their assigned shot/light so I can judge variety; if not, say so. `app.test.ts` has a known pre-existing SPA fallback failure; do not fix it here.

## Report

Write `docs/superpowers/tasks/task-101-report.md` (untracked): commits, files changed, the final planner rules as implemented, how you verified, what you could not verify, and any deviation from this brief. Commit message: `feat(script): deterministic shot and light plan for scene visual prompts`. Do not push.
