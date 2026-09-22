# Module: script

**Purpose:** Generate and review chapter-based scripts with a provider-neutral AI client, then finalize approved chapters into project scenes.
**Owns collection(s):** none; chapter/history and scene writes remain owned by the project module.
**May import (via their index.ts only):** project
**Public API:** only what `index.ts` exports. Nothing else in this module may be imported from outside.

## Invariants
- Phase 3 Prompt 1 complete: shared contracts, project-owned chapter/history persistence, provider-neutral AI adapters, prompts, generation/regeneration/finalization service, explicit worker handler, project routes/SSE, edge coverage, typed client streaming API, and ReviewScriptPage are implemented and verified.
- The module may call the project module only through its public `index.ts`; it must not write the `projects` collection directly.

## Flow
- Generate chapters asynchronously through the `generate-script` job.
- Regenerate one chapter through inline SSE so token chunks can be cancelled by the client.
- Snapshot chapter state before mutations and retain the newest ten snapshots.
- Finalize approved chapters by asking the project module to replace scenes and advance project status.

## Chapter state machine

```text
pending ──approve──> approved
   │                    │
   └─regenerate──> generating ──success──> pending
                         └────abort/error──> needs-fix
needs-fix ──edit/regen──> pending or generating
```

## Regeneration and history
- Initial generation does not snapshot an empty chapter array.
- Existing-array mutations snapshot first; project-owned persistence prepends the snapshot and prunes to the newest ten.
- Regeneration uses inline SSE rather than the job queue because the user needs token-by-token preview and immediate AbortController cancellation; initial generation remains a job because it is a whole-project operation.

## Finalization
- Every chapter must be `approved`.
- Paragraphs become ordered scenes with fresh ULIDs, empty `visualPrompt`, deterministic integer duration distribution, and at least one scene per chapter.
- Chapter metadata/history is persisted before the final scene write; `replaceProjectScenes(projectId, scenes, 'assets')` atomically updates scenes and project status.

## AI abstraction
- `src/server/shared/ai/` owns the `AiClient` interface, DeepSeek/OpenAI-compatible adapter, Claude adapter, and provider factory.
- Provider keys remain server/worker-only; the client receives only project/provider metadata and job/SSE results.

## Known pitfalls
- Keep the shared chapter schema in `contracts/script.ts` to avoid a project-to-script import cycle.
- Preserve the existing project status vocabulary (`assets`, `rendered`) unless an explicit migration is approved.
- Use the existing job context (`isCancelled`, `appendLog`) and registry location in `src/worker/registry.ts`.
- AI keys are server-only; absent keys warn when an adapter is constructed and provider streams honor `AbortSignal`.
- Finalization updates scenes and `assets` status atomically through `replaceProjectScenes`; chapter metadata/history is persisted before that final scene/status write.
- The script handler is structurally compatible with `JobHandler` without importing the job module, so the module boundary remains enforced.
- Routes receive job enqueueing from the app composition root and distinguish normal request-body close from an actual SSE response disconnect.
- Edge coverage verifies ten-snapshot pruning, restore bounds, duration rounding, malformed-stream errors, and the absence of a false successful `done` event.
- The client parser buffers split SSE frames and uses fetch/ReadableStream plus AbortController for regeneration; page rendering remains intentionally untested without a DOM dependency.

## Acceptance
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass; Vitest reports 77 passed and 3 stub files skipped.
- `mongodb-memory-server` ran successfully; no fallback was required.
- Built worker logged startup and graceful SIGINT shutdown.
- `eslint.config.js` was unchanged; only `openai` and `@anthropic-ai/sdk` were added as direct runtime dependencies.
