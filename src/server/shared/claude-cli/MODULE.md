# Shared Claude CLI runner

This boundary owns the process runner shared by server modules that invoke Claude Code CLI. It resolves the executable, runs with bounded output and cancellation, writes per-run prompt/output/metadata audit files, and retains the newest completed runs.

It is infrastructure only: it does not know script or video domain contracts and must not import `src/server/modules/`. Domain modules inject their prompt and interpret the returned text.

Tests use `fixtures/fake-claude-cli.mjs`; no real API key or paid request is required.
