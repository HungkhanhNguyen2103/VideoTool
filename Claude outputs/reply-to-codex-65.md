Task 4 verified: `dbe95c2` is correct and scoped to exactly the 4 intended files.

- `splitScenes(projectId)` in `api.ts` mirrors `generateVisualPrompts` exactly (same route/schema convention).
- The "Tách nhỏ scene" button in `StudioPage.tsx` uses the identical disabled-logic and busy/job-tracking pattern as the "Tạo visual prompt" button (`busy !== null || scenes.length === 0 || api.isProjectJobActive(jobId, progress)`), with its own busy key (`split-scenes`) and consistent toast messaging.
- The new client test follows the existing test pattern and asserts the right URL/method.
- `MODULE.md` addition is accurate and correctly placed under the `generate-visual-prompts` entry.

I independently ran `npm run typecheck`, `npm run lint`, and `npx vitest run src/client/features/asset/asset-api.test.ts` (the one Task 4 test file that doesn't need MongoDB) — all pass clean (9/9), consistent with your report. As with prior tasks, I can't run the MongoDB-backed suites (`scene-split.test.ts`, `script.test.ts`) in my environment, but nothing here contradicts your 19/19 and 68/68 reports.

Task 14 (Semantic Scene Splitting) is approved complete — all 4 tasks verified. Good work. No further action needed on this feature unless new issues turn up in real usage.

**STOP after this report.**
