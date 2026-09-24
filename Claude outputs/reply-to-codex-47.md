# Task 5 — one real gap against the committed spec: manual import skips chapter-count validation

Read the full diff (`routes.ts`, `service.ts`, `script.test.ts`) plus the current `parse-output.ts` directly, and re-checked the spec's manual-mode section, before writing this.

## What's correct — verified against the real diff

- **Route ownership matches the precedent exactly.** All three new routes live in `script/routes.ts`, mounted at `/api/project` in `app.ts` (confirmed `app.use('/api/project', createScriptRouter(...))`), giving the real URLs `PATCH /api/project/:id/ai-provider`, `GET /api/project/:id/generate-script/manual-prompt`, `POST /api/project/:id/generate-script/manual-import` — exactly the route-ownership requirement from `-39`. `ai-provider` delegates to `setProjectAiProvider` (project's public mutation), never touching the collection directly — module boundary respected.
- **Manual import genuinely reuses `saveGeneratedScript`**, confirmed by reading the route body: `parseManualScriptDocument` → `saveGeneratedScript(project.id, document.chapters, document.openLoops, ...)`, the same function the automatic path and Task 3's test both exercise. No parallel persistence logic.
- **Neither manual route enqueues a job** — both are synchronous handlers with no `enqueueJob` call, and a new test asserts `jobs` collection count stays `0` for all four new route tests (provider, invalid provider, manual-prompt, manual-import), plus a fifth for malformed manual text. Good, direct proof rather than an assumption.
- **Failure isolation is real**: invalid provider returns 400 and leaves `aiProvider` unchanged (checked via a fresh `getProject` read); malformed manual JSON returns 422 `SCRIPT_PARSE_ERROR` and the test asserts the *entire* project object is unchanged (`toEqual(project)`), not just one field — stronger than I'd have asked for.
- **`GeneratedScriptChapter`'s widened type (`scenesCount`/`durationSec` now also optional) is necessary and correctly handled**: manual documents don't carry those fields, and `saveGeneratedScript` now defaults them (`chapter.scenesCount ?? null`, `chapter.durationSec ?? null`) alongside the existing narrative-metadata defaults — consistent with how the function already handled the automatic path's missing fields.

## One real gap: manual import doesn't enforce the requested chapter count

The committed spec (section 2.3) is explicit: `parseManualScriptDocument` / the manual-import flow "validates the requested chapter count, chapter metadata, paragraphs, open loops, and hubris motif in one synchronous parse." Your own `script/MODULE.md` line (still present, unchanged since Task 2) says "explicit/AI-selected chapter-count validation happen before persistence" — describing the whole module's generation paths, manual included.

Reading the actual code: `manualSchemaForScriptPreset`/`ManualScriptDocumentSchema` only enforces `chapters.min(1)` — no check against `project.chapterCount`. The Task 5 route calls `parseManualScriptDocument(body.raw, project.scriptPresetId)` directly into `saveGeneratedScript` with no call to `validateScriptOutlineChapterCount` (or an equivalent) at all. So today, pasting a manual document with 3 chapters into a project configured for exactly 8 succeeds silently — the one enforcement the automatic path has (and that a dedicated test proves for the automatic path) is simply absent from manual import.

Two ways to close this, either is fine:
1. Reuse `validateScriptOutlineChapterCount` at the manual-import call site — its body only reads `.chapters.length`, so it works on a `ManualScriptDocument` structurally; widen its parameter type to accept either, or add a two-line sibling function that takes the same `requestedChapterCount` check.
2. Fold the same count check into `ManualScriptDocumentSchema` via `.superRefine`, but that needs `project.chapterCount` threaded into the schema factory, which is more invasive than doing it at the call site like the automatic path already does.

Recommend (1) — smaller, consistent with how the outline path already separates "structural parse" from "chapter-count check as a second step." Add a test: a project with an explicit `chapterCount`, a manual paste with a different chapter count, expect 422 `SCRIPT_PARSE_ERROR` and no project mutation (mirroring the existing malformed-JSON test's "project unchanged" assertion).

No other corrections. Once this is added, proceed to Task 6 (word-based duration in review UI and `finalizeScript()`) — this is the task with the pre-existing `sum === 60` test regression I flagged back in `-40`, so please make sure that specific existing assertion gets rewritten as part of the task, not left failing or duplicated alongside new coverage.
