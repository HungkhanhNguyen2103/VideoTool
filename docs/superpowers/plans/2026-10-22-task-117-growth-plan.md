# Task 117 — Channel growth plan implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` and complete the three commits below in order.

**Goal:** Add a deterministic, no-AI channel growth plan with immutable first-28-day snapshots, manual reach inputs, forecasts, milestones, verdicts, and Vietnamese UI.

**Architecture:** Extend the existing YouTube video documents and Analytics sync, preserving user-owned fields across sync. Put the growth calculations in a pure module with strict contracts; routes compose that engine from stored repository data. The client consumes plan-status and video APIs, and keeps settings, explanations, and inputs in the existing YouTube feature.

**Tech Stack:** TypeScript, Zod, MongoDB, Express, React, TanStack Query, Vitest, CSS Modules.

**Spec:** `C:\Users\Admin\.codex\attachments\2fb0de0e-acbd-4e08-bc13-ca26ba7df194\Pasted text.txt`.

## Constraints

- Work on `main`; no worktree, feature branch, or push. Create the three requested commit messages in order.
- All numeric defaults and heuristic thresholds live in named exported constants; mark unverified suggestions as such.
- Keep snapshots immutable, exclude private/unlisted/removed/Shorts from plan videos, and never derive or expose credentials.
- Analytics reads use stored data; no AI or Reporting API calls. English code/comments; Vietnamese UI; LF in commits.
- Every behavioral commit updates the Task 117 `AGENTS.md` Status line and module documentation.

## Review focus

- Sync must preserve `first28d`, `manualReach`, and `excludedFromPlan` on existing videos.
- A null or unavailable metric must remain unknown; only 28–45-day lifetime fallback is approximate.
- Niche date unset must not pull earlier videos into the plan or enable date checkpoints.
- Forecasts must be deterministic, bounded, scenario-ordered, and disclose assumptions.
- Demo preview must prove the effective database name is isolated before any seed/write.

## Shared interfaces

- Commit 1 produces video snapshot/manual reach/exclusion fields, immutable repository writes, traffic-source storage, and sync report groups. Commit 2 consumes those records to compose plan status; commit 3 consumes the public schemas and routes in the client.
- Commit 2 produces plan/status/experiment contracts and route responses; commit 3 consumes these for settings, verdicts, milestones, and overview badges.

## Task 1 — Commit 1: snapshots, traffic mix, and manual inputs

- Add strict video snapshot/manual reach/exclusion and traffic-source contracts; test defaults and rejection of malformed values.
- Write repository tests proving provider upserts preserve user-entered data and captured snapshots.
- Add bounded per-video first-28-day capture for public videos aged 31+ days, immutable conditional writes, per-video status in sync reports, and traffic-source storage with 400/403 availability handling.
- Add manual-reach and plan-exclusion PUT/DELETE routes with stable Vietnamese errors; test valid, invalid, missing-profile/video, and no-credential response cases.
- Update module docs and `AGENTS.md`; run focused YouTube/contracts tests, typecheck, lint, build; commit `feat(youtube): first-28-day snapshots and manual reach inputs`.

## Task 2 — Commit 2: config, deterministic engine, and plan-status API

- Add strict plan/default/experiment/status contracts and repository/index support; test default reads, replacement validation, experiment bounds, and profile conflicts.
- TDD pure engine functions for eligibility/maturity, distributions, Wilson/rule-of-three hit rates, required views, bounded three-scenario forecast, stages, checkpoints, metric registry, confidence, and every verdict branch.
- Compose `GET/PUT plan`, experiment POST/DELETE, and stored-data-only `GET plan-status`; extend channel overview rows with compact stage/verdict. Test no-date, 2/5/12/20/45-video fixtures and privacy/exclusion boundaries.
- Update module docs and `AGENTS.md`; run all touched tests, typecheck, lint, build; commit `feat(youtube): growth plan, forecast and verdict engine`.

## Task 3 — Commit 3: growth-plan UI

- Add plan-status/config/experiment/manual-input/exclusion API helpers, query keys, invalidations, and contract validation tests.
- Add tested Vietnamese formatting/labels/progress/checkpoint helpers; add the settings, stage ladder, threshold progress, view milestones, verdict, assumptions, checkpoint timeline, and experiment log to per-channel analytics.
- Add video drawer snapshot/manual reach/exclusion controls and stage/verdict badges to overview cards; test insufficient-data, loading/error/empty, validation, and save flows.
- Update client/module docs and `AGENTS.md`; run requested YouTube/client/contracts tests, typecheck, lint, build, and safe isolated preview checks; commit `feat(youtube): growth plan panel and verdict UI`.

## Verification

- For each new behavior, write a failing test, run it to confirm the intended failure, implement, then run it green.
- Final gates: `npm run typecheck`, `npm run lint`, focused Vitest paths from Task 117, and `npm run build`; report full-suite failures without hiding them.
- Before starting a preview, verify the API's effective Mongo database name and proceed only with the isolated demo database. No screenshots or UI claims without a real capture.

## Self-review

- Scope coverage: sync snapshots/traffic, manual reach, exclusion, plan persistence, engine math and decisions, plan-status, channel overview badges, analytics panel, video drawer, seed data, docs, Status, and verification each have an owning commit above.
- Interfaces flow forward: commit 1 exports the expanded video contract/repository operations; commit 2 consumes them and exports plan-status; commit 3 consumes those contracts/routes.
- Failure cases are covered in Review focus and named tests above. No independent subsystem needs a separate plan because the three commits share the same video and plan contracts.
