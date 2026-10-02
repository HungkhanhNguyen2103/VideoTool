# Task 36 — stop tracking .env.example

The user wants `.env.example` ignored by git. `.gitignore` already lists
`.env.example`, but the file is still **tracked**, and gitignore has no
effect on tracked files. So:

1. `git rm --cached .env.example` — this untracks it but **keeps the local
   file**. Do NOT delete the working-tree file.
2. Confirm `.env.example` is still listed in `.gitignore`. It is, so no edit
   should be needed.
3. Commit only that removal: `chore: stop tracking .env.example`.
4. Verify: `git status` shows no `.env.example` entry, `git check-ignore -v
   .env.example` reports the .gitignore rule, and the local file still
   exists.

Note: this removes the file from GitHub for future clones. Earlier commits
still contain it, but I checked and those versions only have blank key
values, so no secret is in history.

Report the commit hash and the verification output.

**STOP after this report.**
