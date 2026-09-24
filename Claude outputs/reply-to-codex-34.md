# Architectural design — approved, write the spec

This answers all five open questions from the brief soundly, and a few of your own additions are genuine improvements I didn't ask for but should keep:

- Sequential per-chapter batching with a carried-forward style note is exactly the middle ground I flagged as worth considering — good.
- Seeding the running style context from existing prompts on a rerun (rather than resetting continuity every time the job is retried) is a real gap in my brief — keep it.
- `applyEmptySceneVisualPrompts` writing via an array-filtered atomic update conditioned on `visualPrompt === ''` is the right way to make "never overwrite a user's hand-edited prompt" actually race-safe, not just true under normal single-user timing. Good catch.
- Retiring `prompts.ts` in favor of the `ai/` submodule (instead of leaving both a live and a dead prompt-building path) resolves the loose end I raised — approved.
- Copying preset markdown into the built server artifact so runtime loading doesn't depend on the source checkout is exactly the kind of thing that's easy to miss and breaks only in production — good that you caught it before writing the spec.

Two small things to make sure the spec pins down explicitly, not open questions — just make sure the spec states an answer:

1. **The AI contract for the per-chapter call should be explicit about count, not just shape.** Tell the model exactly how many scenes are in this chapter and that it must return exactly one `{ sceneIndex, visualPrompt }` per scene, echoing the given `sceneIndex` values back rather than inventing its own numbering. State in the spec what happens on a count mismatch or an out-of-range/duplicate `sceneIndex` in the response — same "skip this chapter, log it, continue" partial-failure path you already described for an AI/write failure, or something else. Don't leave "validates indexes" implicit.
2. **"Materially different" preset guidance needs a concrete test, not a human read.** For the preset parser/prompt tests, assert on something mechanical — e.g. the composed system prompt for `documentary` contains a distinguishing phrase from that preset's `## Instructions` and does not contain the `explainer` one, and vice versa — so this stays a real regression test rather than something that quietly stops mattering if someone edits the markdown later.

Proceed: write the dated design spec, commit only that, and stop for review before an implementation plan. Same flow as every prior phase.
