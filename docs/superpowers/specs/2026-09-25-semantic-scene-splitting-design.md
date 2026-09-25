# Semantic Scene Splitting Design

## Goal

Allow a finalized project to optionally split existing narration scenes into visual beats without changing any narration text.

## Scope and constraints

- The feature runs only through a queued `split-scenes` job after scenes have been finalized.
- The AI selects cut points only. It does not author narration.
- Every returned chunk set must reconstruct its source narration after both values are trimmed and whitespace runs are collapsed to one space.
- A chapter with any asset, voiceover, SFX, or visual prompt is skipped before an AI call.
- A single returned chunk preserves the existing scene object exactly, including its ID.
- A multi-chunk response creates fresh scene IDs and initializes every downstream field to the same empty values used by script finalization.
- The existing finalize flow and visual-prompt job remain unchanged.

## Architecture

The script AI boundary gains a `SceneSplitBatchSchema`, parser, and prompt builder. The prompt supplies project and chapter context plus each project-global scene index and full narration. Its system instruction requires exact contiguous text chunks, exhaustive index echoes, and no textual modification.

`splitProjectScenes` reads a project through the public project API and slices scenes by `chapter.scenesCount`, using the existing visual-prompt indexing model. For a candidate chapter it calls the configured provider, parses the response, validates the exact index set and verbatim reconstruction, and retries exactly once on a parse, schema, index, or reconstruction validation error. A second validation failure records a chapter-local failure and processing continues.

The service maintains the current replacement chapter array and flattened scene array in memory. As soon as a chapter's AI response validates successfully, it immediately snapshots the original chapters when needed and writes chapters and scenes through the project module's public APIs from inside the per-chapter loop. Each write contains already-processed chapters' new scenes and not-yet-processed chapters' original scenes in project order; the next iteration reads this updated state so its scene offsets stay correct. Unchanged, skipped, and failed chapters retain their original objects in those arrays. `splitScenes` measures added scene count: for every split source scene it adds `chunks.length - 1`.

The script route reuses finalized-scene readiness validation and enqueues `split-scenes`. The worker registers a handler with the same cancellation and context mapping as visual-prompt generation. Studio exposes a disabled-while-busy `Tách nhỏ scene` action using the existing job progress pattern.

## Data and validation

The AI response is `{ scenes: [{ sceneIndex, chunks }] }`, where indexes are positive integers and each chunk is a nonempty string. The response must include each supplied index once and only once.

For each returned item, the service joins its chunks with one space, normalizes all whitespace in that value and the source narration, trims both, and compares them. Any mismatch is a typed `SCRIPT_PARSE_ERROR`, so it follows the same retry behavior as invalid visual-prompt batches.

For each multi-chunk source, replacement scenes use trimmed chunks, word-based duration estimation, `assetType: 'image'`, empty visual/SFX prompts, and null asset/audio/SFX file references. The containing chapter's `scenesCount` and `durationSec` are recomputed from the resulting scenes.

## Failure and cancellation behavior

Project-read, provider, or write failures are isolated to the active chapter where possible and recorded in the job log. A malformed or text-altering provider response receives one corrected retry; after that, the chapter remains untouched and its number appears in `failedChapters`. Each validated chapter is persisted immediately; cancellation preserves every chapter already written and stops before the next chapter begins.

The final job result is `{ splitScenes, skippedChapters, failedChapters }`. The job emits chapter-based rounded progress and a final summary log.

## Tests

- Validate and parse the new split response schema.
- Verify a successful multi-scene chapter preserves narration after reconstruction, creates the expected scenes, durations, and chapter totals.
- Verify altered narration retries once, then fails only that chapter without persistence.
- Verify downstream scene data skips a chapter without calling the provider.
- Verify a one-chunk response retains the exact original scene ID/object.
- Verify route readiness rejection and successful `split-scenes` enqueue.
- Verify registry dispatch maps job payload and context, and respects pre-cancellation.
