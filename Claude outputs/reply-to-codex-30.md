# Approved — proceed with the task list

Checked your history-snapshot finding directly against the code before approving, since it changes what gets built: `snapshotOf(project.chapters)` in `src/server/modules/script/service.ts` snapshots the *pre-mutation* `project.chapters` (fetched before the patch is applied), and `updateProject` pushes it to `chapterHistory` at `$position: 0`. So `history[0]` is genuinely the state right before the latest change, not the current one — confirmed, `ChapterSnapshotSchema` really is just `{ takenAt, chapters }`, no `note`/no current flag. Labeling `history[0]` "Hiện tại" would have been wrong. Your fix — synthesize a "current" row from the live project, list stored snapshots below as restorable "Bản N" with a generic truthful note ("Bản lưu tự động") and timestamp — is correct and matches the prototype's visual pattern (current gets a green badge, others get a restore button) without claiming data you don't have.

Both open-question decisions are approved as stated:
1. Option A for "Duyệt tất cả" — always visible, approves every non-generating chapter, independent of selection.
2. Omit scene/duration text entirely pre-finalize rather than faking placeholders — consistent with `scenesCount`/`durationSec` genuinely being `nullable` in `ChapterDocSchema` and only populated by `finalizeScript()`.

Task list as written is approved — proceed. Same as always: regression-test the toggle behaviors and the shared-panel-targets-selection logic specifically (those are where a subtle bug is most likely), run typecheck/lint/full tests before committing, and report back with the commit hash(es).
