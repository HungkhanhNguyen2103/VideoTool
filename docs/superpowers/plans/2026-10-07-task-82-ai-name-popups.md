# Task 82 — AI Name and Place Pop-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic, persisted AI suggestions for one name/place lower-third per scene, with strict timed-word validation and the existing rule-based fallback.

**Architecture:** The video module owns prompt construction, AI parsing, candidate validation, and render-time selection; the project module owns scene-field persistence and stale-safe batch writes. The API exposes synchronous manual analysis, Remotion props consume only fresh validated candidates, and Studio reports project and per-scene selection using the same pure rules.

**Implementation note:** Client code cannot import the server-owned video selector across the module boundary. The same pure `selectProjectSceneKeywords` helper now powers Remotion and a read-only `GET /:id/name-keywords/previews` endpoint, so the Studio detail line reports the exact selected popup/source without copying server selection logic into the browser.

**Tech Stack:** TypeScript, Zod, MongoDB project service, existing shared AI clients, Express, React, Vitest.

**Spec:** `C:\Users\Admin\.codex\attachments\ca86b5d3-9ffb-4b43-a4cd-b5a1fe637d41\Pasted text.txt` (Task 82).

## Global Constraints

- Names and places only; numeric, date, year, film-look, and popup visual behavior remain unchanged.
- AI returns at most two ranked `{ phrase, kind, role? }` candidates per scene, in one project-wide JSON-mode request, with temperature 0 and one retry only for invalid JSON.
- Rank by importance; when names are equally important, break ties by first appearance in the narration. Copy exact contiguous narration wording, include generic prefixes that belong to proper names, and omit generic nouns unless part of a proper name.
- Candidate timing comes only from a contiguous matched run in `wordTimings.words`; rerun validation against current timings before render use.
- Persist by scene through project service; stale records are ignored when narration hash or audio file ID differs.
- On narration edits and per-scene voiceover regeneration, retain the previous candidate record as stale history. A narration edit clears `audioFileId` and `wordTimings`, so while audio is absent Studio reports the record as `đã cũ` and the scene dialog shows `Popup tên: —`. Once new voiceover and aligned timings exist, stale candidates remain ignored and the rule-based popup is used, while Studio still reports `đã cũ`. A new analysis refreshes the record, Studio reports `có kết quả mới`, and the AI popup is used.
- Clear candidate records only when duplicating a project or when a bulk scene reset sets `audioFileId` to `null`; the Studio status for scenes with no record is `chưa phân tích` and rules remain active.
- Provider/parse failures and responses whose candidates are all rejected preserve stored data and render with the rule fallback. A valid empty candidate list is persisted as a fresh empty result so an explicit re-analysis can clear an older choice.
- No new dependencies, no secrets in fixtures/output, and `npm test` must never call the network.
- Update `AGENTS.md`, video module documentation, and project module documentation in the feature commit; stage only changed files.

## Review Focus

- Changed narration or audio reference after the AI response: stale data must not be rendered; test atomic write predicates and freshness. With audio/timings cleared, no popup is selected; after fresh alignment, rules are selected until AI analysis is rerun.
- Candidate punctuation/casing/diacritics and split timed words: validate normalization while requiring a contiguous word run.
- An AI candidate that starts too late or has too little remaining audio: continue to next AI candidate, then rules.
- Mixed AI and rule sources across scenes: project-level dedupe must keep one popup for the same bare name.
- Invalid JSON after retry or provider failure: leave prior stored candidates untouched and expose a useful manual-action error.

---

### Task 1: Shared candidate validation and Task 81 reuse

**Files:**
- Modify: `src/server/modules/video/name-keywords.ts`
- Modify: `scripts/eval-keyword-ai.ts`
- Test: `src/server/modules/video/name-keywords.test.ts`

**Interfaces:**
- Produces `normalizeNameMention(value: string): string` and `validateNameCandidate(narration, words, candidate)` returning an accepted candidate with `startWordIndex`/`endWordIndex` or a rejection reason.

- [ ] Add failing tests for case/diacritic-insensitive verbatim matching, non-contiguous timed words, phrase absent from narration, and empty candidates.
- [ ] Run the focused test and verify the expected missing-export failures.
- [ ] Move the Task 81 validation behavior into the video helper and make the evaluation script import it; keep normalization behavior equivalent.
- [ ] Run the focused test and Task 81 script typecheck/lint coverage.

### Task 2: Persisted scene shape and project-owned batch write

