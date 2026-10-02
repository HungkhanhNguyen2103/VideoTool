# Module: seo

**Purpose:** Generate and store per-project YouTube packaging sections.
**Owns collection(s):** none; the project module owns the embedded `seo` package.
**May import (via their index.ts only):** project.

## Invariants

- AI output is validated before any project write; one validation retry is allowed.
- A generation request writes only the requested SEO sections and always records `generatedBy`.
- The preset source is `ai/presets/seo-documentary.md`; its production wording is intentionally a placeholder pending content review.
