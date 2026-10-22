# Task 120 — Channel video ideas implementation plan

> **For agentic workers:** Implement inline on `main`, directly from this plan and the user-provided Task 120 specification. Do not create a branch or worktree. Keep each behavior commit's `AGENTS.md` Status line in that commit.

**Goal:** Generate channel-specific next-video ideas with honest evidence tiers, strict validation, persistent status, and a safe project/research hand-off.

**Architecture:** Keep packet construction, tier classification, prompts, and validation as pure YouTube-module helpers. Persist idea rows and run summaries in dedicated collections; execute generation as a cancellable channel-scoped job with two sequential Claude/API calls. Add the panel to channel analytics and pass project prefill through `/production/init` route state without importing idea facts as references.

**Tech Stack:** TypeScript, Zod, MongoDB, Express, React Query, React Hook Form, Vitest, existing job and Claude CLI infrastructure.

**Spec:** User attachment `Task 120 — "Ý tưởng video tiếp theo" for a channel (Claude CLI, honest about evidence level, hands off to project creation)`.

## Global constraints

- Work directly on `main`; do not push.
- Do not stage `.env*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`, `docs/superpowers/plans/*`, or stray root `01M4W…` files.
- Keep committed lines LF; use public module `index.ts` APIs across modules, CSS Modules and existing design tokens.
- Historical claims from the tool-less Claude CLI are unverified; no search demand, view prediction, or revenue prediction may be stated as fact.
- Add the Task 120 Status line to `AGENTS.md` in each behavior-changing commit.

## Review focus

1. Video/project titles and steering containing instruction-like text remain data in the packet; test with `ignore previous instructions`.
2. Tier boundaries count only mature plan videos with measured first-28-day data; test 0, 2, 3, 9, 10, and 15.
3. Data-informed ideas cite Task 117 metric registry IDs and preserve `consider_stop` without blocking generation.
4. Project hand-off carries the selected channel and leaves references empty; creation marks the idea used only after success.
5. Cancellation, low survivor count, CLI unavailable, and duplicate active jobs never save partial or credential-bearing idea data.

## Tasks

### 1. Evidence packet, contracts, persistence, and routes

**Files:** `src/contracts/youtube-ideas.ts`; `src/server/modules/youtube/{idea-packet.ts,idea-packet.test.ts,idea-service.ts,idea-repo.ts,docs.ts,indexes.ts,routes.ts,index.ts}`; `src/server/modules/project/index.ts` only if coverage needs a public project summary API; `src/server/modules/youtube/MODULE.md`; `AGENTS.md`.

- [ ] Add strict idea, generation, mutation, run-summary, tier and response contracts; test bounds, status shapes and token rejection.
- [ ] Add `classifyIdeaEvidence`, coverage/saved-idea packet construction, steering sanitization and fingerprint/staleness helpers; test tier boundaries, legacy/older-niche coverage, injection text and packet secrecy.
- [ ] Add `youtubeVideoIdeas` and `youtubeIdeaRuns` schemas, indexes, repository operations, 200-row retention preserving chosen/used rows, and channel-scoped list/status mutations; test Mongo persistence and cap behavior.
- [ ] Add strict routes for read, generate enqueue, patch, delete and project hand-off preparation; test CLI/model/body validation, active-job 409, and token-free serialized responses.
- [ ] Update YouTube module docs and `AGENTS.md`; commit as `feat(youtube): video idea packet, storage and routes`.

### 2. Two-call generation job and grounding validation

**Files:** `src/server/modules/youtube/{idea-prompts.ts,idea-prompts.test.ts,idea-validation.ts,idea-validation.test.ts,idea-engine.ts,idea-engine.test.ts,idea-service.ts}`; `src/worker/registry.ts`; `src/server/modules/youtube/MODULE.md`; `AGENTS.md`.

- [ ] Write prompt/version tests, then add English generate and critique prompts with all evidence, motif, anti-hallucination, no-demand, no-prediction, single-variable, language, and JSON rules.
- [ ] Write validator tests for title duplicates/diacritics, promise and rarity claims, packet-number grounding, one test variable, hubris motif completeness/strength, retry/drop reasons and ungrounded threshold; implement one bounded repair call.
- [ ] Implement generate `count + 4` then critique/select `count`, merge by candidate id, record dropped reasons, persist only complete validated ideas and summary, preserve cancellation; exercise call order, repair and no partial writes with a fake CLI runner/temp Mongo.
- [ ] Register `video-ideas` worker using shared CLI chat, availability checks, model validation, progress/log/cancel and 30s heartbeat; commit as `feat(youtube): Claude CLI video idea job with validation`.

### 3. Ideas UI and project/research hand-off

**Files:** `src/client/features/youtube/{api.ts,hooks.ts,idea-view.ts,idea-view.test.ts,components/VideoIdeasPanel.tsx,components/VideoIdeasPanel.module.css,YoutubeAnalyticsPage.tsx,YoutubeAnalyticsPage.module.css}`; `src/client/features/project/{ProjectInitPage.tsx,components/NewProjectForm.tsx,components/NewProjectForm.module.css,project-prefill.ts,project-prefill.test.ts}`; corresponding tests, module docs and `AGENTS.md`.

- [ ] Add tested pure helpers for tier/gate copy, steering, transitions, staleness, duplicate normalization, research request, and prefill mapping.
- [ ] Add API/hooks and the responsive Vietnamese panel after growth plan and review; cover controls, progress/cancel/rejoin, tier honesty, cards, dropped disclosure, status, manual demand, unavailable/error/empty/stale states.
- [ ] Add a route-state prefill entry point to the existing project form; keep references empty with the research notice, carry channel/preset/duration/chapter values, and mark used/link only after project creation succeeds.
- [ ] Update module docs and `AGENTS.md`; run requested test groups, typecheck, lint and build; write the untracked report; commit as `feat(youtube): video ideas panel and project hand-off`.

## Verification

- Run the exact Task 120 verification groups in the user specification, plus focused new suites as each task lands.
- Before demo seed/preview, assert the configured database name and use only a localhost database named `youtube_demo_*`.
- If Claude CLI is authenticated, run the specified two-video synthetic channel flow and report raw logs, durations, audit paths, ideas, dropped items and hallucination review. Do not use real channel data.
- Report viewport checks at 1920×1080, 1366×768 and 900px only if actually captured; otherwise mark them unverified.
