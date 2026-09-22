# Module: script

**Purpose:** Generate and review chapter-based scripts with a provider-neutral AI client, then finalize approved chapters into project scenes.
**Owns collection(s):** none; chapter/history and scene writes remain owned by the project module.
**May import (via their index.ts only):** project
**Public API:** only what `index.ts` exports. Nothing else in this module may be imported from outside.

## Invariants
- Design only: implementation is pending review of `docs/superpowers/specs/2026-09-22-phase3-script-design.md`.
- The module may call the project module only through its public `index.ts`; it must not write the `projects` collection directly.

## Flow
- Generate chapters asynchronously through the `generate-script` job.
- Regenerate one chapter through inline SSE so token chunks can be cancelled by the client.
- Snapshot chapter state before mutations and retain the newest ten snapshots.
- Finalize approved chapters by asking the project module to replace scenes and advance project status.

## Known pitfalls
- Keep the shared chapter schema in `contracts/script.ts` to avoid a project-to-script import cycle.
- Preserve the existing project status vocabulary (`assets`, `rendered`) unless an explicit migration is approved.
- Use the existing job context (`isCancelled`, `appendLog`) and registry location in `src/worker/registry.ts`.
