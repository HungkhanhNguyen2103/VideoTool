# Task 109 — Channel-aware SEO v2 report

Commit: `97e5fca93f0a44cf5b75632265766ac6075ceb80` — `feat(seo): channel-aware packaging and description v2` (local `main`, not pushed).

## Implemented

- Added `descriptionKeywords` with an 800-character limit and empty-string legacy default. Description generation and manual import persist it with the intro; the UI exposes an editable field and previews the assembled description with a word count and soft 150–300 word hint.
- Bumped `seo-documentary` to v8. The four-part thumbnail template now lives under `## Thumbnail template`; one sentinel in Instructions is replaced only by a matching assigned channel’s trimmed override, otherwise by the preset default. The channel prompt block includes only name, handle, tagline, language, and JSON default hashtags. Missing assigned channel records are treated as absent.
- Added deterministic parsing for numbered HTTP(S) references, including supported title/URL forms, URL deduplication, punctuation trimming, and an eight-source cap. Description assembly now orders intro, keywords, chapter timestamps, sources, channel links, footer, disclosure, and hashtags; it removes complete sources and then keywords blocks if over 5,000 characters and reports any remaining overflow.
- Added channel-aware hashtag merging to generation and manual import. Interpretation: keep the first three AI hashtags, then append channel defaults, then remaining AI hashtags; normalization removes tag duplicates and caps the result at 15. Defaults occupy an available visible slot when fewer than three leading AI hashtags survive normalization.
- Added channel, sources, AI-content reminder, and conditional description-length checklist entries. AI-content remains unticked and is rendered as a neutral reminder. Markdown export includes the assigned channel and assembled description. SEO imports `channel` through its public index; the dependency table, ESLint boundary, and SEO/project/channel module docs were updated.

## Tests added or changed

- Added `src/contracts/seo-sources.test.ts` for accepted formats, invalid/unmarked lines, HTTP(S) handling, punctuation, title preservation, deduplication, and the eight-item cap.
- Extended `src/contracts/seo-format.test.ts` for assembly ordering/localized source headers, omission and trimming order, remaining overflow, checklist items, and hashtag ordering/normalization/capping.
- Extended `src/server/modules/seo/seo-ai.test.ts` for prompt v8, channel fields, template override behavior, and the no-channel regression. The v7 template block fixture was copied from `git show 5664444:src/server/modules/seo/ai/presets/seo-documentary.md`; tests pin its exact default wording and verify no `Channel:` line plus equal system prompts for no channel and an empty override.
- Extended `src/server/modules/seo/seo-routes.test.ts` for channel-aware manual prompts/imports and missing-channel fallback; extended `src/server/modules/project/seo-storage.test.ts` for generated keyword persistence. Updated `src/server/modules/project/docs.test.ts` so the legacy package expectation includes `descriptionKeywords: ''`.
- Added client detail-channel API/hook coverage and new DescriptionPanel/PublishPanel tests for the query, assembled word-count guidance, editable keyword field, and neutral reminder rendering. Extended SEO view/package tests for channel output, reminders, and length state.

## Verification

- Focused required set: `npx vitest run src/contracts src/server/modules/seo src/server/modules/channel src/client/features/seo src/client/features/channel` — 26 files passed; 125 tests passed. Expanded cross-module set including `src/server/modules/project`: 31 files passed, 1 skipped; 166 tests passed.
- Full: `npm test` with `MONGOMS_SYSTEM_BINARY=C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe` — 111 files passed, 1 skipped; 1,342 tests passed, 1 skipped.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; existing Vite chunk-size warning remains.
- Review round 1 regressions: description checklist requires a non-empty intro even when chapters/hashtags are assembled; omitted AI keywords remain absent through parsing and storage, preserving existing user text, while an explicit empty string clears it. Staged tree passed `git diff --cached --check`; only the 36 Task 109 paths were staged.

## Unverified

- 1920×1080 browser acceptance on a disposable project: unverified because CUA returned no available apps or browsers (`apps: []`, `browsers: []`). No original project was edited.
- Real AI-provider generation: unverified; no provider call was made.
- No merge or push was performed. Pre-existing unrelated untracked work was left untouched.

## Files in the commit

- `AGENTS.md`, `eslint.config.js`
- `src/contracts/seo.ts`, `src/contracts/seo.test.ts`, `src/contracts/seo-format.ts`, `src/contracts/seo-format.test.ts`, `src/contracts/seo-sources.ts`, `src/contracts/seo-sources.test.ts`
- `src/server/modules/seo/MODULE.md`, `src/server/modules/seo/service.ts`, `src/server/modules/seo/routes.ts`, `src/server/modules/seo/seo-ai.test.ts`, `src/server/modules/seo/seo-routes.test.ts`, `src/server/modules/seo/ai/build-prompt.ts`, `src/server/modules/seo/ai/output-schema.ts`, `src/server/modules/seo/ai/parse-output.ts`, `src/server/modules/seo/ai/presets/loader.ts`, `src/server/modules/seo/ai/presets/seo-documentary.md`
- `src/server/modules/project/MODULE.md`, `src/server/modules/project/docs.test.ts`, `src/server/modules/project/seo-storage.test.ts`, `src/server/modules/project/service.ts`
- `src/server/modules/channel/MODULE.md`
- `src/client/features/channel/api.ts`, `src/client/features/channel/api.test.ts`, `src/client/features/channel/hooks.ts`, `src/client/features/channel/hooks.test.ts`
- `src/client/features/seo/SeoPage.module.css`, `src/client/features/seo/SeoPage.tsx`, `src/client/features/seo/seo-view.ts`, `src/client/features/seo/seo-view.test.ts`, `src/client/features/seo/seo-package.test.ts`, `src/client/features/seo/components/DescriptionPanel.tsx`, `src/client/features/seo/components/DescriptionPanel.test.tsx`, `src/client/features/seo/components/PublishPanel.tsx`, `src/client/features/seo/components/PublishPanel.test.tsx`