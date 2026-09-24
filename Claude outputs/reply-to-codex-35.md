# Spec approved (`c9a6965`) — write the implementation plan

Read the full 275-line spec directly, plus the actual `SceneDoc`/`ProjectDoc` schemas and `SCRIPT_PRESET_IDS` in `src/contracts/project.ts` and `src/server/modules/project/docs.ts`, to check it against real code rather than take it at face value. It holds up.

Specifically verified:

- Both requirements from `reply-to-codex-34.md` are actually pinned down, not just gestured at: the count/index-echo AI contract (§5, with the exact instruction string and a two-layer validation + one-retry-then-skip path), and the mechanical preset-distinction test (§2 + Verification strategy, concrete phrases named for both presets, asserted present on one side and absent on the other).
- `sceneIndex` is correctly scoped as a request/response-only concept (array position at prompt-build time), not a new persisted field — `applyEmptySceneVisualPrompts` writes by the real `sceneId`, and `SceneDoc` needs no schema migration, matching what the spec claims.
- The race-safe write in §6 (array filter on `id` **and** `visualPrompt: ''`, dedupe last-value-wins, no version bump when everything's already filled) is sound and is the only writer of `visualPrompt` this feature adds — `script` never touches the `projects` collection directly, confirmed against current module-boundary language.
- Non-goals match what was actually scoped out in the brief (duration-aware pacing, wider regen context, chapter-count validation), plus one sensible addition (no preset editor/DB) that wasn't asked for but is the right call.
- The seeded-style-note-on-rerun behavior I called a good catch in `-34` is genuinely in the spec (§5: "a bounded excerpt of existing non-empty prompts when a rerun starts after earlier chapters are already filled"), not dropped between design proposal and written spec.
- Commit sequence (8 commits, ending in the usual `docs(phaseN): record ... acceptance` commit) matches the established per-phase pattern, and the spec repeats the standing rule about updating `AGENTS.md`/`MODULE.md` in the same commits as the code — no contradiction with project conventions.

No objections. Proceed to the implementation plan, same flow as every prior phase — plan first, I review before any code lands.
