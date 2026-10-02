# Task 60 — Show which AI model ran the final QA

Problem: the "Kiểm tra cuối (QA)" panel (`src/client/features/script/ReviewScriptPage.tsx` ~line 416) never says which model produced the issues. `runFinalQa` (`src/server/modules/script/qa.ts`) uses `getAiClient(project.aiProvider)`, so QA runs on the same model that wrote the script (`deepseek-chat` or `claude-opus-4-5`, hard-coded in `src/server/shared/ai/deepseek.ts` / `claude.ts`). The user cannot see this and may over-trust a self-review.

## Server
1. Expose the model name per client without changing behavior: add `readonly model: string` to the `AiClient` interface (`src/server/shared/ai/types.ts`), set it from each client's existing `MODEL` constant. Update any test doubles/mocks of `AiClient`.
2. `src/server/modules/script/ai/qa-schema.ts`: `QAResultSchema` is `.strict()`; add an OPTIONAL field
   `reviewedBy: z.object({ provider: z.enum(AI_PROVIDERS), model: z.string().min(1) }).strict().optional()`.
   Optional so QA results already stored on old jobs still parse. Update the client copy of the schema if it is duplicated (`api.QAResultSchema` in `src/client/features/script/api.ts`).
3. `qa.ts`: after the chat call, return `{ ...result, reviewedBy: { provider: project.aiProvider, model: client.model } }`. Add to the final log line: `Final QA finished by <provider>/<model>: N issues found.`
4. Cancelled paths keep returning `{ issues: [] }` unchanged.

## Client
In the QA panel, under the "Chạy kiểm tra QA" button:
- Before any run: muted line `Sẽ kiểm tra bằng: <provider label>` using the project's `aiProvider` (labels: DeepSeek, Claude). Do not hard-code model names on the client; model name only comes from the result.
- After a run: line `Đã kiểm tra bằng: <provider label> · <model>` taken from `qaResult.reviewedBy`. If `reviewedBy` is missing (old result), show `Model: không có thông tin`.
- If `reviewedBy.provider` equals the project's `aiProvider` (always true today), add a muted hint: `Cùng nhà cung cấp với bước viết kịch bản; kết quả có thể bỏ sót các lỗi tương tự. Hãy đối chiếu số liệu với tài liệu tham khảo.` Keep it one line, no warning color.
- Vietnamese UI text with proper diacritics. Reuse existing muted styles/tokens.

## Out of scope
Choosing a different QA provider/model (separate future task), changing prompts, translating the QA reason text (it currently comes back in English), schema changes beyond the optional field.

## Tests
- `qa.test.ts`: result contains `reviewedBy` with the mocked client's provider and model; cancelled path unchanged.
- Schema test: result with and without `reviewedBy` both parse; unknown extra key still rejected.
- Client test: panel shows "Sẽ kiểm tra bằng" before run, "Đã kiểm tra bằng … · model" after, and the fallback text for an old result without `reviewedBy`.

## Verification
Typecheck, lint, full tests pass. Run QA on the Bạch Đằng project (or any project with chapters) and report the exact line shown. One commit: `feat(script): show QA reviewer model`. Report hash, files changed, tests added. No `.env` changes, no deletions, no secrets in the report.
