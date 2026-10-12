# Task 89 — Bulk QA Apply Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` inline; keep this plan uncommitted.

**Goal:** Add severity-filtered bulk QA application with sequential chapter work, progress/cancel, and guarded whole-run undo.

**Architecture:** Keep planning pure in `chapter-actions.ts`; keep split menu/confirm/result UI in `QaApplyAllDialog`; orchestrate existing patch and regeneration APIs in `ReviewScriptPage`. Use history option B: carry a unique `historyBatchId` through each batch write so the first mutation records one pre-run snapshot and later batch writes coalesce into it. A representative run with 3 chapter patches and 2 regenerations currently creates 5 snapshots; option B creates 1, avoiding four of the five possible evictions without a new collection/TTL lifecycle. If the existing list is already at ten, confirmation explicitly warns that the one new batch snapshot will replace the oldest entry; no eviction is silent. SSE keeps the existing `error` event string unchanged and adds a separate `error-details` event with `code`/`status`; old clients ignore it.

**Tech Stack:** TypeScript, React, Zod, Express SSE, Vitest, MongoDB memory server, existing Vite/browser setup.

**Spec:** User attachment `C:\Users\Admin\.codex\attachments\ff38588e-b524-48f2-af5a-68b3f7ed9004\Pasted text.txt` and approved Claude conditions in this conversation.

## Global Constraints

- Preserve existing per-issue actions, copy, and ARIA labels.
- Process chapters in ascending order, patch each chapter before at most one sequential regeneration for that chapter; skip `REVIEW_FACT`, missing chapters/quotes, ambiguous quotes, and manual-mode regeneration.
- Cancellation aborts the active SSE stream and prevents starting another chapter; applied edits remain until the existing restore flow is used.
- When history is already at ten entries, the bulk confirmation must disclose that its single undo snapshot replaces the oldest version.
- Do not increase the global ten-snapshot cap; no new dependency; keep Task 87's dirty file untouched; stage Task 89 paths only.
- Update root `AGENTS.md` Status and `src/server/modules/script/MODULE.md` in the Task 89 commit.
- Real acceptance uses a duplicate of Rạch Gầm, never the original; do not fabricate evidence.

## Review Focus

- Duplicate or shifted quote targets after earlier local replacements — planner tests re-find each quote on updated paragraphs and skip stale/ambiguous targets.
- Manual regeneration mode — planner tests exclude AI work while retaining local patches and reporting the manual skips.
- Legacy SSE error event without metadata — client test treats it as an ordinary chapter failure, not a hard stop.
- A later edit after bulk completion — undo guard test refuses whole-project restore rather than overwriting newer content.
- Cancel during streaming — UI/source and stream tests verify the active controller aborts and the next chapter never begins.

## File Map

- `src/client/features/script/chapter-actions.ts` / `.test.ts`: pure planner, severity counts/order/skip reasons, undo guard.
- `src/client/features/script/components/QaApplyAllDialog.tsx` / `.module.css`: split control, keyboard menu, confirmation and result summary.
- `src/client/features/script/ReviewScriptPage.tsx` / `.module.css` / `.test.ts`: batch orchestration, busy lock, progress/cancel, existing restore integration.
- `src/client/features/script/api.ts` / `script-api.test.ts`: batch ID request support and compatible structured SSE error parsing/classification.
- `src/client/shared/ui/blocking-progress.ts` / tests: cancellable QA-bulk task kind.
- `src/contracts/script.ts`, `src/server/modules/project/service.ts`, `src/server/modules/script/service.ts`, `routes.ts`, `script.test.ts`: batch history coalescing and additive SSE error metadata.
- `src/server/modules/script/MODULE.md`, `AGENTS.md`: document the new persistence/flow and final status.
- `data/files/.verification/task-89/real-*`: real browser acceptance captures, only if live API/browser and duplicate project are reachable.

## Order and Checks

1. Write and run failing tests for batch snapshot coalescing and SSE emission/parsing; implement the server/client contract. Verify five legacy writes produce five snapshots and five writes under one batch ID produce exactly one, while retaining prior history.
2. Write planner tests first, then implement severity selection, accepted/dismissed filtering, sequential replacement matching, skips, merged instructions/strongest level, and manual mode.
3. Add UI/progress/undo-guard behavior and source/component regressions; preserve existing individual action wiring.
4. Duplicate Rạch Gầm and exercise all three options, a patch, provider regeneration if reachable, cancellation, undo, and 390px/desktop screenshots. Record unavailable cases plainly.
5. Run index export, `npm run typecheck`, `npm run lint`, full `npm test` with real counts, and `npm run build`; inspect staged diff and commit only Task 89 files/hunks.
