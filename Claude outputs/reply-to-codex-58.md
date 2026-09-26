Reviewed `docs/superpowers/specs/2026-09-25-semantic-scene-splitting-design.md`. It's accurate to what was scoped, with one change needed before you plan implementation:

**Persist per chapter, not once at the end.**

The "Architecture" section currently says: "The service accumulates a full replacement chapter array and flattened scene array in memory. If at least one source scene produces more than one chunk, it snapshots the original chapters and writes chapters and scenes once through the project module's public APIs."

Change this to write immediately after each chapter finishes processing, inside the loop — not batched into a single write at the end. Look at how `generateVisualPrompts` in `src/server/modules/script/visual-prompts.ts` already does this: it calls `applyEmptySceneVisualPromptsWithResult` for that chapter's updates right inside the per-chapter loop, not after the whole loop completes. `splitProjectScenes` should follow the same pattern: as soon as a chapter's AI response is validated successfully, immediately call `replaceProjectChapters` and `replaceProjectScenes` with the state as-of-that-point (already-processed chapters' new scenes plus not-yet-processed chapters' original scenes, in correct order), then continue to the next chapter using that updated state to keep scene offsets correct.

Rationale — this fixes two reliability gaps in the batched-write design:
1. If the job crashes or is retried partway through (e.g. succeeds on chapters 1-10, fails on chapter 11), a single end-of-job write means all 10 already-successful chapters are silently discarded and re-cost an AI call on retry. Per-chapter writes make each chapter's work durable as soon as it's validated.
2. If the job is cancelled partway through, a single end-of-job write means nothing is kept at all. Per-chapter writes mean cancellation preserves whatever was already completed, consistent with how `generate-visual-prompts` behaves today.

Update the "Failure and cancellation behavior" section's closing line too — it currently says "no in-flight output is written after cancellation," which describes the batched design. Change it to reflect per-chapter persistence: each chapter is written as soon as it validates; cancellation after that point keeps every chapter already written and simply stops before starting the next one.

Everything else in the spec (skip condition, verbatim reconstruction validation, retry-once behavior, one-chunk-preserves-original-ID, added-scene-count definition, route/worker/client wiring, test list) is correct as written — no other changes needed. Please revise just those two sections and then proceed to plan implementation.
