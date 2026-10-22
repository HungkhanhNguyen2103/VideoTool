# Task 110 Publishing Schedule and Upload Workflow Implementation Plan

> **For agentic workers:** Execute inline in this session using test-first steps. The task owner requires one final commit on `main`; do not push or merge.

**Goal:** Add legacy-safe channel publishing schedules, timezone-aware slot suggestions, duplicate-title guidance, and an upload checklist without claiming unverified YouTube best practices.

**Architecture:** Keep schedule validation and time calculations in shared contracts. The project module supplies only chosen titles for other projects on a channel; SEO consumes that public API through one route. Channel editing and publish guidance remain client features, while checklist and Markdown output remain pure contract helpers.

**Tech Stack:** TypeScript, Zod, MongoDB, Express, React, TanStack Query, `Intl.DateTimeFormat`, Vitest.

**Spec:** `docs/superpowers/tasks/task-110-planner-task.md`; `Claude outputs/codex-prompt-task108-111-channel-seo.md`, Task 110 section.

## Global Constraints

- `publishSchedule` input is strict; persisted/read values use `.nullable().catch(null).default(null)` so missing or malformed legacy values read as `null`.
- Schedule timezone is an IANA zone; slots have weekday 0–6, strict 24-hour `HH:mm`, kind `long|short`, and a maximum of 14; notes are at most 500 characters; identical weekday/time/kind slots are rejected.
- `nextPublishSlots` returns strictly future instants, caps count at 10, searches at most 8 weeks, skips nonexistent DST wall times, and chooses the first occurrence of ambiguous wall times.
- Starter schedule, posting hours, and 2–4 hour processing lead time are labeled `gợi ý, chưa kiểm chứng`; no schedule value is enforced.
- SEO accesses project titles only through `project/index.ts`; project does not import SEO or channel.
- Keep current file line endings; use no new date dependency; stage explicit Task 110 paths only; leave unrelated work untouched; commit exactly `feat(seo): channel publishing schedule and upload workflow` on `main`.

## Review Focus

- A malformed stored `publishSchedule` must not make a legacy channel unreadable; cover garbage storage in `contracts/channel.test.ts` and the channel doc test.
- DST wall times must follow the exact gap/fold rule; pin both rules and UTC instants in `contracts/channel-schedule.test.ts`.
- Duplicate-title matches must exclude self and projects from other channels; test the projected query and SEO route with two channels and an excluded project.
- Clipboard rejection or unavailable clipboard must reach a visible fallback; exercise the exported clipboard helper's result, not only a mocked call count.
- Missing channel/schedule remains neutral and reminder-only; test checklist item flags and PublishPanel output for both states.

---

### Task 1: Schedule contract and safe legacy reads

**Files:** Create `src/contracts/channel-schedule.ts` and `src/contracts/channel-schedule.test.ts`; modify `src/contracts/channel.ts`, `src/contracts/channel.test.ts`, `src/server/modules/channel/docs.ts`, and `src/server/modules/channel/channel.test.ts`.

**Interfaces:** Export `PublishScheduleSchema` and `PublishSchedule` from `channel-schedule.ts`. Channel create/update inputs accept the strict schema or `null`; API and Mongo read schemas catch invalid stored values as `null`.

- [x] Add schema tests for defaults, IANA validation, strict weekday/time/kind, 14-slot cap, 500-character notes, duplicate rejection, nullable input, and malformed stored values.
- [x] Run the contract and channel tests; confirm the new cases fail for the placeholder `z.unknown()` contract.
- [x] Implement schema and split input-vs-read behavior; run the same tests and verify legacy documents still parse.

### Task 2: Timezone slot calculation and labels

**Files:** Extend `src/contracts/channel-schedule.ts` and `src/contracts/channel-schedule.test.ts`.

**Interfaces:** Export `nextPublishSlots(schedule, now, kind, count): Date[]`, `formatSlotLabel(instant, timezone): string`, `PUBLISH_LEAD_HOURS_MIN`, `PUBLISH_LEAD_HOURS_MAX`, and `PUBLISH_SCHEDULE_STARTER`.

- [x] Add failing tests for Sunday-to-Monday, equality with `now`, kind filtering, count cap/availability, empty schedules, deterministic results, Ho Chi Minh time, New York DST gap/fold UTC instants, and Vietnamese labels.
- [x] Run the contract tests and verify the missing helper or incorrect instants produce the expected failures.
- [x] Implement `Intl.DateTimeFormat(...).formatToParts` wall-time conversion without a new dependency; skip spring-gap slots and select the first fall-fold occurrence.
- [x] Run the tests, then document and manually review the timezone offset conversion against literal expected UTC values.

### Task 3: Project chosen-title query

**Files:** Modify `src/server/modules/project/repo.ts`, `service.ts`, `index.ts`, `indexes.ts`, and project tests.

