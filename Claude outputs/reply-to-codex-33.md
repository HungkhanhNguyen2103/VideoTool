# Design brief: make script presets actually shape generation, and auto-suggest visual prompts

The Duyệt & Tái Tạo UI work is done and accepted. This is the next piece of work: the script module (`src/server/modules/script/`) has two real gaps found by reading the code directly, not reported by a user. Please write a design spec for both — no implementation yet — following the same design → review → plan → implement flow as every prior phase.

## Gap 1: `scriptPresetId` does nothing

`buildScriptPrompt()` in `src/server/modules/script/prompts.ts` passes only the literal string `"documentary"` or `"explainer"` into the user prompt as `Script preset: {id}`. The AI never sees any actual guidance tied to that preset. The scaffold for real preset content already exists but was never filled in:

- `src/server/modules/script/ai/presets/documentary.md` is a stub: `(describe role, tone, language)` / `(rules for narration length, scene pacing, how to phrase image ideas)`.
- There is no `explainer.md` at all.
- `src/server/modules/script/ai/build-prompt.ts`, `output-schema.ts`, `parse-output.ts` are all `export {}` — dead scaffold files from the first commit, never implemented. (Worth deciding in the spec: fold their intended responsibilities into `prompts.ts`/`service.ts` as they are today, or actually build out this `ai/` submodule and delete `prompts.ts`. Don't leave both half-existing.)

**Requirement:** the preset a project is created with should measurably change what the AI is asked to do — tone, pacing guidance, how much narration per chapter, style of scene/visual language — not just be a label stored on the project.

Starting content for the two presets (a real draft, not a placeholder — refine freely, but land somewhere real, not another stub):

**`documentary.md`** — for long-form narrated history/documentary scripts (the kind of project already in this repo: "Sự kiêu ngạo của Ô Mã Nhi...", Vietnam War documentaries):
- Role: a documentary narrator/scriptwriter who builds tension through pacing, not just fact recitation — open chapters with a hook or a stake, not a topic sentence.
- Tone: measured, authoritative, slightly dramatic; short declarative sentences mixed with longer explanatory ones; avoid academic hedging ("some historians believe") unless the uncertainty itself is the point.
- Structure: each paragraph should be speakable in one breath-group (roughly one screen of narration); avoid nested clauses that are hard to read aloud.
- Visual language: since each paragraph becomes one scene, phrase narration so a concrete image is implied by the sentence itself (specific people, objects, actions, places) rather than abstract summary — this is what makes downstream visual-prompt generation (gap 2) work well.

**`explainer.md`** — for shorter, direct explainer/how-it-works content:
- Role: a clear, friendly explainer, one idea per paragraph.
- Tone: plain language, second person where natural ("bạn sẽ thấy..."), minimal jargon, define terms on first use.
- Structure: shorter paragraphs than documentary, more of them; each should stand alone as a single beat.
- Visual language: prefer literal, diagram-friendly imagery (a process, a comparison, a before/after) over scenic narrative imagery.

The spec should say exactly how preset content reaches the prompt — e.g. `buildScriptPrompt()` reads and parses the preset markdown (frontmatter `id`/`version` already present) and folds its `## System`/`## Instructions` sections into the system prompt — and whether preset content should also influence `buildRegenerationPrompt()` for single-chapter regeneration (it should: a regenerated chapter drifting into a different tone than the rest of the script is a real risk called out separately in the weaknesses list below).

## Gap 2: every scene's `visualPrompt` is empty after finalize — the biggest real gap in the pipeline

`finalizeScript()` in `src/server/modules/script/service.ts` creates one scene per paragraph with `visualPrompt: ''`. The asset module's Google Flow export (`exportScenesJson`) sends that empty string straight into the `prompt` field of the JSON array pasted into Flow. On a real project (30–160 scenes per the asset-import ZIPs already handled), that means typing every visual prompt by hand in Studio before a single image can be generated — the most tedious step in the whole tool, and currently 100% manual with zero AI help despite the tool being AI-first everywhere else.

**Requirement:** after chapters are finalized into scenes, the system should propose a `visualPrompt` for every scene automatically, derived from that scene's narration (and enough surrounding context to keep characters/setting/style consistent across scenes), which the user can then review and edit in Studio exactly like today — this doesn't remove manual editing, it removes manual authoring-from-nothing.

Open design questions for the spec to answer (don't guess at these silently — pick an answer and justify it):

1. **When does this run?** `finalizeScript()` today is a fast, synchronous HTTP call that immediately navigates to Studio. Generating visual prompts for up to ~160 scenes is multiple AI calls and will not be fast. Options: (a) keep `finalizeScript()` exactly as-is and add a separate, explicit, job-based action ("Generate visual prompts", analogous to how voiceover/SFX/BGM generation are already jobs in the video module) that the user triggers from Studio once scenes exist; (b) make finalize itself a job that does scene-splitting and visual-prompt generation together, changing the "instant transition to Studio" behavior. Recommend (a) — it doesn't regress an already-working, tested flow, and it matches the existing pattern of AI generation as an explicit, cancellable, progress-visible job rather than something hidden inside another action.
2. **Batching strategy.** One AI call per scene (simple, but loses cross-scene visual consistency — no shared sense of what a recurring character or location looks like — and is a lot of round trips for 160 scenes) vs. one call per chapter with the chapter's full narration (fewer calls, more consistent within a chapter) vs. one call for the whole script (best consistency, but risks hitting context/output limits on a long script and losing per-scene precision in a single giant JSON response). A middle ground worth considering: per-chapter calls, each given a short running "visual style note" (recurring characters/setting/palette) carried forward from the previous chapter's result, so consistency degrades gracefully instead of resetting every chapter. Pick one, explain the token/consistency tradeoff you're accepting.
3. **Where does the write happen?** `visualPrompt` lives on `SceneDoc`, owned by the `project` module (`applySceneAssets`/`patchProjectScene` are the only sanctioned writers per `AGENTS.md`'s module rules). This generation feature itself is a script/asset-domain concern, similar to how the `video` module generates voiceover/SFX without owning those fields directly. Decide which module hosts the new service/job/route (script or asset both border this reasonably) and confirm it writes scenes only through `project`'s public API, never `getCollection('projects')` directly — same boundary rule as every prior phase.
4. **Failure/partial-completion behavior.** If the batch job fails partway (AI error on chapter 4 of 6), do the first 3 chapters' scenes keep their generated prompts while the rest stay empty, or does the whole job roll back? Recommend partial success — same pattern as voiceover generation continuing after one scene fails, per `MODULE.md`.
5. **Idempotency.** Can a user re-run this after already generating/editing some prompts by hand? It should never silently overwrite a `visualPrompt` the user has already edited by hand — needs a way to know "was this scene's prompt AI-generated-and-untouched vs. user-edited" (a boolean flag on the scene, or simply: only fill scenes where `visualPrompt === ''`, and re-running only touches the still-empty ones). Recommend the simplest version — only ever fill empty prompts — unless you see a reason it's insufficient.

## Explicitly out of scope for this round (real issues, but separate work)

- Tying narration length/pacing to `targetDurationSec` (currently the AI only sees a raw second count with no per-second word-count guidance, and scene duration is split evenly across paragraphs regardless of actual length — this is somewhat mitigated by voiceover generation overwriting `durationSec` later, so it's lower urgency).
- Giving `regenerateChapter` the project brief and neighboring chapters as context (currently it only sees the one chapter being regenerated, which risks tone/continuity drift — worth a future pass once preset content, from gap 1, gives it more to anchor on).
- Validating the AI's returned chapter count against the requested `chapterCount` (cheap to add, low risk, feel free to fold into this same commit if convenient, but not the point of this round).

## What to send back

A design spec (same format as prior phases) covering both gaps, your answers to the five open questions in gap 2, and the preset content (use my drafts as the starting point, adjust as needed for what actually produces good output — you have more visibility into real AI output quality than I do from a design brief). I'll review the spec before any implementation plan gets written, same as always.
