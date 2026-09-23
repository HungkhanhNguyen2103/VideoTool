# Phase 7 acceptance: script outline, word budget, provider, and manual mode

Date: 2026-09-23

## Verification

The required commands passed on Windows from the real `main` checkout:

- `npm run typecheck`
- `npm run lint`
- `npm test` — 22 test files passed, 1 skipped; 282 tests passed. The skipped file is the pre-existing project todo. `mongodb-memory-server` ran successfully and AI provider calls were mocked; no network calls were made.
- `npm run build` — Vite client build, Markdown preset copy, and tsup server/worker build all passed. The existing non-blocking Vite warning about a client chunk larger than 500 kB remains.

Production preset packaging was verified after the build:

- `dist/presets/documentary.md`
- `dist/presets/explainer.md`
- `dist/presets/hubris-trap.md`

The production and boundary scans also passed:

- `eslint.config.js` has no diff.
- No `DEEPSEEK_API_KEY` or `ANTHROPIC_API_KEY` identifiers were found in `dist/client`.
- No `getCollection` or direct project repository/service imports were found in script production code.

## Delivered behavior

- Script documents now support additive narrative metadata (`role`, `beat`, `targetWords`, `endsOnTension`) and project-level `openLoops`/`motif` defaults without a migration. Documentary, explainer, and hubris-trap presets are packaged and mechanically distinct.
- Automatic generation is a queued, cancellable outline-then-expansion flow. It validates the outline and chapter count before persistence, expands chapters sequentially, carries bounded style notes and only chapter-relevant open loops, retries a short response once below 80% of target words, accepts the retry unconditionally, and isolates provider failures to the affected chapter.
- The hubris-trap outline requires `hunter`, `perfectPlan`, `blindSpot`, and `selfDestruction`; non-hubris outlines reject a motif. Explicit chapter counts must match, while AI-selected counts are bounded to 1–20.
- The script module owns provider/manual routes while project owns the versioned provider and script mutations. Manual mode parses one complete document synchronously, never enqueues a job or calls an AI provider, validates chapter count before persistence, and preserves pasted text when import fails.
- Review and finalization use the shared 150-WPM word counter and the same per-paragraph duration formula with a one-second minimum. Finalized scenes keep empty visual prompts for the later visual-prompt job.
- The client exposes provider selection at creation and review time, automatic/manual generation controls, typed manual prompt/import APIs, preserved failed-import text, and conditional narrative metadata display.

## Cross-cutting regressions explicitly checked

These behaviors were rechecked because they were corrected during implementation and could be missed by a broad production scan:

- Open-loop scoping: the expansion flow filters loops by `plantedInChapter === chapter.no || resolvedInChapter === chapter.no`. Regression coverage proves a loop appears in both its planted and resolved chapters, while a chapter-3-only loop is absent from chapter 2.
- Manual chapter-count validation: manual import parses first, then reuses the generic chapter-count validator before `saveGeneratedScript`. A mismatched manual document returns `422 SCRIPT_PARSE_ERROR`, leaves the complete project unchanged, and creates no job.
- Duration parity: `finalizeScript()` estimates each paragraph separately and sums the results; the review helper does the same rather than estimating a joined chapter string. Existing finalization coverage asserts `[1, 1, 2]` seconds and a total of `4`, while client summary coverage asserts `['one', 'two words']` contributes `2` seconds.
- Cancellation and partial failure: cancellation is checked before calls, after responses, before writes, and through the worker context; a valid response is discarded if cancellation arrives before persistence, and a failed chapter becomes `needs-fix` while later chapters continue.
- Existing visual-prompt, regeneration/history, SSE, finalization-readiness, provider-route, worker-context, and client API regressions remain covered in the full suite.

## Commit sequence

1. `af9b6dc feat(script): add narrative metadata and hubris trap preset`
2. `2a3603b feat(script): add outline and manual AI contracts`
3. `a42e47d feat(project): persist script outline metadata and provider`
4. `e9b133a feat(script): generate scripts from outline and chapter expansions`
5. `021fe76 fix(script): scope expansion prompts to relevant open loops`
6. `5ee9b52 feat(script): add provider and manual generation routes`
7. `78d9b26 fix(script): validate manual chapter counts`
8. `50f6573 feat(script): estimate durations from narration words`
9. `77183c9 fix(script): align review duration with finalized scenes`
10. `b73d1b9 feat(client): add provider and manual script controls`
11. `docs(phase7): record script outline and manual mode acceptance` (this record)

## Remaining acceptance gaps

Live AI provider calls remain intentionally unexercised in automated tests. Full browser visual acceptance of the new review-page controls remains an environment-level gap; typed client APIs, pure helper tests, typecheck, lint, build, and regression coverage are green.