**Files:**
- Modify: `src/contracts/project.ts`, `src/server/modules/project/docs.ts`, `src/server/modules/project/service.ts`, `src/server/modules/project/index.ts`
- Test: `src/server/modules/project/docs.test.ts`, `src/server/modules/video/video.test.ts`

**Interfaces:**
- Stored scene field: `nameCandidates: { narrationHash: string; audioFileId: string; provider: AiProvider; model: string; generatedAt: string; candidates: { phrase: string; kind: 'person'|'place'|'event'|'group'; role?: string }[] } | null`.
- Project API: `setProjectSceneNameCandidates(id, updates): Promise<number>`; one project-owned update applies only when each scene still has the captured narration and audio ID.

- [ ] Test legacy scene default `null`, duplication clears the field, narration edits and per-scene voiceover regeneration retain stale records, a bulk reset to `audioFileId: null` clears them, and stale write predicates do not overwrite a changed scene.
- [ ] Verify tests fail before adding schema/service behavior.
- [ ] Add contract/doc schemas, map field through `toDetail`, retain stale records on narration edits and per-scene voiceover regeneration, clear on duplicate and bulk reset to no audio, and implement one stale-guarded batch update.
- [ ] Run focused project/video persistence tests.

### Task 3: Candidate selection in `keywords.ts`

**Files:**
- Modify: `src/server/modules/video/keywords.ts`
- Test: `src/server/modules/video/keywords.test.ts`

**Interfaces:**
- Extend `selectKeywords(words, options?: { nameCandidates?: readonly ValidatedNameCandidate[] }): Keyword[]`.
- AI candidate mapping: person -> `nameRole: 'person'` and sentence-cased role subtitle; place -> `nameRole: 'place'`; event/group -> no `nameRole`.

- [ ] Add tests for AI precedence, ranked candidate hold/remaining-audio filtering, rule fallback, unchanged no-options output, all kind mappings, and mixed-source dedupe.
- [ ] Run focused tests and confirm the new option assertions fail.
- [ ] Add AI candidate candidates through the existing lower-third timing filter, taking the first eligible AI result before rule candidates; retain one name popup per scene.
- [ ] Run all keyword tests and the Remotion keyword regression tests.

### Task 4: Analysis service and AI client temperature option

**Files:**
- Modify: `src/server/shared/ai/types.ts`, `src/server/shared/ai/deepseek.ts`, `src/server/shared/ai/claude.ts`
- Create: `src/server/modules/video/name-keyword-service.ts`
- Modify: `src/server/modules/video/index.ts`
- Test: `src/server/modules/video/name-keyword-service.test.ts`, `src/server/shared/ai/ai.test.ts`

**Interfaces:**
- `analyzeProjectNameKeywords(projectId, clientResolver?)` loads project scenes, uses `project.aiProvider`, and returns `{ scenesAnalyzed, scenesSkippedNoTimings, scenesWithName, rejectedCandidates, provider, model }`.
- Prompt builder emits one numbered scene per eligible narration and requests at most two importance-ranked candidates; parser validates shape, retries once only after invalid JSON, and validator rejects candidates without a timed contiguous match.

- [x] Test service success, missing timing skip count, provider/model persistence, invalid JSON retry, retry failure leaves prior values untouched, schema failure does not retry, valid empty results clear old choices, and all-candidate-rejected no-write.
- [ ] Run focused tests and verify red failures.
- [x] Add optional `temperature` to chat options and pass it only when specified; preserve current defaults for every existing caller. JSON mode is propagated to both DeepSeek and Claude; default Claude request shape remains unchanged.
- [ ] Implement project-wide JSON request, logging, validation, and project-service batch write. Return a clear AppError on manual action failure.
- [ ] Run service and shared AI tests.

### Task 5: Route guard and Remotion render props

**Files:**
- Modify: `src/server/modules/video/routes.ts`, `src/server/modules/video/remotion-props.ts`
- Test: `src/server/modules/video/video.test.ts`, `src/server/modules/video/remotion.test.ts`

- [ ] Test POST route success summary, active render rejection, and provider/service error mapping.
- [ ] Test Remotion props use fresh stored candidates, revalidate against current words, and fall back when stale or invalid.
- [ ] Run focused tests to verify the route and render behavior fail before implementation.
- [ ] Add `/api/project/:id/name-keywords/analyze`, block active `render-full-video`, and wire fresh candidates into per-scene keyword selection before project-level annotation/dedupe.
- [ ] Run video and Remotion tests.

### Task 6: Best-effort auto-analysis after voiceover alignment

