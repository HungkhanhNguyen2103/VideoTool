# Task 106 report — require motion prompts for video scenes

Commit: `343f05e` (`fix(script): require motion prompts for video scenes`)

## Changes

- Visual prompt v4 requires a non-empty `motionPrompt` for each video scene and an empty value for image scenes. Each scene block says whether a motion prompt is required.
- A missing returned prompt is validated only when the stored video-scene prompt is empty or whitespace. The existing one-retry path receives a `SCRIPT_PARSE_ERROR` naming the missing scene numbers. If the retry still omits a prompt, the job fills a deterministic default for that scene's shot type, logs the fallback, and includes `defaultMotionPrompts: n` in its completion log. Populated stored prompts are preserved; image-scene response prompts are ignored.
- The atomic project writer now treats whitespace-only stored motion prompts as empty while retaining its guard against concurrent non-empty manual edits.
- Studio shows an active-only warning with original scene numbers before Copy JSON and Export JSON. It uses the existing warning style and does not disable the export buttons.
- Updated the script, project, and asset module docs plus the AGENTS.md Status entry. No schema or Flow JSON shape changed.

## Tests

- `visual-prompts.test.ts` now covers first-response omission and retry correction, the two-chapter inactive/prefilled/video-retry/fallback flow, all six shot-type defaults, whitespace-only stored prompts, preservation of populated stored prompts, image-scene response suppression, and the final default count. The fixture supports seven scenes so the fallback test exercises every shot type.
- `prompt-boundary.test.ts` updates the existing v3 expectations to v4 and checks the video/image requirement text and per-scene yes/no flag.
- `scene-activity-ui.test.ts` checks active video filtering, 1-based original numbering, whitespace, inactive/image exclusion, empty result, and singular/plural notice copy. `StudioPage.test.ts` checks the notice precedes both JSON actions and those actions are not disabled by the warning.

## Verification

- Focused command `npx vitest run src/server/modules/script src/server/modules/asset src/client/features/asset`: **30 files passed, 605 tests passed**.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: **101 files passed, 1 skipped file; 1,277 tests passed**.
- `npm run build`: passed. Vite emitted the existing informational warning for a client chunk above 500 kB.
- Vitest used the installed MongoDB 8.0 binary at `C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe`; its version notice reported system 8.0.6 versus requested 8.2.6 and confirmed it was using the system binary.
- The mocked two-chapter test ran against the test MongoDB with AI responses mocked. Actual job log lines:

```text
Chapter 1: invalid visual prompt batch; retrying once (Missing motionPrompt for video scenes: 2.).
Scene 2: prompt may not follow required shot "wide" / light "daylight".
Chapter 1: 1 visual prompts added; 1 SFX prompts added; 1 motion prompts added; 0 already filled.
Chapter 2: invalid visual prompt batch; retrying once (Missing motionPrompt for video scenes: 4.).
Scene 4: motion prompt missing after retry; default used.
Scene 4: prompt may not follow required shot "close" / light "daylight".
Scene 5: prompt may not follow required shot "medium" / light "overcast".
Chapter 2: 2 visual prompts added; 2 SFX prompts added; 1 motion prompts added; 1 already filled.
Visual prompts finished: 3 updated, 3 SFX prompts added, 2 motion prompts added, 1 skipped, skippedInactive: 1, 0 failed chapters, defaultMotionPrompts: 1.
```

## Unverified

- Browser verification of the Studio notice was unavailable: the computer-use inventory returned no apps and no browsers. No real project or external AI provider was used.
- Planner review is pending. No push or merge was performed.
