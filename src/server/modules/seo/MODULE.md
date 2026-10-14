# Module: seo

**Purpose:** Generate and store per-project YouTube packaging sections.
**Owns collection(s):** none; the project module owns the embedded `seo` package.
**May import (via their index.ts only):** project.

**Public API:** prompt/parser helpers, generation service, SEO router configuration, and thumbnail replacement/removal services exported from `index.ts`.

## Invariants

- AI output is validated before any project write; one validation retry is allowed.
- A generation request writes only the requested SEO sections and always records `generatedBy`.
- Thumbnail `imagePrompt` is a paste-ready generator prompt that already contains the overlay text; it is independent of the project's video visual style. The Studio/SEO UI copies it to Flow as is.
- Automatic generation constructs the AI client from the project's selected `aiProvider` and `aiModel`; the shared model registry supplies a provider default for legacy projects.
- The preset source is `ai/presets/seo-documentary.md`; its wording is reviewed (v6: hashtags chosen before tags, one pinned question, no mechanism spoilers, three A/B-testable thumbnail concepts with a desaturated-cinematic default, composition and safe-zone rules, and the overlay text inside the paste-ready prompt). Bump `version` in the frontmatter on any wording change.
- `POST /api/project/:id/seo/generate` enqueues `generate-seo` and returns an existing active job for the same project; the worker checks cancellation before invoking `generateSeoPackage`.
- Manual prompt/import and partial PATCH are synchronous; manual parse failures use `SEO_PARSE_ERROR` without replacing the pasted client text.
- SEO AI prompts use only active scenes for the opening excerpt and total duration. Chapter timestamps and generated descriptions advance over active-scene frames only; chapters with no active scenes are omitted and surfaced as a warning in the publish checklist.
- Thumbnail replacement stores a MIME-derived `.png`/`.jpg` file, points the project at it, then best-effort deletes the old file. Removal clears the project pointer before deleting the binary; project deletion also includes the thumbnail file in its app-level cleanup hook.

## Known gaps

- The reviewed SEO preset wording is not finalized yet, so automatic generation plumbing is implemented but content quality is not accepted as production-ready.
- Thumbnail metadata stores MIME/size but not pixel dimensions; the client displays the 1280×720 target and 2 MB limit, while a future pass can persist/validate dimensions for a stronger checklist.
