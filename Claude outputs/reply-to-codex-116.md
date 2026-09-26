# Task 35 — commit the leftover uncommitted files (housekeeping)

The user asked to commit what's still uncommitted. I audited `git status`.
Please make exactly the commits below, **using explicit paths only**.

## First: two things I already handled
1. **Stale lock came from my VM, not you.** My `git status` runs in a
   sandbox that can't delete files. git created `.git/index.lock`, couldn't
   unlink it, and left it stale (same cause as the Sep 25 one). I renamed it
   to `.git/stale-index-lock-from-claude-vm`. Please delete that file. From
   now on I use `GIT_OPTIONAL_LOCKS=0` for read-only git commands.
2. **`.env.example` contained real API keys** (DEEPSEEK_API_KEY and
   FREESOUND_API_KEY). The same keys are in `.env`, which is ignored.
   `.env.example` is tracked and the repo has a GitHub remote, so I blanked
   both values again. It now matches HEAD. **Do not commit `.env.example`**.
   It should show no content diff. The keys never entered git history (I
   checked with `git log --all -S`).

## Commit 1 — `chore: ignore Remotion bundle output`
Add `data/remotion-public/` to `.gitignore`. It contains ~48 untracked
`*.bundle.js(.map)` files, which are build output. Commit only `.gitignore`.

## Commit 2 — `docs: archive Codex task prompts and scene-splitting plan`
- `Claude outputs/reply-to-codex-55.md` … `reply-to-codex-116.md`. 55–65
  are already staged, 66–116 are untracked. Files 1–54 are already
  tracked, so this follows existing practice.
- `docs/superpowers/plans/2026-09-25-semantic-scene-splitting-implementation.md`
  (already staged).

## Do NOT commit
- **`lib/speech/audio.WAV`** (staged, ~835 KB). This is the voice reference
  clip. I'm asking the user first whether they want a voice recording
  pushed to GitHub. Leave it staged but out of these commits.
- **The ~70 other "modified" files.** On my side every one of them is a
  CRLF/LF-only difference (`git diff --ignore-cr-at-eol` is empty for all of
  them). Check on Windows. If they show as modified there too, confirm with
  `git diff --ignore-cr-at-eol --stat` that they are line-ending-only, and
  leave them out. Don't commit a line-ending rewrite. Just report what you
  see, and we can add a `.gitattributes` later as a separate decision.
- Anything under `data/`.

## Report
The 2 commit hashes and `git show --stat` for each. `git status` afterwards.
Whether the CRLF-only files appear on Windows.

**STOP after this report.**
