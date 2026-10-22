# Task 121 — Trap-First Video Ideas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Replace the two-call idea generator with a measured, three-stage episode pipeline that enforces a checkable trap, diversity and claim safeguards, then shows those quality signals in the channel UI.

**Architecture:** Keep the existing channel-scoped job and persistence flow. Introduce v2 idea and run schemas while retaining v1 parsing, then route generation through seed, select and batched expand stages with deterministic validation, normalizing and trimming. Add pure eval metrics and an isolated-database CLI harness; keep UI formatting and research-request construction in pure helpers.

**Tech Stack:** TypeScript, Zod, Vitest, MongoDB, existing Claude CLI runner, React and CSS Modules.

**Spec:** User-provided Task 121 in `Claude outputs/codex-prompt-task121-idea-quality-upgrade.md`.

## Global Constraints

- Work directly on `main`; never push.
- Keep v1 idea documents readable and write `promptVersion: video-ideas-v2` for new runs.
- Use Claude Sonnet 5.5 as this job's default only; do not change the global model default.
- The eval harness must refuse non-local or non-`youtube_demo_` databases.
- Historical fields remain hypotheses; do not assert them as verified facts.
- Keep user-facing text Vietnamese, code and prompts English, CSS Modules/tokens, and LF in commits.
- Do not stage temporary files, reports, plans, or verification artifacts named by Task 121.

## Review Focus

- v1 records continue to parse and render; test the union mapper and repository reads.
- One repair maximum applies across all expansion batches; test a malformed batch after an earlier valid batch.
- Obscure steering and known fallback behave consistently after semantic drops; test obscure, known and famous combinations.
- Claim matching handles Vietnamese named entities and packet overlap conservatively; test unbacked numeric/name details and packet-supported claims.
- Eval database guard runs before any connection or write; test configured DB and remote host refusal.

### Task 1: Contracts and staged server pipeline

**Files:** `src/contracts/youtube-ideas.ts`, `src/contracts/youtube-ideas.test.ts`, `src/server/modules/youtube/idea-quality.ts`, `idea-quality.test.ts`, `idea-engine.ts`, `idea-engine.test.ts`, `idea-prompts.ts`, `idea-prompts.test.ts`, `idea-service.ts`, `docs.ts`, `idea-repo.test.ts`, `index.ts`, `MODULE.md`, `AGENTS.md`.

- [ ] Add v2 idea/trap/claim/episode fields, v1-compatible stored unions and per-stage durations.
- [ ] Test v2 trap, episode, diversity, obscurity, claims, old-record parsing, and deterministic normalization.
- [ ] Implement seed → select → expand, with selection filtering, expansion batches of four, one repair per stage and deterministic final ranking.
- [ ] Test fake CLI stage ordering, repair bounds, batch size, drop reasons, cancellation, and survivor floor.
- [ ] Update Task 121 server status and YouTube module documentation.
- [ ] Run focused server/contracts tests, typecheck, lint and build; commit the server and contract changes.

### Task 2: Quality cards and offline evaluation

**Files:** `src/client/features/youtube/idea-view.ts`, `idea-view.test.ts`, `components/VideoIdeasPanel.tsx`, `.module.css`, `VideoIdeasPanel.test.ts`, `src/server/modules/youtube/idea-eval.ts`, `idea-eval.test.ts`, `scripts/eval-video-ideas.ts`, `MODULE.md`, `AGENTS.md`, untracked task report.

- [ ] Test pure labels, trap/claim formatting, reason mapping, research request ordering and model default.
- [ ] Render v1 and v2 cards with trap sketch, chips, collapsible trap and confidence-marked claims; show stage times and drop reasons.
- [ ] Add localhost + isolated DB guarded real-pipeline eval and pure metric tests.
- [ ] Run required tests/typecheck/lint/build, then run at least two real evals per steering on the isolated demo DB and record honest results.
- [ ] Write the untracked Task 121 report, update status, review staged paths and commit the client/eval changes.

## Execution Notes

- Task 120's first 10 draft rows pass the strict draft shape. Each has all four motif evidence ratings `thin`, so each fails the hubris-trap semantic floor and triggers the 155-second repair; no malformed field was found in those rows.
- Keep the browser viewport acceptance marked unverified because computer use is unavailable for this task.
- Do not push.
