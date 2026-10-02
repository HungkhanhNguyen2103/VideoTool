# Task 52 - AI calls must time out and report errors (DeepSeek hang)

## Symptom (Hung, real run)
Create project -> "Tao kich ban". Progress stays at 0%. Job log shows only:
`Loading project and AI client...` / `Sending outline request to AI...` (twice), no error ever.
Worker and API start fine. DEEPSEEK_API_KEY is set in .env.

## Root cause (code reading)
`src/server/shared/ai/deepseek.ts` builds `new OpenAI({apiKey, baseURL})` with SDK defaults: timeout 10 min, maxRetries 2.
If api.deepseek.com is unreachable/hanging from Hung's machine (network, VPN, firewall, DNS), `client.chat.completions.create`
waits up to ~30 min without throwing, so `generateScript` never reaches its failure path and the UI shows nothing.
The duplicate log lines mean the job restarted (stale recovery after 5 min, `recoverStaleJobs`) or was enqueued twice.

## Do
1. `deepseek.ts` (and `claude.ts` the same way): set `timeout` (env `AI_REQUEST_TIMEOUT_MS`, default 120000) and `maxRetries: 1`
   on the client. Add the env var to `config.ts` + `.env.example`.
2. Wrap `chat()`/`stream()` so errors become `AppError` with a readable message that includes the HTTP status when present:
   401 -> "DeepSeek API key invalid", 402 -> "DeepSeek balance insufficient", 429 -> "rate limited",
   timeout/ECONN/ENOTFOUND -> "Cannot reach api.deepseek.com (timeout/network)". Never include the key.
3. Log the failure with `logger.error` in the worker console (provider, status, message) - today nothing is printed.
4. In `generateScript`, append a job log line before throwing: `AI request failed: <message>` so the UI shows it.
5. Check why the job started twice: does the client call `POST /:id/generate-script` twice (double click / StrictMode effect)?
   If yes, guard it (disable button while a job for that project is queued/running, or reuse the existing active job).
6. Tests: mock a client that never resolves -> job fails within timeout with the readable message; 401/402 mapping; no key in messages.

## Do NOT
Change prompts, job retry policy, or any other module. No new dependencies.

## Report back
Commit hash, test outputs, typecheck/lint EXIT codes, and a manual run with the network blocked showing the new error in the UI.
