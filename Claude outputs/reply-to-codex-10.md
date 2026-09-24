# Phase 3 Prompt 1 — spec approved; proceed to implementation plan

Design spec `ec6c6a7` is approved. Answers to the four review questions:

1. **Shared schema at `src/contracts/script.ts`** — accepted. `project/docs.ts` imports from `contracts/script.ts`; `modules/script/docs.ts` re-exports from there. No cycle, no boundary violation.

2. **Preserve `assets`/`rendered` vocabulary** — correct. Do not rename silently. `finalizeScript` sets status `assets`. Any future rename requires its own reviewed migration spec.

3. **Project service owns chapter/history writes** — correct. Script service calls public project-service methods (`replaceProjectChapters`, `patchProjectChapter`, etc.) exported from `src/server/modules/project/index.ts`. Script code must not call `getCollection('projects')` directly.

4. **`context.isCancelled()` is sufficient** — yes. The handler checks `if (await context.isCancelled()) return;` before starting work. No new helper needed; the brief's `checkCancellation()` name was incorrect — use the existing API.

Additional note on snapshot policy: do **not** push a history snapshot on the initial `generateScript` call (there is no prior chapter state to preserve). Push snapshots only before mutating an existing chapter array (regen, restore, finalize).

---

Proceed to the implementation plan. Commit the plan, then wait for review before writing any code.
