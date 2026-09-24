# Next brief (queue after the current phase): long-form safety, provider selection, manual/semi-auto generation

This is a new design brief, not part of the in-progress preset/visual-prompt work. Finish that phase (design → plan → implement, currently mid-implementation) first — this brief deliberately reuses `ai/build-prompt.ts` and `ai/parse-output.ts` from that phase, so starting it before those land would mean building on a file that's about to be deleted (`prompts.ts`) or restructured. Once phase 6 is accepted, write a design spec for the three items below — same design → review → plan → implement flow as always.

## Context confirmed by reading the code directly

- `generateScript()` (`src/server/modules/script/service.ts`) is already a job (`generate-script`, registered in `worker/registry.ts`, enqueued from `routes.ts`), but its handler (`src/server/modules/script/handler.ts`) only wires `appendLog` — no `reportProgress`, and `isCancelled` is checked once before the single AI call, not during it. `ReviewScriptPage.tsx` already tracks the returned `jobId` through the same `useJobProgress` infrastructure `StudioPage` uses.
- `createClaudeClient()` (`src/server/shared/ai/claude.ts`) defaults to `max_tokens: 4_096` when the caller passes no `maxTokens` — and `generateScript()` calls `aiClient.chat([...])` with no `opts`. So a long multi-chapter script generated with the Claude provider is capped at 4096 output tokens today, not just "eventually risks truncation" — that's a concrete, current ceiling. DeepSeek's call also passes no `maxTokens`, so it falls back to whatever `deepseek-chat`'s API default is.
- `aiProvider` already exists end-to-end in the data model (`ProjectDocSchema.aiProvider`, `CreateProjectRequestSchema.aiProvider`, `getAiClient(project.aiProvider)` in both `generateScript` and `regenerateChapter`) but is **not exposed anywhere in the UI**. `NewProjectForm.tsx` hardcodes `aiProvider: 'deepseek'` in its default values and never registers a field for it — confirmed by grepping for `register(` calls in that file. So this is a UI gap, not a data-model gap.
- The render-engine selector is the exact precedent to copy for a provider selector: `RENDER_ENGINE_OPTIONS` in `src/client/features/asset/api.ts`, `setProjectRenderEngine` in `project/service.ts`, and the button group in `StudioPage.tsx` that calls it. Do the same shape for `aiProvider`.
- The "copy JSON, do the AI/manual step outside the app, bring the result back" pattern already exists for the Flow/asset pipeline: `copyJson()`/`exportScenesJson()` in `StudioPage.tsx`/`asset/service.ts`, paired with "Import ZIP" to bring results back. The new manual script-generation mode below is the same shape, just text-in/text-out instead of a ZIP.

## Requirement 1: stop risking truncation on long scripts

Replace the single "one call returns the whole script" shape in `generateScript()` with a two-step call sequence inside the same `generate-script` job, reusing the sequential-per-chapter/cancellation/progress pattern already approved for visual-prompt generation (spec `c9a6965`):

1. **Outline call**: one AI call that returns only `[{ no, title }]` for every chapter — cheap, small output, effectively no truncation risk regardless of chapter count. This is the first time the "Dàn ý" stepper label will correspond to something the AI actually produces, rather than just naming the project-setup step.
2. **Per-chapter expansion calls**: for each outlined chapter, one AI call that returns that chapter's `paragraphs`, given the chapter title, the project brief/preset/language, and a short running style/continuity note carried from the previous chapter — the same continuity mechanism just designed for visual prompts. Write the design spec's answer for what happens on a per-chapter failure (recommend: same "skip, log, continue" partial-success shape as visual prompts, since a script missing one chapter's content is still recoverable via single-chapter regeneration, which already exists).

Decide and justify in the spec: does this replace the single-call path unconditionally for every project, or only above some chapter-count/duration threshold? Recommend unconditional replacement — no special-casing, consistent with how visual-prompt generation always batches per chapter regardless of scene count.

Wire real `reportProgress`/`isCancelled` into `handleGenerateScript`, matching the visual-prompt handler's cooperative-cancellation shape, since this is now multiple sequential calls instead of one.

## Requirement 2: expose AI provider selection in the UI

Two places, both driven by the existing `AI_PROVIDERS` constant (`deepseek`/`claude`) — no schema change needed, the field already exists:

- `NewProjectForm.tsx`: add a `<select>` registered to `aiProvider`, same shape as the existing `scriptPresetId` select at line ~204.
- A way to change it later, for a project that already exists, mirroring `setProjectRenderEngine`/`RENDER_ENGINE_OPTIONS` exactly: `setProjectAiProvider` in `project/service.ts`, exported through `project/index.ts`, a route, a client API function, and a button group (labeled "DeepSeek"/"Claude") on `ReviewScriptPage.tsx` near the generate/regenerate controls — so the user can switch provider before generating or before a specific regeneration, not just at project creation.

This selection only decides which `AiClient` `getAiClient(project.aiProvider)` returns — it doesn't touch Requirement 3's manual path, which bypasses our AI clients entirely.

## Requirement 3: manual/semi-automatic generation mode

Add a second way to run the initial script generation, selectable in the UI alongside the existing automatic path — not replacing it:

- **Tự động (automatic)**: today's flow, enhanced by Requirement 1's batching, calling whichever provider Requirement 2 selected.
- **Thủ công (manual/semi-automatic)**: a "Copy Prompt" action that copies the exact prompt text to the clipboard (build it from the same `buildScriptPrompt` used by the automatic path — one function, two callers, no duplicated prompt logic) so the user can paste it into Claude's own web chat by hand; then a "Paste kết quả" / import action where the user pastes the raw response back into the app. The app validates that text with the exact same `parseGeneratedChapters` schema/parser the automatic path uses and saves chapters through the same code path `generateScript()` uses today (`replaceProjectChapters`) — refactor the parse-and-save tail of `generateScript()` into a small shared function so both the job handler and this manual-import endpoint call one implementation, not two copies of the same logic.

Decide in the spec: does manual mode get its own single combined prompt (recommend: yes — the whole point of manual mode is that Claude's web chat isn't constrained by our `max_tokens`/API cost, so there's no reason to force the user through per-chapter copy/paste; keep Requirement 1's batching only for the automatic API path), and what the copy format looks like as a single pastable chat message (system + user content flattened into one block, still instructing JSON-only output). Also specify: is manual mode synchronous (no job, since there's no AI call happening on our server — recommend yes) and what validation error the user sees if the pasted text doesn't parse (recommend: same `SCRIPT_PARSE_ERROR` shape, shown inline, without discarding what they pasted so they can fix and retry).

## Explicitly out of scope for this round

- Manual/semi-automatic mode for `regenerateChapter` (single-chapter regeneration) — only the initial generation step, for now.
- Any change to `finalizeScript()`, scene creation, or duration-aware pacing (still a separate, already-deferred gap).
- A generic "bring your own prompt for anything" feature — this brief is specifically about the initial script-generation step.
- Increasing `DEFAULT_MAX_TOKENS` in `claude.ts` as a substitute for batching — that's a band-aid for one provider and doesn't fix DeepSeek or remove the real risk for very long scripts; batching is the actual fix.

## What to send back

A design spec covering all three requirements, your recommendation on each open question above (or a different answer, justified), and how the two-step outline/expansion job interacts with the existing `chapterCount` field (user-specified vs. AI-chosen) and with single-chapter `regenerateChapter` (should stay working exactly as it does today, unaffected by this change). Same review flow as every prior phase — I'll review the spec before any implementation plan.
