# Selectable Visual Style Presets Design

## Goal

Let a project choose one fixed visual style at creation time and make visual-prompt generation use that style consistently in every chapter while supplying the existing narrative-continuity context.

## Scope and constraints

- Supported visual styles are exactly `cinematic`, `anime`, `watercolor`, and `photorealistic`.
- New projects default to `cinematic`; legacy project reads also default to `cinematic` through the document schema.
- There is no post-creation style mutation route.
- The selected style directive is loaded from a versioned markdown preset and repeated verbatim in every visual-prompt request.
- The existing AI-authored `Previous style note` remains in the prompt as supplementary continuity context.
- Visual-prompt generation reads `coreQuestion`, `openingHook`, and the previous chapter's summary, avoidance list, and persistent facts. It does not read or write `openLoops`.
- Existing script presets and their generation prompts remain unchanged.

## Project data and client flow

`VISUAL_STYLE_IDS` and `VisualStyleId` are added beside `SCRIPT_PRESET_IDS`. The create request, persisted project document, and project detail contract each expose `visualStylePresetId` with a `cinematic` default. The project service maps the value explicitly into both the stored document and returned detail so the field is present for new and normalized legacy documents.

The New Project form imports the shared create schema as it does today, defaults the field to `cinematic`, and renders a select beside the script preset and AI provider controls. Labels are `Cinematic (điện ảnh)`, `Anime`, `Watercolor (màu nước)`, and `Photorealistic (ảnh thực)`.

## Visual style presets and packaging

Each style lives in `src/server/modules/script/ai/presets/visual-styles/<id>.md` with the existing frontmatter format and one non-empty `## Style` section. `visual-style-loader.ts` validates the requested and declared IDs, positive integer versions, and required section content, and resolves source and bundled directories using the same environment detection rules as the script preset loader.

The production preset-copy script recursively copies the four visual-style files into `dist/presets/visual-styles`. This keeps source and bundled workers behaviorally identical.

## Prompt data flow

`VisualPromptPromptInput` gains `visualStylePresetId`, `coreQuestion`, `openingHook`, `previousChapterSummary`, `previousAvoidRepeating`, and `previousPersistentFacts`. `buildVisualPromptPrompt` loads the selected visual preset and inserts the following user-message lines after `Language:`:

1. Required visual style directive.
2. Core question.

Immediately after the chapter heading it inserts opening hook, previous summary, avoidance items, and persistent facts, using `(none)` for null or empty values. The current `Previous style note` line stays unchanged after those fields. The prompt version includes the visual style preset identity and version so changes invalidate prompt caches and are auditable.

`generateVisualPrompts` computes `previousChapter` from the project chapter array by index. Chapter one receives null/empty previous context; later chapters receive only the preceding chapter's metadata. It passes the project visual style and root narrative fields for every chapter while preserving all existing retry, cancellation, style-note, and project-write behavior.

## Failure behavior

Malformed, missing, unknown, mismatched, or empty visual-style preset files produce the existing typed preset-invalid error. A missing bundled preset therefore fails before an AI request rather than silently falling back to another style. Contract validation rejects unknown style IDs and applies the default only when the field is omitted.

## Tests

- Load all four real style files successfully and validate unknown ID, malformed frontmatter, mismatched declared ID, and missing `## Style` errors.
- Assert create-contract default and unknown-value rejection.
- Assert the visual prompt includes the required style and preserves `Previous style note`.
- Assert all narrative context fields appear and null/empty values render as `(none)`.
- Assert visual-prompt orchestration forwards the selected style and root context, gives chapter one empty previous context, and gives later chapters the immediately previous chapter's metadata.
- Assert production copying places the visual-style files under `dist/presets/visual-styles`.
