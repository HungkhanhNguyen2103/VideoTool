# Task 47 — Commit the pending fixes cleanly (no behavior change)

I verified your last two fixes independently (Task 46 ffprobe try/catch, Task 45 mammoth/pdf-parse +
`pdf-parse/lib/pdf-parse.js` import): both are correct. They are still UNCOMMITTED — `git log` HEAD is
`66acd10`. This task only gets them into history cleanly. Do not change any code.

## Step 1 — diagnose line endings on YOUR machine first (report the output)
From the repo root run:

```
git config --show-origin core.autocrlf
git status --short | wc -l
git diff --stat | tail -3
```

Context: when I look at the same folder from a Linux shell, git reports ~80 modified files, but
`git diff --ignore-cr-at-eol --stat` shows only 9 files with real changes (the other ~71 differ only
by CRLF vs LF; HEAD blobs are LF). That may be an artifact of my Linux view (if your Windows git has
`core.autocrlf=true` it will show only the real files). Paste your three outputs in the report.

## Step 2 — only if your `git status` ALSO shows the ~70 line-ending-only files
Add a root `.gitattributes` containing exactly:

```
* text=auto eol=lf
```

Then confirm `git status --short` lists only the real changes. Do NOT run `git add --renormalize .`
or rewrite files in bulk. If your git already shows only the real files, skip this step entirely and say so.

## Step 3 — commit only the real changes, as two commits (stage files by name, never `git add -A`)

Commit A — `fix(asset): skip corrupt videos during ZIP import`
- `src/server/modules/asset/service.ts`
- `src/server/modules/asset/asset.test.ts`

Commit B — `fix(file-store): extract reference text with mammoth and pdf-parse`
- `src/server/modules/file-store/reference-text.ts`, `reference-text.test.ts`
- `src/server/modules/file-store/project-import.ts`, `project-import.test.ts`
- `src/server/modules/file-store/routes.ts`
- `src/server/modules/file-store/pdf-parse.d.ts` (new)
- `src/server/modules/file-store/test-fixtures/` (new: the two .b64 fixtures)
- `package.json`, `package-lock.json`

Before committing B, review `git diff package-lock.json` (ignore line endings): it must add ONLY
`mammoth`, `pdf-parse` and their transitive dependencies. If it contains unrelated churn (other
packages' versions changed, platform-specific reshuffling), regenerate it: restore the committed
lockfile, then run `npm install mammoth@^1.13.0 pdf-parse@^1.1.1`. Do not commit `.gitattributes`
inside commit A or B — if you created it, make it its own third commit `chore: normalize line endings`.

`Claude outputs/` must not be committed (it is untracked working notes).

## Step 4 — stray `.git/index.lock`
A 0-byte `.git/index.lock` kept appearing in this repo. The cause was on my side (my git commands
ran on the shared folder without permission to delete their own lock). It is removed now and I will
run git with `GIT_OPTIONAL_LOCKS=0` from here on. If you ever see one again while no git process of
yours is running, tell me; do not spend time on it otherwise.

## Report back
- Output of the three Step-1 commands
- `git log --oneline -4` after committing
- `git status --short` after committing (should be clean except untracked `Claude outputs/`)
- `npm run typecheck`, `npm run lint`, and the three test files
  (`reference-text`, `project-import`, `asset`) run one more time on the final tree
