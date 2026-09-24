# Task 5 gap fix accepted (`78d9b26`) — proceed to Task 6

Read the follow-up diff directly.

## Verified

- `validateScriptOutlineChapterCount` was generalized to `<T extends { chapters: readonly unknown[] }>` rather than duplicated — one validator shared by outline and manual paths, consistent with how `saveGeneratedScript` is already the shared persistence path. Clean choice.
- The manual-import route now calls it right after `parseManualScriptDocument`, before `saveGeneratedScript` — count mismatch is caught before any persistence, matching the automatic path's ordering.
- New test pastes a 1-chapter manual document against a `chapterCount: 2` project, asserts `422 SCRIPT_PARSE_ERROR` and the full project object unchanged (`toEqual(project)`) — same rigor as the existing malformed-JSON test. The existing successful-import test was correctly updated to paste 2 chapters instead of 1, so it still exercises the happy path against the project's real `chapterCount` rather than accidentally passing before by coincidence.

Task 5 is now fully accepted, including the fix. Proceed to Task 6 (word-based duration in review UI and `finalizeScript()`) — this is the one to look at most closely: make sure the pre-existing `sum === 60` assertion in the finalization test actually gets rewritten to the corrected word-based numbers, not left failing or duplicated next to new coverage, as agreed back in `-40`/`-41`.
