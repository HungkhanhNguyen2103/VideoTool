# Task 7 accepted (`b73d1b9`) — proceed to Task 8

Read the full diff (`api.ts`, `chapter-actions.ts`, `ReviewScriptPage.tsx`, `NewProjectForm.tsx`, both test files) directly before accepting.

## Verified against the real diff

- **`NewProjectForm.tsx` finally closes the exact gap flagged back in `-37`**: `aiProvider` is now `register('aiProvider')`-bound with options generated from `AI_PROVIDERS`, not hardcoded — confirmed by reading it, not just the report.
- **Raw-text preservation on import failure is real, not just claimed**: `importManual()`'s catch branch calls `setManualRaw(manualTextAfterImport(manualRaw, false))`, and the pure helper is trivial enough to verify by inspection (`succeeded ? '' : raw`) plus directly tested for both branches.
- **Provider switching is available in both places the original brief asked for**: at project creation (`NewProjectForm`) and later, on the review page — both before any generation (in the "Nháp kịch bản" panel) and after chapters exist (a second `review-provider-existing` select in the chapter-review header) — matching "so the user can switch provider before generating or before a specific regeneration, not just at project creation" from `-37`.
- **Manual mode never touches the job queue**: `importManual`/`loadManualPrompt`/`copyManualPrompt` all call plain `api.*` functions with no `enqueueJob`/`jobId` involvement, consistent with Task 5's synchronous manual routes.
- **`api.ts`'s three new functions are correctly typed and response-validated** (`ManualPromptResponseSchema`, `ProjectDetailSchema` reused for provider/import responses) — the new `script-api.test.ts` case asserts the exact URLs, methods, and request bodies for all three, not just that they resolve.
- **Narrative metadata display** (`role`/`targetWords`/`beat`/`endsOnTension`) is conditional on presence (`chapter.role &&`, `!= null`, etc.), so legacy/null chapters won't render empty labels.

## One minor, non-blocking observation

`generationModeForChapters(chapterCount, requested)` returns `'automatic'` when `chapterCount > 0`, but the only place it's called (`effectiveGenerationMode`) lives inside a block gated by `!chapters.length && !jobId` — so `chapters.length` is always `0` at that call site today, meaning the `chapterCount > 0` branch is currently unreachable dead code (harmless, and tested, just not exercised by the actual UI). Not worth a fix cycle on its own — if it's meant as forward-looking safety for a future UI change, fine as-is; if not, it could be simplified to just track `generationMode` directly. Your call, no correction required.

No corrections needed. Proceed to Task 8 (regression coverage + acceptance doc) — the final task. Given how many concrete gaps turned up across Tasks 4–6 (open-loop scoping, manual chapter-count validation, review/finalization duration mismatch), make sure the acceptance doc's self-review section doesn't just restate "all tests pass" but actually walks through the cross-cutting behaviors that were fixed mid-phase, since those are exactly the kind of thing a production/boundary scan might not catch on its own.
