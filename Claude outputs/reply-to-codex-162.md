# Task 64 — Final QA: manual JSON mode + fail fast when an AI key is missing

Do this AFTER Task 63 (`reply-to-codex-161.md`, header tidy), because the QA mode control must reuse the same segmented-control styling. Two commits (Part A, Part B).

## Context (verified in code)
- Final QA is automatic only: `POST /:id/qa` enqueues a `final-qa` job, `runFinalQa` (`src/server/modules/script/qa.ts`) calls `getAiClient(project.aiProvider).chat(...)`. There is no manual path (copy prompt → paste JSON), unlike first-run script generation and (since Task 61) chapter regeneration.
- The owner has no `ANTHROPIC_API_KEY` yet. `createClaudeClient` (`src/server/shared/ai/claude.ts`) falls back to the placeholder key `missing-anthropic-key` and still performs the HTTP call, so with the project AI set to Claude the QA panel sits at "Đang kiểm tra QA… 0%" while the request/retry runs. DeepSeek has the same pattern (`missing-deepseek-key`).
- QA results are held in client state (`qaResult` in `ReviewScriptPage.tsx`), not persisted by the server; keep that.

## Part A — fail fast when the selected provider has no key (server)
1. In `claude.ts` and `deepseek.ts`: when the API key env var is empty, `chat` and `stream` must throw immediately, without any network call, an `AppError` (status 400, code `AI_KEY_MISSING`) with a Vietnamese message that names the variable: `Chưa cấu hình ANTHROPIC_API_KEY trong .env. Hãy đổi sang nhà cung cấp khác hoặc dùng chế độ thủ công.` (and `DEEPSEEK_API_KEY` for DeepSeek). Keep the existing logger warning. Do not read or print the key value anywhere.
2. Existing job error plumbing already shows `qaProgress.error` / `progress.error` as a toast; confirm the new message reaches the toast for QA, script generation, and chapter regeneration (automatic). Add tests with the key unset (use the existing test pattern for env; restore env after).
3. Do not touch `.env`. Tests must not require real keys.

Commit: `fix(ai): fail fast when provider API key is missing`.

## Part B — QA manual JSON mode
### B1. Server
1. `GET /:id/qa/manual-prompt` → `{ prompt: "SYSTEM\n…\n\nUSER\n…", promptVersion }` built with `buildQaPrompt(project)` (same format as the existing manual prompts). No AI call, no job.
2. `POST /:id/qa/manual-import` body `{ raw: string }` (same `ManualImportSchema` as the others) → `parseQaResult(raw)` (strict schema, accepts a fenced ```json block like the other parsers). Additional validation: every `issue.chapter` must be between 1 and the project's chapter count, else 422 with a Vietnamese message naming the offending chapter number. Response: the parsed result plus `reviewedBy: { provider: 'manual', model: 'Dán thủ công' }`. If the pasted JSON already contains `reviewedBy`, ignore it and overwrite with the manual marker.
3. Schema: extend `reviewedBy.provider` to `z.enum([...AI_PROVIDERS, 'manual'])` in BOTH `src/server/modules/script/ai/qa-schema.ts` and the client copy in `src/client/features/script/api.ts`. Do NOT add `'manual'` to `AI_PROVIDERS` itself (it is the project AI provider list).
4. Invalid JSON → the same 422 `SCRIPT_PARSE_ERROR` style used elsewhere; nothing is stored.

### B2. Client (`ReviewScriptPage.tsx`, `api.ts`)
1. QA panel: under the title add the same segmented control used in Task 63, options `Tự động` / `Thủ công (JSON)`, `qaMode` state default `automatic`, disabled while a QA job runs. Muted line: automatic → `Tự động bằng <DeepSeek|Claude>` (replaces today's `Sẽ kiểm tra bằng: …` only while no result exists; keep the stale-provider logic from Task 61 Part C); manual → `Thủ công: lấy prompt, dán vào AI bất kỳ, rồi dán JSON kết quả vào`.
2. Automatic mode: today's `Chạy kiểm tra QA` button, unchanged.
3. Manual mode: replace the run button with `Lấy prompt QA` (calls `manual-prompt`), then show prompt version, a `Sao chép` button, a textarea (placeholder `{"issues":[{"chapter":1,"type":"REPETITION","severity":"low","reason":"…","suggestedAction":"REMOVE_DUPLICATION"}]}`; allowed enum values listed in a small muted line from the existing `QA_ISSUE_TYPES`, `QA_SEVERITIES`, `QA_SUGGESTED_ACTIONS` constants, not hard-coded text), and `Nhập kết quả QA` (calls `manual-import`). On success set `qaResult` (the existing issue list renders as today, including the `Áp dụng` buttons); on error show the server message under the textarea and keep the pasted text.
4. `qaReviewerDisplay`: for `reviewedBy.provider === 'manual'` show `Đã kiểm tra: thủ công (dán JSON)` and no same-provider hint. Update its tests.
5. Vietnamese text with diacritics, existing tokens only.

### B3. Tests
- Server: manual-prompt equals `buildQaPrompt` output formatting and starts no job; manual-import valid → result with `reviewedBy.provider = 'manual'`; fenced JSON accepted; out-of-range chapter → 422; broken JSON → 422; extra unknown keys rejected by the strict schema; pasted `reviewedBy` is overwritten.
- Client: mode toggle, manual flow success/failure, `qaReviewerDisplay` for manual, automatic flow unchanged.

Commit: `feat(script): manual JSON mode for final QA`.

## Out of scope
Persisting QA results, choosing a separate QA provider, changing QA prompt content or issue types.

## Verification
Typecheck, lint, full tests pass. Manually: (1) with `ANTHROPIC_API_KEY` unset and the project AI set to Claude, click automatic QA and report how long until the error toast and its exact text; (2) in manual mode fetch the prompt, import a valid JSON and a deliberately broken one, report both outcomes. Report hashes, files changed, tests added. No `.env` changes, no deletions, no secrets in the report.