**Files:**
- Modify: `src/server/modules/video/word-timing-service.ts` or the corresponding project-wide worker completion path in `src/server/modules/video/handlers/`
- Test: `src/server/modules/video/video.test.ts`

- [ ] Test that completion triggers analysis only when at least one eligible scene lacks fresh candidates, and that AI failure does not fail the alignment job.
- [ ] Implement the trigger after project-wide alignment completes; if the existing worker lifecycle makes this unsafe or duplicates calls, omit auto-run and retain manual analysis as the required path.
- [ ] Run the focused worker/service tests.

### Task 7: Studio status, manual action, blocking overlay, and scene detail

**Files:**
- Modify: `src/client/features/asset/api.ts`, `StudioPage.tsx`, `StudioPage.module.css`, `src/client/features/asset/name-keyword-ui.ts`, `src/client/shared/ui/blocking-progress.ts`, `src/server/modules/video/routes.ts`, `src/server/modules/video/keywords.ts`, `src/server/modules/video/remotion-props.ts`
- Test: `src/client/features/asset/asset-api.test.ts`, `StudioPage.test.ts`, `name-keyword-ui.test.ts`, `src/client/shared/ui/blocking-progress.test.ts`, `src/server/modules/video/keywords.test.ts`, `video.test.ts`

- [ ] Run the required source test inventory: `rg -n "StudioPage|isStudioLocked|blocking-progress" src/client --glob "*.test.ts"` and record any deliberately updated source-literal assertions.
- [x] Add pure tests for status derivation, per-scene popup/source derivation, and busy-key title `Đang phân tích tên popup`.
- [x] Verify the new tests fail, then add typed route client, project row/button using current lock state, awaited busy key, status text, and a read-only detail line derived from the same selector.
- [x] Verify the blocking dialog is indeterminate and uses the existing unified lock; run focused client tests.

### Task 8: Documentation, full verification, and acceptance

**Files:**
- Modify: `AGENTS.md`, `src/server/modules/video/MODULE.md`, `src/server/modules/project/MODULE.md`
- Test: no new test file; run all focused and project checks.

- [ ] Document persisted field, freshness rule, and AI-then-rules fallback order in both module documents; update Status with the actual test count and acceptance evidence.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
- [ ] Run Rạch Gầm analysis twice; compare first 15 scenes and confirm identical stored candidates/render props.
- [ ] Change one scene narration and verify: candidate record retained + `đã cũ` + `Popup tên: —`; after new voiceover/alignment, verify rules popup + still `đã cũ`; rerun analysis and verify `có kết quả mới` + AI popup. If TTS/alignment is unavailable, report that state as unverified on the real project and rely only on pure/mocked coverage.
- [ ] Capture Studio at 1280px or wider and 900px, overlay while running if observable, plus a lower-third frame if render preview is available; record unavailable checks honestly.
- [ ] Stage only files changed for Task 82 and commit as one feature change after checks pass.

## Acceptance outcome — 2026-10-07

- Narration edits retain the candidate record as stale while clearing audio/timings. The scene popup is `—` until new aligned audio exists; after alignment it uses rules while still stale; explicit analysis refreshes the record and returns to AI selection. Studio derives `có kết quả mới`, `đã cũ`, and `chưa phân tích` counts from current project state.
- The final system prompt includes the first-appearance tie-break. The real DeepSeek path passes `temperature: 0`; a fake-fetch test verifies the serialized DeepSeek HTTP body includes zero. The first two post-tie-break Rạch Gầm runs produced identical renderer keyword arrays. Candidate metadata differed only for `Xiêm`'s `kind` in scenes 32 and 38 (`place` vs `group`), without changing either popup or renderer props. Explicit re-analysis can therefore change metadata/choices in ambiguous ties; stored candidates keep render props stable between analyses.
- Retry is limited to malformed JSON, not schema/scene-number failures. A syntactically valid empty candidate response is saved as a fresh empty list; provider/parse failures and all-rejected candidates leave old records untouched. Claude structured JSON output is now requested when callers set `json: true`.
- The historical pre-tie-break three-scene A/B snapshot was not retained in logs or files, so its exact narration/candidate pairs cannot be reproduced. The post-tie-break pair is recorded in the Task 82 completion report.
- Real acceptance on Rạch Gầm verified narration edit → `—`/stale → local voiceover and word alignment → rules fallback/stale → explicit analysis → fresh AI popup. The temporary narration/audio/timing/candidate state was restored afterward. Real Studio captures at 1280×900 and 900×800, a request-paused blocking overlay, and a Remotion frame with `Sông Tiền` are saved under `data/files/.verification/task-82/`.
