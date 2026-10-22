# Shared Claude CLI runner

This boundary owns the process runner shared by server modules that invoke Claude Code CLI. It resolves the executable, runs with bounded output and cancellation, writes per-run prompt/output/metadata audit files, and retains the newest completed runs.

## Product defaults

`src/contracts/claude-cli.ts` owns the shared CLI-only defaults: `CLAUDE_CLI_DEFAULT_MODEL` is `claude-sonnet-5-5`, and `CLAUDE_CLI_DEFAULT_EFFORT` is `medium`. They are product defaults requested by Hung, not Anthropic recommendations. Every runner invocation passes both `--model <id>` and `--effort <level>`; callers may override the model, and internal callers may override effort without a new UI setting. The separate Claude API default in `AI_MODEL_REGISTRY.claude.defaultModelId` remains unchanged.

On this machine, `claude --version` reported Claude Code 2.1.306. Its installed `--help` documents `--model <model>` (alias or full model name), `--effort <level>`, and the effort values `low`, `medium`, `high`, `xhigh`, and `max`. A real smoke request for `claude-haiku-5-5` at medium effort could not reach the API (`ENOTFOUND`), so exact model-ID acceptance has not been confirmed by a completed request in this environment. Do not treat the failed smoke as model-acceptance evidence.

`cli-chat.ts` provides the shared chat formatter and cancellable chat adapter. It checks status, polls job cancellation to abort the process, maps timeout/output-cap/rate-limit/auth/unavailable failures to `AppError`, and logs prompt bytes, duration, and the audit path without logging prompt or response content. Callers supply domain prompt messages and a project/job context.

`json-output.ts` contains the tolerant JSON extractor shared by automatic script and SEO CLI parsing. It accepts a complete JSON response and supports a leading-text notice callback for automatic CLI responses. Callers that omit the callback retain strict whole-response parsing; manual imports continue to use their own strict parsers.

It is infrastructure only: it does not know script or video domain contracts and must not import `src/server/modules/`. Domain modules inject their prompt and interpret the returned text.

Tests use `fixtures/fake-claude-cli.mjs`; no real API key or paid request is required.
