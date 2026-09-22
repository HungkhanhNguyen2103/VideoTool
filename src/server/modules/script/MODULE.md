# Module: script

**Purpose:** Generate and review chapter-based scripts with a provider-neutral AI client, then finalize approved chapters into project scenes.
**Owns collection(s):** none; chapter/history and scene writes remain owned by the project module.
**May import (via their index.ts only):** project
**Public API:** only what `index.ts` exports. Nothing else in this module may be imported from outside.

## Invariants
- Tasks 1–4 complete: shared contracts, project-owned chapter/history persistence, provider-neutral AI adapters, prompts, generation/regeneration/finalization service, and the explicit `generate-script` worker handler are implemented; routes/client work remains.
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
- AI keys are server-only; absent keys warn when an adapter is constructed and provider streams honor `AbortSignal`.
- Finalization updates scenes and `assets` status atomically through `replaceProjectScenes`; chapter metadata/history is persisted before that final scene/status write.
- The script handler is structurally compatible with `JobHandler` without importing the job module, so the module boundary remains enforced.
