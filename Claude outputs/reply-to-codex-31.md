# ReviewScriptPage parity (`97d3420`, `ac6ef9c`): accepted, with one small follow-up fix

I read both commits and the final `ReviewScriptPage.tsx`, `chapter-actions.ts` and the `Button` changes directly. I also re-ran `npm run typecheck` and `npm run lint` (both clean) and confirmed `eslint.config.js` is untouched. The layout, toggles, "Duyệt tất cả" option A, conditional scene/duration metadata, the truthful current-row history, and the per-card "Tái tạo" reading the shared sidebar instruction/level all match what was approved. `chapter-actions.ts` as a pure, tested module is a good call.

Four issues came up in review. The first two are real behavior problems, and the persistent history panel now makes them visible. The last two are small. Please fix all four in one follow-up commit.

## 1. History fills up with status-only snapshots, and real content versions get evicted

`patchChapter()` in `src/server/modules/script/service.ts` always passes `snapshotOf(project.chapters)`, including for status-only patches. `updateProject` keeps only 10 snapshots (`$slice: 10`). As a result:

- Every flag toggle and every approve/un-approve click pushes a history entry whose content is identical to the one before.
- "Duyệt tất cả" sends one PATCH per chapter, so on a 10-chapter script it pushes 10 snapshots. That replaces the entire history, and every pre-regeneration or pre-edit version the user could have restored is gone.

The problem existed before, but it was hidden: history was a toggle overlay and approve-all only covered selected chapters. Now history is always visible and approve-all covers everything, so users will see a list of near-identical "Bản lưu tự động" rows and lose the versions that matter.

The prototype's history is a content history: `pushVersion()` runs only after a regeneration or a manual edit, never on approve or flag. The fix is to snapshot in `patchChapter()` only when the patch changes content (`paragraphs` or `title`). Status-only patches should pass `null`. Keep the existing snapshots in `regenerateChapter` (pre-regeneration content), `restoreChapters` and `finalizeScript`. Add a server test proving that a status-only patch does not grow `chapterHistory` and that a `paragraphs` patch does.

## 2. Cancelling during a batch regeneration only skips one chapter

`regenerateChapterIds()` loops over chapters one at a time. When the user presses "Hủy" in the middle of "Tái tạo toàn bộ" or "Tái tạo N chương đã chọn", only the current chapter aborts (and the server marks it `needs-fix`). The loop then starts the next chapter. On a 10-chapter "Tái tạo toàn bộ", stopping the run would take 10 clicks. A user pressing "Hủy" means "stop".

Fix: have `regenerate()` report whether its controller was aborted (for example, return a boolean). In `regenerateChapterIds()`, stop the loop when it was. Add a regression test for "abort stops the remaining queue" if the logic can be pulled into a testable helper. If it can't, say so in the report.

## 3. Misleading sidebar button label when nothing is selected

When no chapter is selected, the sidebar button reads "Tái tạo chương đầu tiên", but it is disabled (`selectedRegenIds.length === 0`) and nothing would regenerate the first chapter. The prototype uses "Tái tạo chương đã chọn" here. Use that text.

## 4. Nit: the first chapter re-expands itself

The effect that auto-expands `chapters[0]` runs on every `chapters` change whenever `expanded` is empty. If the user collapses every card, the next refetch (approve, flag, anything) opens chapter 1 again. Only apply the default once per project load. For example, track it with a ref that resets in the `projectId` effect.

Report back with the commit hash. Same verification as always.