**Interface:** Export `listChosenSeoTitlesByChannel(channelId, excludeProjectId): Promise<string[]>`; query only projects with that channel, exclude the current id, and project only the chosen title text.

- [x] Add failing service/query tests for chosen title inclusion, unchosen title exclusion, self exclusion, channel isolation, and empty/missing chosen titles.
- [x] Run the focused project tests and verify the missing public query fails.
- [x] Add the projection query, public export, and `{ channelId: 1 }` index; run focused project tests.

### Task 4: Duplicate-title helper and SEO route

**Files:** Create `src/contracts/seo-duplicates.ts` and tests; modify `src/server/modules/seo/routes.ts`, `index.ts` as needed, and `seo-routes.test.ts`.

**Interfaces:** Export `findDuplicateTitle(chosenTitle, otherTitles)`; add `GET /api/project/:id/seo/channel-titles` returning `{ titles: string[] }`, using only `project/index.ts` and returning an empty array for unassigned projects.

- [x] Add failing tests for accent/case/punctuation normalization, equality, containment at and below 12 normalized characters, blanks, no channel, and route response.
- [x] Run SEO contract/route tests and verify failures are due to absent behavior.
- [x] Implement normalization and route projection; run focused SEO and project tests.

### Task 5: Channel editor schedule form

**Files:** Modify `src/client/features/channel/channel-helpers.ts`, `channel-helpers.test.ts`, `components/ChannelManagerDialog.tsx`, and its CSS module.

- [x] Add failing helper tests for API schedule to form conversion, form to payload conversion, empty/null schedule, and explicit starter prefill without saving.
- [x] Add a schedule form with timezone text plus common-zone datalist, weekday/time/kind rows, add/remove, notes, and a starter button; starter values are Tue/Fri/Sun 20:00 long and Mon–Fri 12:00 short.
- [x] Keep starter insertion in local form state only and display its `19:30–21:00` / `11:30–12:30` windows with the unverified hint.
- [x] Run client helper/API/hook tests and the component's rendering tests.

### Task 6: SEO checklist and Markdown schedule output

**Files:** Modify `src/contracts/seo-format.ts`, `seo-format.test.ts`, `src/client/features/seo/seo-package.test.ts`, and associated types.

**Interfaces:** Extend `buildPublishChecklist(project, thumbnailFile?, channel?, context?: { now?: Date; otherChannelTitles?: readonly string[] })` and `buildPackageMarkdown(project, channel?, context?)`.

- [x] Add failing tests for schedule reminder with/without a long slot, no-warning neutral flags, duplicate-title warning details, no-schedule text, and Markdown next-three-slot/lead-time/zone output.
- [x] Implement `schedule` and conditional `duplicate-title` rows; retain `ai-content` as a reminder with `warning` false.
- [x] Include Markdown schedule only when an assigned channel has a long slot and `context.now` is provided; preserve no-schedule legacy export byte-for-byte.
- [x] Run contract and SEO package tests.

### Task 7: Publish panel, query invalidation, and clipboard fallback

**Files:** Create `src/client/features/seo/publish-schedule.ts` and `.test.ts`; modify `src/client/features/seo/components/PublishPanel.tsx` and tests, `src/client/features/seo/SeoPage.tsx`, `src/client/features/seo/api.ts`, `hooks.ts`, their tests, and `src/client/features/project/hooks.ts` plus tests.

- [x] Add failing tests for `copyPublishSlot(text, writeText): Promise<{ copied: boolean; fallbackText: string | null }>`, deterministic slot rendering, three-slot cap, zone in copied text, clipboard success/failure fallback, no channel/schedule message, and the numbered upload workflow.
- [x] Add `useChannelTitles(projectId, channelId)` in SEO hooks; invalidate its query key from project channel assignment and from SEO save when `chosenTitleId` changes.
- [x] Pass an injectable `now` value into pure panel/format helpers; show long-video slots, copy controls, a management pointer, and the unverified 2–4-hour suggestion.
- [x] Run focused client tests and verify no API call or clipboard permission is required for the pure fallback tests.

### Task 8: Docs, integrated verification, and commit

**Files:** Update `AGENTS.md`, `src/server/modules/channel/MODULE.md`, `src/server/modules/project/MODULE.md`, `src/server/modules/seo/MODULE.md`, and create `docs/superpowers/tasks/task-110-report.md`.

- [x] Update module boundaries and Status with verified behavior and actual test results.
- [x] Run focused touched-module tests, `npm run typecheck`, `npm run lint`, `npm run build`, and full `npm test` with the installed MongoDB binary.
- [x] Attempt disposable-project 1920×1080 browser acceptance for schedule editing/persistence, copied slot, duplicate-title warning, and reload; list anything unavailable as unverified.
- [x] Verify only Task 110 paths are staged, inspect `git diff --cached`, confirm staged tests pass, and commit with the required exact subject. Do not push or merge.
