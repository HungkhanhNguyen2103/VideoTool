# Task 121c Idea Yield Implementation Plan

> **For agentic workers:** Use the project skills and complete each test-first task below directly on the authorized `main` checkout.

**Goal:** Raise validated idea yield without relaxing quality checks, support honest partial runs, and make eval diagnostics survive failures.

**Architecture:** Keep deterministic grounding and editorial checks in the YouTube idea quality module. Extend the staged engine and run contract for bounded multi-batch expansion, budget-aware mechanical repairs, running diversity, previous-seed exclusion, and partial persistence; expose the status in the existing panel and eval tooling.

**Tech Stack:** TypeScript, Zod, Vitest, React/CSS Modules, MongoDB repository, existing Claude CLI worker.

**Spec:** `docs/superpowers/specs/2026-10-22-task-121c-idea-yield.md`

## Global Constraints

- Expand revision is `video-ideas-v2-expand` revision 2; do not weaken quality thresholds.
- Selection cap is `min(12, ceil(count * 2))`; maximum three expansion batches; soft budget defaults to 240 seconds.
- Repairs require at least two mechanically repairable rows, at most one per batch, and none after budget.
- One or more survivors persist with `status: 'partial'`; zero survivors fail with top drop reasons.
- No provider call before the four-run corrected offline replay completes.
- No push; never stage plans, reports, Claude outputs, or `data/files/.verification`.

## Review Focus

1. Decision detection accepts proven action events but rejects clock-industry trend and Nguyễn belief-only examples.
2. Sentence-initial common words are ignored while unsupported proper names such as Đại Việt still fail coverage.
3. Short acronyms and actor parent/child naming satisfy motif links without repairing the Bắc Dương hunter-subject gap.
4. Period refinement and year/century matching require packet or claim evidence and cannot suppress unrelated unsupported numbers.
5. One-survivor and zero-survivor paths retain exact statuses, reasons, and audit output, including elapsed and repair statistics.

---

### Task 1: Fix demonstrated validator false positives

**Files:** Modify `src/server/modules/youtube/idea-quality.ts`; test `src/server/modules/youtube/idea-quality.test.ts`.

- [ ] Add failing regression tests for decision-action families and both required true-drop controls; claims capitalization in both directions; VOC and Hải quân Nga/Đế quốc Nga motif links plus the Bắc Dương failure; evidence-backed period refinement and year/century matching with unsupported-number controls.
- [ ] Run the focused Vitest file and confirm each new regression fails for the expected reason.
- [ ] Implement narrow, normalized matching rules with the proven examples as bounds; keep all existing quality and evidence thresholds.
- [ ] Re-run the focused file and the existing idea-quality tests.

### Task 2: Make replay v2-correct and establish the offline delta

**Files:** Modify ignored `data/files/.verification/task-121c/replay-captured.ts`; save output and report evidence under ignored `data/files/.verification/task-121c/`.

- [ ] Add a metric test for counting a repair rescue from actual v2 accepted IDs without applying the legacy v1 eight-fact cap.
- [ ] Run the old helper against a v2 repair fixture with nine claims and confirm it currently miscounts the rescue.
- [ ] Use v2 validation and the captured repair IDs to report true rescued survivors; rerun all four captured runs offline and summarize seed pass-through and survivor deltas.
- [ ] Confirm the replay makes no Claude, network, or database calls before moving to live acceptance.

### Task 3: Expand until filled under bounded budget and repairs

**Files:** Modify `src/server/modules/youtube/idea-engine.ts`, `idea-packet.ts`, related tests, and `src/server/modules/youtube/idea-prompts.ts` / tests.

- [ ] Add failing fake-runner tests for shortlist cap, batch-two fill after one survivor in batch one, three-batch maximum, budget stop, repair threshold and judgment exclusions, running diversity hints, and rerun seed exclusion.
- [ ] Run the focused engine/packet/prompt tests and verify expected failures.
- [ ] Implement the 240-second injectable/clock-tested budget, max-three batches, 3–4 row batches, running survivor caps and gap hints, previous-run seed packet entries, mechanical-repair eligibility, and revision-2 prompt checklist/example.
- [ ] Re-run focused tests and inspect generated prompts for untrusted-data labeling and stable prompt version.

### Task 4: Persist and present partial runs

**Files:** Modify `src/contracts/youtube-ideas.ts` and contract tests; `idea-service.ts` / tests; `src/client/features/youtube/components/VideoIdeasPanel.tsx`, its view helper/tests, and CSS module.

- [ ] Add failing tests for legacy status omission, partial runs with one and two survivors, zero survivors with leading reasons, and Vietnamese banner/reason mapping with retry action reuse.
- [ ] Run touched contract, service, and view tests and verify expected failures.
- [ ] Implement optional legacy-safe `status`, transactional persistence of one-or-more results, zero-result error text, and responsive partial banner with dropped reasons and existing generate action.
- [ ] Re-run touched suites and check the three requested viewport widths using an available browser surface; record any unavailable capture.

### Task 5: Make eval diagnostics unconditional and verify acceptance

**Files:** Modify `src/server/modules/youtube/idea-eval.ts`, `scripts/eval-video-ideas.ts`, their tests, `src/server/modules/youtube/MODULE.md`, and `AGENTS.md`; create `docs/superpowers/tasks/task-121c-report.md`.

- [ ] Add failing pure-metric tests for per-stage counts, per-batch time, rescue counts, budget stop, and zero/failing-run drop counts.
- [ ] Run the focused metric tests and confirm failures.
- [ ] Implement unconditional reporting and the report/doc status updates; run the corrected four-run offline replay before any CLI acceptance call.
- [ ] Run four Sonnet 5.5 medium calls, at most two prompt iterations, all requested test suites, typecheck, lint, build, and viewport checks. Record argv, timing, titles/sketches, repair rescues, targets, limitations, `git log -6`, and status.
- [ ] Review staged paths and LF diffs; make only the two scoped commits specified by the task, leaving all reports/plans/prompts/verification artifacts unstaged; do not push.
