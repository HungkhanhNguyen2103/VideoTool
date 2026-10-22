# Task 116 — Channel analytics overview

## Goal
Add a first-class “Phân Tích Kênh” sidebar route with a stored-data overview of every local channel, plus safe sync-all queueing.

## Work
1. Add strict overview/sync-all contracts and route behavior; reuse stored daily data, connection summaries, channel health, ranking, quota checks, and `youtube-sync` jobs.
2. Add client API/query support, pure display helpers, responsive overview cards, OAuth import/channel-management actions, route-aware navigation, and the per-channel back link.
3. Update YouTube module/routes documentation and the `AGENTS.md` status line; run requested gates and write the untracked report.

## Commits
- `feat(youtube): channels overview and sync-all endpoints`
- `feat(youtube): analytics menu and channels overview page`

## Constraints
Work on `main`, no push or worktree, preserve existing untracked files, stage no temp files, use English in code and Vietnamese in UI.
