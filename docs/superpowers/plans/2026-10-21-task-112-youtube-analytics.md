# Task 112 implementation plan

Date: 2026-10-21
Design: docs/superpowers/specs/2026-10-21-task-112-youtube-analytics-design.md
Branch: main; no push.

1. **112a — secure connection and sync**
   - Add config/contracts and regression tests first.
   - Implement encrypted credentials, OAuth PKCE/state/callback, channel choice/binding/disconnect, quota accounting, REST uploads/video sync, partial sync reporting, and existing-queue worker integration.
   - Register routes/indexes and update AGENTS.md Status. Verify focused tests, typecheck, lint; stage only explicit 112a files and commit.
2. **112b — analytics, linking, and AI review**
   - Add deterministic analytics and AI/schema tests first.
   - Implement daily/per-video analytics, retention caching, link/unlink and suggestions through project/SEO public APIs, monetization reference constants, and opt-in review through existing AI plumbing.
   - Update Status. Verify focused tests, typecheck, lint; stage explicit 112b files and commit.
3. **112c — client, setup, and report**
   - Add client API/helper tests first.
   - Implement channel setup/connect controls, analytics route/page/chart/video detail/link states, responsive layout, and Vietnamese setup guidance; document verified APIs and limitations in MODULE.md.
   - Add final Task 112 report; leave design/plan/report untracked. Run required focused suite, typecheck, lint, build, and fake-data/manual UI checks where tools permit. Update Status, stage only explicit 112c code/docs excluding untracked plans/tasks, and commit.
4. Report each commit with the actual verification output. Do not push. If live credentials are absent, record live OAuth/sync as unverified and provide Hung's manual acceptance steps.
