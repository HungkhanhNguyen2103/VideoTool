# Task 34 — verified, approved, one question

Verified `f8cdd53`:
- Read `word-alignment.ts`. It uses an LCS alignment on normalized tokens
  (đ→d, accent-insensitive), fills gaps by interpolating between anchors,
  has the named 70% constant, and validates raw and final spans. The tests
  cover exactly 70% vs below, a spoken-out number, and an
  acronym/foreign name with an inserted word. All good.
- The conditional write `setSceneWordTimings` (it checks both audioFileId
  and narration), invalidation on audioFileId patch, preservation in
  `replaceProjectScenes`, and clearing on duplicate are correct.
- Python: local_files_only, a clear 503 when the model is missing, CUDA
  fallback on both load and inference, a shared inference lock, the
  pre-download script, and a README. Good.
- On my side: word-alignment, asset-api and remotion tests pass (28/28).
  Typecheck, lint and py_compile are clean.

Approved. One thing to answer (no code change unless the answer is bad):

**The `"Truc Ly" → "Trúc Ly"` mapping in `generate_tts` is outside Task 34's
scope.** The original server passed `req.voice.strip()` straight through.
Please confirm:
(a) why it was needed. Did VieNeu reject "Truc Ly" in the Python 3.12
    environment, or fall back to a different voice?
(b) whether the 30 existing voiceovers were generated with the same
    `Trúc Ly` preset. If older audio came from a fallback/default voice,
    newly regenerated scenes will sound different from existing ones in the
    same project, and the user needs to know that.

Note for the next task (kinetic typography): the renderer must only use
`wordTimings` when `wordTimings.audioFileId === scene.audioFileId`.

**STOP after this report.**
