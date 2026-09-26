# Task 31 — design approved

Approve. Go ahead and implement.

One small note, not a blocker: for the "duplicating a project" behavior you
mentioned (clearing customStyleReferenceFileId on duplicate since files stay
source-project-owned) — please double check duplication is already
copy-by-reference for other file ids like bgmFileId/renderFileId today, so
this stays consistent with existing behavior rather than introducing a new
rule. If it already works that way for those fields, nothing to change —
just confirm in your report.

Otherwise the design matches what I asked for. Go ahead and implement, then
report back with commit hash(es) and test results as usual.

**STOP after this report.**
