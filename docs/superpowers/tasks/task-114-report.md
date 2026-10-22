# Task 114 — SEO generation through Claude Code CLI

## Result

Implemented API/Claude CLI selection for SEO generation. API remains the default, and the CLI backend does not read or update project AI provider/model settings. The SEO toolbar keeps its backend and Claude model in local state.

Commit: `e3f06c3` — `feat(seo): generate SEO package through Claude CLI`. Nothing was pushed.

## Request and worker flow

`POST /api/project/:id/seo/generate` accepts the strict body `{ sections?, backend?, cliModel? }`. Omitted `backend` means `api`; the API client preserves the old body shape unless optional generation fields are supplied. CLI models must belong to the Claude model registry. The route checks CLI availability before enqueue, and the worker checks it again. CLI jobs use `maxAttempts: 1` so process/auth/rate-limit errors are not retried as transient failures.

The worker creates a shared `createClaudeCliChat` adapter and injects it into `generateSeoPackage`. The service reuses the existing SEO and Shorts prompts, validators, one schema retry, channel default merging, and project-owned save path. Main sections and Shorts remain sequential. CLI calls use the shared `formatChatMessages` formatter and append the JSON-only instruction to stdin text. Prompt bytes, elapsed time, and audit path are logged without response contents. Cancellation aborts the active process and prevents writes.

The shared CLI layer now contains the chat wrapper and error mapping for timeout, oversized output, rate limit, auth failure, unavailable executable, and general process failure. The existing tolerant JSON extractor was moved into the same shared boundary and is reused by script and SEO CLI parsing. Manual SEO imports retain strict parsing.

`generatedBy.backend` is optional in the contract. New API and CLI output records `api` or `cli`; CLI metadata records provider `claude` and the selected model (or `default`). Legacy provider-backed records map to `api`; manual metadata remains unchanged. No CLI choice or model is persisted to project AI settings.

## Verification

- `MONGOMS_SYSTEM_BINARY='C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe' npx vitest run src/server/shared/claude-cli src/server/modules/seo src/server/modules/script src/client/features/seo src/contracts src/worker --maxWorkers=2` — 49 files passed, 650 tests passed. MongoDB-backed tests used the installed 8.0.6 binary because the default download has a known MD5 mismatch.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed. Vite reports the existing client chunk-size warning above 500 kB.
- Live CLI smoke: Claude Code 2.1.306 reported available with subscription auth. A synthetic source project and disposable duplicate were created; the duplicate generated four SEO titles. CLI duration was 41,562 ms (41,801 ms wall time), with a 12,150-byte prompt. `generatedBy` returned `{ provider: 'claude', model: 'claude-opus-4-5', backend: 'cli' }`. The temporary project records were deleted.
- Audit folder from the live run: `data/files/01M5GR218GQ13KHVT91WT8NGY1/cli-runs/01M5GR21CE38NB5W2DGJPANH7W`.

## Files and follow-up

The commit changes 34 files:

- `AGENTS.md`; `src/contracts/seo.ts` and its tests.
- SEO client page, toolbar, API, generation-mode helper/tests, and six section panels under `src/client/features/seo/`.
- SEO routes, service, public exports, docs, service/route tests, and the project storage compatibility test.
- Shared CLI chat wrapper, tolerant JSON helper, tests, and module docs under `src/server/shared/claude-cli/`.
- Script formatter/parser reuse, parser tests, and module docs; worker SEO wiring and worker tests; server router configuration.

The short implementation plan and this report are untracked as requested.

The existing script and popup services still have their earlier local CLI failure-mapping code. Refactoring both onto the new shared chat wrapper is the named follow-up; the SEO path itself uses the shared mapping, and no third domain-local copy was added.

No browser layout acceptance was run. The React Query status key/API, toolbar availability helper, and generation request shape are covered by the focused client tests.
