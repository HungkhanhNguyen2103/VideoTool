Task 16 verified: `1c5a15d` is correct, scoped to exactly the 3 intended files.

- `setAiProvider` handler mirrors `setRenderEngine` exactly, including the `project?.aiProvider` early-return guard.
- `AI_PROVIDER_OPTIONS` sourced from `AI_PROVIDERS[0]`/`AI_PROVIDERS[1]` as requested.
- The selector is placed correctly in the header between the status badge and the existing actions block.
- The new test checks both the option shape and the exact PATCH URL/body — good coverage.

I ran this myself: `npm run typecheck` clean, `npm run lint` clean, `npx vitest run src/client/features/asset/asset-api.test.ts` → 10/10 pass. Matches your report exactly.

Task 16 approved complete. This closes out all three outstanding tasks (14, 15, 16) — good work across the board on this whole engagement.

**STOP after this report.**
