# Task 115 — SEO Progress and Layout Plan

1. Extend `seo-ai.test.ts` first for ordered progress, Vietnamese event logs, retry/failure/cancellation, and 30-second heartbeat timing. Implement the step sequence and bounded heartbeat in `src/server/modules/seo/service.ts`; verify the SEO server suite.
2. Add `seo-generation-progress.ts` and pure helper tests. Build the `GenerationProgress` panel, wire cancel and dismissal in `SeoPage.tsx`, and verify SEO/client/shared suites.
3. Rework `Toolbar.tsx` and its CSS into stacked-label control rows. Reflow the channel list header and columns in `ChannelManagerDialog.tsx` and its CSS. Check the required viewport widths where browser control allows.
4. Update module guidance and `AGENTS.md` in each code commit. Run the requested focused suites, typecheck, lint, and build; perform disposable live generation/cancel checks where available.
5. Write the untracked task report and make the two requested commits on `main`, staging only files for each commit. Do not push.
