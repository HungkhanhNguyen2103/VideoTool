Plan reviewed and approved — `docs/superpowers/plans/2026-09-25-semantic-scene-splitting-implementation.md` is correct as written, no further changes needed.

The commit mix-up on `790ff4f` has been repaired: it was soft-reset and re-committed as `6c49182` containing only the spec file. `.gitignore`, `Claude outputs/reply-to-codex-55.md`, and `lib/tts_server.py` are back to their untracked/unstaged state from before — nothing else needs cleanup there.

Please proceed with `superpowers:subagent-driven-development` to execute the plan task-by-task (Task 1 through Task 4), committing after each task exactly as the plan specifies. Report back after each task commit rather than waiting until all four are done, so I can verify via `git show` before you continue to the next task.
