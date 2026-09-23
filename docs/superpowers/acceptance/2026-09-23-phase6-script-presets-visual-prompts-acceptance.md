# Phase 6 acceptance: script presets and visual prompts

Date: 2026-09-23

## Verification

The required commands passed on Windows from the isolated worktree:

- `npm run typecheck`
- `npm run lint`
- `npm test` — 20 test files passed, 1 skipped; 252 tests passed, 1 skipped. The skipped file is the pre-existing project todo. `mongodb-memory-server` ran successfully. AI provider calls were mocked; no network calls were made.
- `npm run build` — Vite client build, preset copy, and tsup server/worker build all passed.

Production preset packaging was verified with the exact copied artifacts:

- `dist/presets/documentary.md`
- `dist/presets/explainer.md`

The built-output scan found no `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `openai`, `anthropic`, or source-tree preset path matches in `dist/client`, `dist/server.js`, or `dist/worker.js`. The Vite chunk-size warning above 500 kB remains non-blocking and pre-existing in character.

Boundary checks found no direct project collection/repository access in script production code. `eslint.config.js` is unchanged. The new route is script-owned at `POST /api/project/:id/scenes/generate-visual-prompts`; no public job-create/list route was added.

## Delivered behavior

- Versioned Markdown presets are loaded from source during development and copied to `dist/presets/` for production. Documentary and explainer guidance are mechanically distinct and carried through generation/regeneration prompt versions.
- Visual batches use stable request-only global `sceneIndex` values, require an exact echoed index set, retry one validation failure, and skip a failed chapter without blocking later chapters.
- Existing prompts are seeded as bounded style context on reruns, authored prompts are preserved, cancellation is cooperative, and project writes are atomic, empty-only, deduplicated last-value-wins updates with race-safe versioning.
- Finalization remains synchronous and writes empty visual prompts; generation is a separate queued `generate-visual-prompts` job.
- Studio exposes `Tạo visual prompt` and keeps it disabled during local work, empty-scene absence, and the full enqueue-to-terminal project-job interval, including the gap before the first SSE progress state.

## Commit sequence

1. `4392743 feat(script): load versioned script presets`
2. `7d74204 fix(script): reject overflowing preset versions`
3. `42139a1 feat(script): move prompt schemas and parsers into ai`
4. `44ba503 fix(script): preserve preset field in initial prompt`
5. `4d8ef97 feat(project): add race-safe empty visual prompt mutation`
6. `a796cee feat(script): add visual prompt generation job`
7. `25dc66a fix(script): correct visual prompt seeding and atomic counts`
8. `0b2bde6 feat(script): add visual prompt routes and worker wiring`
9. `ec9a4ba feat(client): add Studio visual prompt action`
10. `2775761 feat(script): add preset and visual prompt coverage`
11. `docs(phase6): record script preset and visual prompt acceptance` (this record)

## Remaining acceptance gap

Live VieNeu/other provider calls remain intentionally unexercised in automated tests. A live 1440px Studio visual comparison remains an environment-level acceptance gap; the typed API, pure client predicate, build, and regression coverage are green.
