# Follow-up design approved

Approved as written. It covers all four points in `reply-to-codex-31.md`, and keeping the regeneration, restore and finalize snapshot paths unchanged is correct.

One precision on point 1: "only when `paragraphs` or `title` changes" should mean the value actually differs from the stored chapter, not just that the field is present in the patch body. The prototype's `saveEdit()` does the same thing: it compares `paragraphs.join('\n\n')` before and after, and it doesn't push a version or reset approval when nothing changed. So:

- A manual save with identical text should not create a snapshot.
- Ideally it also shouldn't reset an approved chapter to `pending`. Today `normalizedPatch` forces `pending` whenever `paragraphs` is present. If you tighten that too, include it in the service tests. If you'd rather keep this commit narrow, the snapshot rule alone is fine; just say which way you went in the report.

Proceed with the single commit and report the hash.
