# AGENTS.md — video-tool

Read this first. It is the map of the project. Per-module details live in `src/server/modules/<name>/MODULE.md`.

## 1. What this is

A personal tool that produces videos in three stages: **write script → generate assets (images, voice) → render video**.
One Node.js/TypeScript **modular monolith** (single codebase, single package) run as two processes: a web server and a worker.
Data lives in **MongoDB**. Binary files (images, audio, video) live on disk; the DB stores relative paths only.

## Status

_Last updated: 2026-10-13 · Task 87 Remotion diagnostics implemented; Task 95.1 live layout and keyboard checks complete, replacement screenshot artifacts pending_

- Task 87 follow-up implements Remotion subphase diagnostics expected by the dirty baseline test: SDK frame-render and encode/stitch durations, estimated per-scene throughput from progress intervals, and slow-frame scene/feature mapping. Audio mixing is explicitly reported as unavailable separately in the SDK. Focused diagnostic regression passes; typecheck and lint pass. The full suite passes 950 tests with 1 skipped using the installed MongoDB 8.0 system binary; the prior `2.40s` timing assertion is resolved.
- Task 93 adds Claude Code CLI as a third Review & Tái Tạo regeneration mode. Claude Code 2.1.294 uses `--print --input-format text --output-format text --tools "" --safe-mode --no-session-persistence`, with an optional registry Claude model; prompts go through stdin from a fresh empty cwd, and the server writes bounded stdout to per-run audit files. Task 94 raises shared retention to 100 completed runs per project. A sequential cancellable job reuses the manual parser/import/history/quality path; the client reports CLI availability/auth, model, progress, cancel, and run-folder paths. Focused CLI/UI/job tests pass 58/58; typecheck, lint, and build pass. The full suite reports 914 passed, 1 skipped, and 1 failed: the pre-existing dirty Task 87 Remotion timing assertion still expects `2.40s`. Real acceptance on disposable duplicate `01M4GRCB8DWHSAXAY6W5H2T23J`: one chapter passed in 88.9s; three sequential chapters passed in 135.7s, 158.8s, and 145.0s; cancellation at 41s returned `cancelled` with no output/import for the in-flight chapter. Desktop and narrow-screen browser captures show CLI progress, completion, cancellation, and unavailable status. QA, outline, and initial chapter writing remain follow-ups.
- Task 94 keeps `generateScript` as the only outline/chapter pipeline and adds an injectable `ScriptChatBackend`, with API default and Claude CLI start/resume controls. CLI uses the existing bounded runner, 100-run retention, shared parser/retry/cancellation path, server-side Vietnamese availability rejection, and per-call prompt-byte/duration/audit-path logs; its model stays local to the job and leaves project AI settings unchanged. Persisted provider/model metadata was audited: CLI labels remain in job/audit metadata, without widening enums. Leading prose before JSON is recoverable/countable in generation and covered by fake tests. Active-job deduplication rejects backend, CLI model, or start/resume mismatches with a Vietnamese 409. Focused server tests pass 146/146 and client tests 54/54. Full verification: 937 tests passed, 1 test file skipped; typecheck, lint, and build pass (existing Vite chunk-size warning remains). Live acceptance on disposable Rạch Gầm data completed 7 chapters in 20:58 with 9 CLI calls, one outline repair, no length retries, and 0 preambles; cancel/resume preserved the saved outline, and forced unavailability returned HTTP 503 without enqueue. Analyzer comparison and call metrics are in `data/files/.verification/task-94/real-run-report.md`; screenshots are captured at 1280×900 and 390×844 in the same folder.

- Task 95.1 Task 1 aligns the first-time API/CLI/manual generation panel and the New Project script configuration. At 1920×1080, 1440×900, and 1280×900, API and CLI action rows align; duration and chapter inputs share a row. They stack at 390×844 without horizontal overflow. Task 1 focused tests passed 30/30; final Task 95.1 focused coverage passes 41/41.

- Task 95.1 review correction restores the shared `AiModelSelect` in chapter regeneration (`ai-model-select`, `Model AI`, and `label — hint` options), restores the CLI selector's `claude-cli-model` id/label, and keeps the Model field hidden but reserved in manual mode. Long CLI helper text exposes its full value through `title` and `aria-label`. Studio cards use the original scene → audio → video → render DOM/tab sequence with independent CSS columns at desktop and one column below 1100px. Rendered-selector and layout regression tests pass 49/49; typecheck, lint, and production build pass (existing Vite chunk-size warning). The full suite passes 948 tests with 1 skipped across 76 passed files and 1 skipped file when using the installed MongoDB 8.0 system binary. Live keyboard, requested chapter-box screenshots, box-height/button-row measurements, and replacement full-resolution Studio/New Project captures remain pending until API, Vite, and MongoDB are running.
- Task 95.1 Task 2 balances the Studio Scene/Audio/Video/Render content without a shared grid row height; the cards keep their original scene → audio → video → render DOM order, use desktop multicolumn flow, and stack into one column below 1100px. Task 3 adds concise verified explanations for provider/model/style, asset-type changes, video distribution, AI splitting/prompts, voiceover/timing, SFX/BGM, render engines/effects, depth maps, pop-up analysis, and draft renders. FFmpeg and Remotion were verified at 1920×1080, 1440×900, 1280×900, and 390×844; the 390px viewport has a 375px document/client width with no horizontal overflow. API and CLI mode geometry matches at every viewport; CLI was available as Claude Code 2.1.294 using a CLI sign-in session, so no unavailable-state screenshot was reachable. Review focus order advances by Tab from the selected manual mode to “Lấy prompt” with a visible focus outline. New Project duration/chapter controls align at desktop and stack on mobile. Before/after and final captures are under `data/files/.verification/task-95-1/`. Accessibility identifier sets from the Task 94 baseline are preserved. Focused tests pass 41/41; typecheck and lint pass. The full suite passes 943 tests across 75 files, with 1 test skipped and 1 file skipped, when `mongodb-memory-server` uses the installed MongoDB 8.0 binary (`MONGOMS_SYSTEM_BINARY`); the default MongoDB 8.2.6 download failed its MD5 check and caused test-hook timeouts. Production build passes with the existing Vite chunk-size warning above 500 kB.

### Works today (verified)
- Task 91 adds a quality analyzer, source-grounded outline validation, per-chapter and total word budgets, sequential generation with truncation/length retries and resumable saved outlines, plus shared continuity context for regeneration and QA. Manual imports report length and source-coverage summaries without blocking. Focused Phase 3 suites passed 160/160. On the integrated tree, the full suite has 891 passed, 1 failed, and 2 skipped; the sole failure is the existing SPA fallback assertion in `src/server/app.test.ts` (expected 200, received 404), reproduced on the Task 89 checkout before this merge. Typecheck, lint, and build pass; Vite reports the existing client chunk-size warning above 500 kB.
- Task 91 live acceptance used DeepSeek `deepseek-chat` on an 840-second Rạch Gầm duplicate: 18 provider requests (1 outline, 1 JSON repair, 7 initial chapter requests, 9 length retries). The analyzer measured 2,108/2,100 words (+0.4%); 29/30 source facts were detected. Unsupported candidates fell from 12/221 (5.4%) at baseline to 6/268 (2.2%), while maximum chapter deviation rose from 70.2% to 90%, repeated cross-chapter 6-grams from 2 to 10, near-duplicate pairs from 0 to 1, and long sentences from 6.6% to 8.1%. Resolution share was 16.2% against a 10% target. The baseline narration was not retained, so a qualitative read-through comparison is unavailable.
- Task 91 cancellation/resume was verified on disposable copies: generation stopped after 3/7 chapters, then resumed at chapter 4 with zero outline requests and completed the remaining chapters. The browser showed the resume button, but its click did not dispatch in that session; the route was used for the live resume check. Manual import showed a non-blocking 42/2,100-word warning. Screenshots at 1280×900 and 390×844 are under `data/files/.verification/task-91/`; direct-route captures show “no project open” in the app shell. The database had no distinct existing 14-minute manual source document.
- Task 90 adds per-provider model selection across New Project, Review, Studio, and SEO. Provider/model clients are cached separately; legacy projects resolve a provider default without migration. DeepSeek Chat JSON mode and DeepSeek Flash regeneration/Final QA were live-verified on duplicate data. Claude was not live-tested because `ANTHROPIC_API_KEY` was not configured.
- Task 89 adds severity-filtered bulk QA patch/regeneration with cancellation, chapter-level progress, batch history snapshots, and guarded undo. Ordinary chapter failures continue; structured hard-stop provider errors stop later chapters. Undo checks predicted revision, version CAS, and post-run chapter equality. The existing dirty Task 87 Remotion timing assertion was not included in this clean integration worktree.
- Task 91 analyzer baseline report: `data/files/.verification/task-91/baseline-auto.md`; `baseline-manual.md` records the missing manual source without fabricated metrics. Task 91 after-run report: `data/files/.verification/task-91/after-auto.md`.
- Task 88 constrains the Review & Tái Tạo `Lịch sử phiên bản` card: the heading stays fixed while the list scrolls within `max-height: min(60vh, 30rem)`, the desktop card is capped at 22rem and returns to full width below 1200px, and the list has a small right gutter plus thin token-colored scrollbar. The Rạch Gầm project with Bản 11 was verified in real browser captures at 1280×900 and 390×844; opening starts at Bản 11/Hiện tại, and focusing the last Khôi phục button scrolls the list. The focused ReviewScriptPage suite passes 22/22; typecheck, lint, and build pass. The full suite passes 809 tests with 1 failed and 1 skipped because the pre-existing dirty `src/server/modules/video/remotion.test.ts` timing-log assertion still expects `2.40s`.
- Config validation, JSON error shape, `/api` 404, malformed-JSON 400, `/files` 404 and SPA fallback remain covered by the suite (760 tests pass, 1 skipped; the pre-existing `project` todo file is skipped). Typecheck and lint (incl. module boundary rules) pass.
- Task 78 adds client-only per-scene render previews: render-time fingerprints and first-field stale reasons, engine-specific content notes, in-dialog result/error/retry states, session-only object-URL cleanup, a completion toast, and a scene-card `Preview render` badge with `Xem asset gốc`. Focused preview/component tests pass 10/10; the full suite passes 715 tests with 1 skipped; typecheck, lint, and build pass. Real-page acceptance covered a Remotion video scene and image scene, blocking progress, result players, the toast, card restore, and narration stale warning on Rạch Gầm in the available ~507×635 in-app viewport. Exact >=1280px and 900px browser captures, forced failed-render state, and FFmpeg browser state remain unverified. Mock captures are under `data/files/.verification/task-78/`; Remotion bundle time remains ~12s of ~27s per preview and the renderer was not changed.
- Task 79 changes short video padding to clone the first frame at the START of the scene: Remotion holds a keyframe or clip frame 0 before playback, while FFmpeg uses a measured/probed start clone pad and exact scene trim. Pure planner, readiness, fingerprint, renderer, and UI regressions are covered; the full suite passes 718 tests with 1 skipped, and typecheck, lint, and build pass. Real FFmpeg verification confirms 0.5s/2.5s are the first frame and 4.9s is clip playback; frames are under `data/files/.verification/task-79/`. A real Remotion video preview, player, card `Preview render` badge, `Xem asset gốc`, and `Clip được đệm` state were verified in the available ~680×612 in-app viewport. Exact >=1280px and 900px captures and the transient completion toast remain unverified. The keyframe visually matches the source first frame but is not pixel-identical; legacy `videoTailFileId` remains in schema/project/import data only and is not staged or rendered. Remotion bundle time remains ~12s of ~27s per preview and the renderer orchestration was not changed.
- Task 80 adds conservative generic name-prefix detection for lower-third popups: geography prefixes become place labels, event/polity prefixes stay unpinned, sentence-start prefixed names are allowed, role phrases remain subtitles, and dedupe uses the bare capitalized run. Focused keyword tests pass 24/24; the full suite passes 722 tests with 1 skipped; typecheck, lint, and build pass. Real Rạch Gầm word timings were compared before/after; `sông Tiền` now renders as `Sông Tiền` with place role and starts at the prefix word.
- Task 81 is a measurement-only DeepSeek evaluation using a standalone script and three real `deepseek-chat` requests over the first 40 of 44 Rạch Gầm scenes with narration. Validated AI candidates were acceptable in 39/40 scenes versus 32/40 for rules; the hybrid result was 40/40, validation rejected 0/79 candidates, and first-accepted phrase disagreement was 8/40 scenes (20%). Outputs are local under `data/files/.verification/task-81/`; no production behavior, schema, route, UI, or renderer changed, and the legacy model's billing cost is unknown from the current official pricing page.
- Task 82 persists validated AI name/place candidates per scene, selects AI candidates before rules with cross-scene duplicate skipping, and exposes fresh/stale/unanalysed counts plus the selected source in Studio. After narration edit, the old record remains stale and popup is `—`; after new voiceover/alignment, rules are used while still stale; explicit analysis refreshes AI selection. The prompt uses temperature 0 (DeepSeek request-body serialization is verified with fake fetch), Claude JSON mode is propagated when requested, and equal-importance candidates are tie-broken by first appearance. Only malformed JSON retries once; schema failures do not retry, and a valid empty result clears prior candidates while provider/parse/all-rejected failures preserve them. Two post-tie-break real Rạch Gầm runs had identical renderer keyword arrays; only `Xiêm` category metadata differed in scenes 32 and 38, without changing popups. Re-analysis can vary in ambiguous ties, while persisted records keep output stable between analyses; the original pre-tie-break three-scene raw pair was not retained. Real TTS/alignment, refreshed analysis, Studio captures at 1280×900 and 900×800, a request-paused overlay, and a Remotion `Sông Tiền` lower-third were verified under `data/files/.verification/task-82/`; Scene 01 was restored after smoke. Focused tests pass 219/219; full suite 762 passed, 1 skipped; typecheck, lint, and build pass.
- Task 84 Parts B/C allow scene durations to two decimals, store each mastered WAV's probed duration, apply the editable per-project 0.2s tail without trimming, and provide a render-guarded recompute action for existing voiceovers. Remotion, FFmpeg segments, and SEO chapter timestamps share per-scene whole-frame rounding; FFmpeg constrains each segment to that frame count. Studio shows one-decimal durations and flags tails not yet applied. Part C raises the name lower-third to 0.17 landscape / 0.21 portrait and bounds its landscape width away from the bottom-right logo. Latest full suite: 780 passed, 1 failed, and 1 test file skipped; the lone failing test is the existing SPA fallback assertion in `src/server/app.test.ts` (expected 200, received 404). Typecheck, lint, and build pass. The live API health check is now reachable; real measurements, popup audit, and screenshots remain pending. No popup-selection behavior changed.
- Task 85 makes Freesound SFX search structured, query-aware, voice-rejecting, capped at 15 candidates and three distinct queries per scene, rate-limited to 1.1s with bounded retries/Retry-After and batch stop after three consecutive persistent 429 scene failures. Studio can retry only missing SFX; selected sound provenance and per-scene failures are in job logs/results. SFX is normalized on temporary render copies to -16 LUFS/-1.5 dBTP before applying project `sfxVolume` (default 0.5); FFmpeg uses `amix=normalize=0` (local FFmpeg supports it; module documents minimum 4.4), and Remotion receives the same project factor. Fake-fetch/clock, fake-FFmpeg, renderer, route, worker, project and client tests cover the behavior. Focused tests pass 193/193; latest full suite: 807 passed, 1 failed, 1 skipped; the isolated `src/server/app.test.ts` SPA fallback assertion still expects 200 and receives 404. Typecheck, lint, and build pass. Synthetic local tone tests measure short/long normalization at -16 LUFS, with -15.7/-15.3 dBFS peaks. MongoDB/API were unavailable, so real diagnosis/before-after SFX counts, battle examples, real-media ebur128 checks in both engines, and Studio screenshots are pending. `/apiv2/search/text/` remains behind one named constant pending a real `/search/` parameter-equivalence request.
- `CreateProjectRequestSchema` (contracts/project.ts) validates title/brief/duration/chapterCount/renderSettings and produces the exact Vietnamese messages from `docs/prototypes/khoi-tao-du-an/app.js`; checked with a throwaway (uncommitted) script, not a committed test.
- `titleSearch` normalization (`modules/project/title-search.ts`) matches the prototype's `norm()` (accent-insensitive), same throwaway script.
- `npm run build` succeeds end to end: `vite build` (client bundle) and `tsup` (server.js, worker.js) both complete with no errors. This is the first time the full build has been exercised.
- Windows acceptance verified against the installed MongoDB 8.0 service at `127.0.0.1:27017`: `GET /api/health` returned `{ ok: true, db: true }`, project CRUD persisted in MongoDB, and the current-project fallback survived a reload.
- Browser acceptance verified at `http://localhost:5173/production/init` with a 1440px viewport: invalid submit focused the first field and made no DB write; draft/outline creation, reload persistence, accent-insensitive search, status filtering, duplicate, confirmed delete, and delete fallback all worked.
- `npm run typecheck`, `npm run lint`, `npm test` (101 passed, 2 skipped), and `npm run build` all pass on Windows. The client bundle contains no server environment/API-key identifiers.
- Phase 3 final review fixes are covered by 81 passing tests: legacy project reads apply defaults for new script fields, chapter regeneration preserves concurrent edits, paragraph edits reset approval, empty scripts cannot be saved/finalized, and the client prevents overlapping regeneration streams with lifecycle abort cleanup.
- Versioned documentary/explainer preset loading and the production Markdown copy step are implemented and verified.
- Script generation and regeneration use preset-aware, versioned prompts in the script `ai/` boundary. Generated chapters, regenerated paragraphs, and visual batches share JSON parsing with 422 `SCRIPT_PARSE_ERROR` behavior.
- Script Task 4 processes finalized scenes sequentially by chapter with stable project-global scene indexes. It validates the exact returned index set, retries one parse/schema/index failure, writes through the project-owned empty-only mutation, preserves existing prompts, seeds a bounded style note from existing project prompts, reports per-chapter progress, isolates chapter failures, and discards responses when cancellation is observed. The project-owned companion returns atomic pre-image changed IDs for exact job counts while the original wrapper still returns `ProjectDetail`.
- Script Task 5 exposes `POST /api/project/:id/scenes/generate-visual-prompts` with finalized-scene readiness validation and registers `generate-visual-prompts` explicitly in the worker; route/worker focused tests (45) plus typecheck and lint pass.
- Script Task 6 adds the Studio `Tạo visual prompt` action, typed client API, and enqueue-gap-safe project-job predicate; the focused asset API tests, typecheck, and lint pass.
- Script Task 7 pins the mechanical documentary/explainer distinction, exact visual-batch index/count retry contract, rerun style seeding, cancellation/race behavior, and route/worker/client regressions; the focused suite has 106 passed, typecheck/lint pass, and the full suite has 252 passed with 1 skipped.
- Phase 6 Task 4 is complete: the generate-script worker now persists a validated outline and expands chapters sequentially with progress, cancellation, one short-response retry, and later-chapter continuation after failures. Later Phase 6 route/UI/acceptance work remains.
- Phase 7 Task 1 adds additive chapter narrative metadata, project `openLoops`/`motif` defaults, the `hubris-trap` preset, and its New Project option; focused tests pass 52/52, typecheck/lint pass, and the full suite passes 255 tests with the pre-existing project todo skipped.
- Phase 7 Task 6 uses shared 150-WPM word counting for review estimates and finalization scene durations; the legacy even-split assertions were rewritten to exact per-scene `[1, 1, 2]` values. Focused duration tests pass 65/65, typecheck/lint pass, and the full suite passes 276 tests with the pre-existing project todo skipped.
- Phase 7 Task 7 adds client provider selection, automatic/manual generation controls, typed manual prompt/import APIs, preserved pasted text on import errors, and narrative metadata display. Client-focused tests pass 29/29; typecheck, lint, build, and full regression pass.
- Phase 7 acceptance adds the final regression matrix for preset distinction, motif/count validation, sequential outline expansion, provider/manual routes, cancellation/failure isolation, client controls, and word-based duration parity. The full suite passes 282 tests across 22 files with the pre-existing project todo skipped; typecheck, lint, build, packaging, secret-scan, and module-boundary checks all pass.
- Task 6/6 integration audit completes the Tasks 1-5 feature set: generation, continuity-aware regeneration, manual import/edit, word-based finalization, and manual read-only Final QA were traced end to end. The audit adds the missing N+1 `upstream-changed` marker for manual paragraph edits; full regression, typecheck, lint, and production build checks pass, with the pre-existing skipped project todo unchanged.
- Phase 8 Task 1 adds the standalone SEO & Đóng Gói Kênh prototype with automatic/manual modes, title/description/tags/comment/thumbnail panels, fact warnings, publish checklist, export actions, and simulated empty/generating/result/manual/error states. It was checked with Node syntax validation, Chrome headless screenshots at 1440px and 900px, and browser interactions; production SEO implementation remains gated on review.
- Phase 8 Task 2 adds the shared SEO package contract, named YouTube limits, canonical hashtag normalization/validation, legacy defaults, duplicate semantics, and atomic project-owned SEO mutations. Focused SEO/project tests pass 17/17; the full suite passes 638 tests with 1 skipped; typecheck and lint pass.
- Phase 8 Task 3 adds pure timestamp/description/limit/fact-guard helpers. Chapter starts use the same per-scene rounded frames as Remotion; transition layers do not shift starts. Focused format/parity tests pass 6/6; the full suite passes 644 tests with 1 skipped; typecheck and lint pass.
- Phase 8 Task 4 adds the `seo` module boundary, placeholder preset copied to `dist/presets`, pure prompt builder, snake_case output schema/parser, fixture coverage, and one validation retry with no write after repeated failure. Focused SEO AI tests pass 7/7; the full suite passes 651 tests with 1 skipped; typecheck and lint pass. Preset wording remains intentionally deferred for content review.
- Phase 8 Task 5 adds explicit SEO generation/manual-import/patch routes, the `generate-seo` worker handler, active-job deduplication, and project-owned PNG/JPEG thumbnail replacement/deletion with cleanup. Focused SEO route/worker tests pass 22/22; the full suite passes 659 tests with 1 skipped; typecheck and lint pass. Automatic SEO generation remains structurally ready but its preset wording is still a reviewed placeholder.
- Phase 8 content review replaces the SEO placeholder with `seo-documentary` v2 (fact-bound packaging rules, per-section guidance, thumbnail safety incl. keep-subject-out-of-lower-right). Prompt version is now `seo-prompt-v1/seo-documentary@2`; SEO AI and route tests updated; real-provider output quality is not yet verified.
- Phase 8 Task 6 replaces the SEO placeholder route with a production client page: automatic/manual controls, centralized Vietnamese title-angle labels, debounced section edits with blur/unmount flush, preserved manual JSON on errors, fact warnings, and thumbnail controls. Focused client helper tests pass 3/3; the full suite passes 662 tests with 1 skipped; typecheck and lint pass.
- Phase 8 Task 7 adds pure publish-readiness/checklist and Markdown export helpers, a Vietnamese-safe filename slug, copy/download actions, and render/thumbnail download links. Focused SEO helper tests pass 6/6; the full suite passes 665 tests with 1 skipped; typecheck and lint pass.
- Phase 8 Task 8 passes typecheck, lint, full tests (665 passed, 1 skipped), and production build. The SEO preset is present in `dist/presets/`, and the client bundle scan found no API-key/server-environment identifiers. Browser acceptance was exercised at the available 1280×720 in-app viewport for rendered-project manual prompt, valid import, Vietnamese invalid-JSON error with pasted text preserved, and Markdown download; exact 1440px/900px layout, thumbnail upload replacement/deletion, automatic provider execution, and a no-chapter project remain unverified in this environment.
- Task 69 regroups the Studio control area into Scene & hình ảnh, Âm thanh, Giao diện video, and Render & xuất cards without changing handlers, state, APIs, disabled rules, readiness logic, or query keys. Upload progress is shown beside the asset counter; Remotion-only effects remain rendered and are disabled with the FFmpeg note; the logo control is compact and horizontal. Typecheck, lint, full tests (665 passed, 1 skipped), and build pass. Browser verification covers Vasa with scenes at 1440px/1280px/900px, FFmpeg and Remotion states, with and without a temporary logo restored afterward, 0-scene project, ZIP upload progress, and job progress; screenshots are under `data/files/.verification/task-69/`.
- Task 70 fixes regeneration targeting so QA instructions apply only to their source chapter while user instructions remain bulk-scoped, disables regeneration with an empty selection, retries short automatic regenerations once when no length instruction was supplied, shows word-budget and upstream-review badges, warns before finalization when upstream changes remain, skips already-approved bulk-approval PATCHes, and clears upstream markers when approving or editing. Focused client tests pass 30/30 and 17/17; the full suite passes 674 tests with 1 skipped; typecheck, lint, and build pass. Browser verification and screenshots remain pending.
- Task 71 adds optional QA fix context with parser sanitation, versioned prompt guidance, session-only sorted/dismissible QA results, local patch previews with stale-result warnings, and regeneration fallback with change-level chips. Focused QA/client tests pass 73/73; the full suite passes 680 tests with 1 skipped; typecheck, lint, and build pass. Browser acceptance used an imported QA result on Bạch Đằng and captured the results panel, accepted patch, regeneration card, and collapsed low-severity group under `data/files/.verification/task-71/`.
- Task 73 adds a client-only self-contained QA fix dialog for regeneration and chapter details, with independent instruction/level/mode state, raw streaming preview, manual prompt/import, responsive focus/scroll behavior, baseline comparison, and guarded first-run undo. Focused chapter-action tests pass 41/41 and review-page source tests pass 20/20; the full suite passes 689 tests with 1 skipped; typecheck, lint, and build pass. Real-page screenshots for the imported QA result and dialog are under `data/files/.verification/task-73/`; automatic streaming, completed regeneration, and accepted/low-severity states remain unverified.
- Task 74 removes `reviewStatus` from the QA undo guard comparison so the expected next-chapter `upstream-changed` marker does not disable Hoàn tác; focused chapter-action tests pass 43/43; the full suite passes 691 tests with 1 skipped; typecheck, lint, and build pass.
- Task 75 places visible QA issue cards inside their owning chapters, adds severity-toned chapter chips and index buttons, auto-opens chapters with HIGH issues, and preserves unplaced issues in a top-panel fallback. Task 77 completes the in-chapter collapsible cards: the first sorted non-low card opens by default, later cards and low-severity cards start collapsed, acted-on cards stay open, and the unplaced fallback remains expanded. Focused chapter-action and review-page tests pass 70/70; the full suite passes 706 tests with 1 skipped; typecheck, lint, and build pass. Real-page browser verification was exercised on Rạch Gầm in the available ~1265×712 in-app viewport, including QA chapter chips, high-issue auto-opening, collapsed/expanded cards, low group, chapter index scrolling, patch acceptance, QA fix dialog, and dismiss/restore; screenshots are under `data/files/.verification/task-75/`. Explicit 1440×900 and 900×800 viewport captures and an out-of-range issue displayed in the client remain unverified because the server rejects out-of-range manual QA imports with `QA_CHAPTER_OUT_OF_RANGE`.
- Task 76 adds a shared native blocking progress dialog for long Studio operations and script/QA jobs, consistent Studio locking, stale-connection recovery, real percent/log/elapsed data, reduced-motion indeterminate progress, and confirmed cooperative job cancellation. Focused client tests pass 30/30; the full suite passes 703 tests with 1 skipped; typecheck, lint, and build pass. Browser smoke verified real Studio per-scene indeterminate progress and Review QA queued/cancelled states at the available ~698×612 in-app viewport; exact 1440×900, 900px, failed, lost-connection, ZIP, and real render states remain unverified. The mock is under `docs/prototypes/blocking-progress/`.
- Task 77 finishes Task 75 with stable-key collapsible QA cards, accessible expand/collapse controls, explicit hidden-body styling, and helper/source regression coverage. Focused chapter-action and review-page tests pass 70/70; the full suite passes 706 tests with 1 skipped; typecheck, lint, and build pass. Real-page browser verification was exercised on Rạch Gầm in the available ~1265×712 in-app viewport, including QA chapter chips, high-issue auto-opening, collapsed/expanded cards, low group, chapter index scrolling, patch acceptance, QA fix dialog, and dismiss/restore; screenshots are under `data/files/.verification/task-75/`. Explicit 1440×900 and 900×800 viewport captures and an out-of-range issue displayed in the client remain unverified because the server rejects out-of-range manual QA imports with `QA_CHAPTER_OUT_OF_RANGE`.
- Task 77 visual follow-up removes the duplicate QA chapter/location line so cards show one `Đoạn N` or `Toàn chương` label, and uses down/up chevrons for collapsed/expanded cards. Focused review-page tests pass 21/21; the full suite passes 706 tests with 1 skipped; typecheck, lint, and build pass.
- Task 72 makes QA quote matching NFC-aware and tolerant of curly quotes and non-breaking spaces without collapsing whitespace, adds explicit fallback reasons for ambiguous/missing quotes, and reserves space for the sticky review footer. Focused client tests pass 56/56; the full suite passes 684 tests with 1 skipped; typecheck, lint, and build pass. Browser smoke on Bạch Đằng verified curly-quote, NFD, duplicate-quote, structural, and footer states at the available ~522px in-app viewport; screenshots are under `data/files/.verification/task-72/`. Exact 1280px/900px viewport checks remain unverified because the in-app viewport was constrained.

### Modules
| Module | State | Notes |
|---|---|---|
| project | done | server: contracts + service/repo/routes plus chapter/history/SEO persistence, atomic scene/status/SEO replacement, public render-engine/logo mutation, empty-only AI visual-prompt batch mutation, and validated project AI model persistence; client: ProjectInitPage + form/list/dialog. Live MongoDB and browser acceptance verified on Windows; automated project-module tests remain intentionally omitted by request |
| script | done | Phase 3 Prompt 1, Phase 6/7, and Task 90 add the established script workflow, visual-prompt work, narrative metadata, and model selection; Task 91 Phases 0–3 add quality analysis, grounded outlines/manual warnings, resumable chapter writing through 20 minutes, and contextual regeneration/QA. |
| asset | done | Phase 4 complete: SceneDoc asset references, project-owned scene mutation APIs, Flow export, tolerant ZIP import, routes, integration tests, and Studio UI |
| video | done | Phase 5 Prompt 1 plus Prompt 2 and Task 67 complete: FFmpeg and Remotion renderers, cached bundle/public staging, atomic engine selection/logo routes, matching web/worker wiring, Studio media controls, Chromium integration, and build-isolation scan. Task 90 passes project-selected models into name/place analysis. FFmpeg ignores project logos. |
| job | done | Prompt 1 complete plus append-only logs/SSE extension |
| seo | partial | Phase 8 Tasks 2–8: shared package contract/storage, pure formatting, AI generation, routes/jobs, thumbnail handling, production client page, checklist/export, and build verification. Task 90 adds the selected project model to automatic generation and the SEO toolbar. Preset content is reviewed (seo-documentary v2); some browser acceptance remains open. |

State values: `stub` (files exist, empty), `partial` (some behaviour), `done` (implemented and tested).

### Endpoints implemented
Existing project/file/job routes were exercised against live MongoDB on Windows; Phase 5 video routes are covered by in-memory integration/HTTP tests and await live-browser/provider acceptance:
- `GET /api/health` -> `{ ok: true, db: true }`
- `GET /api/project` (query: `q`, `status`) -> `ProjectSummary[]`
- `POST /api/project` -> 201 `ProjectDetail`
- `GET /api/project/:id` -> `ProjectDetail` or 404
- `POST /api/project/:id/duplicate` -> 201 `ProjectDetail`
- `DELETE /api/project/:id` -> 204 or 404
- `POST /api/project/:id/files` -> 201 `FileSummary` or 400/404
- `GET /api/project/:id/files` -> `FileSummary[]` or 404
- `DELETE /api/project/:id/files/:fileId` -> 204 or 404
- `POST /api/project/:id/import-zip` -> updated `ProjectDetail` or 400/404/422
- `GET /api/project/:id/scenes/export-json` -> Flow scene JSON with attachment filename
- `POST /api/project/:id/scenes/import-assets` -> `{ updated, skipped }` with 400/422 errors
- `POST /api/project/:id/scenes/generate-voiceover` -> 201 `{ jobId }`
- `POST /api/project/:id/scenes/:sceneId/regenerate-voiceover` -> updated `ProjectDetail`
- `GET /api/project/:id/scenes/:sceneId/render-preview` -> `video/mp4` buffer
- `POST /api/project/:id/scenes/:sceneId/generate-sfx` -> updated `ProjectDetail`
- `POST /api/project/:id/scenes/generate-all-sfx` -> 201 `{ jobId }` (optional `{ onlyMissing }`)
- `PATCH /api/project/:id/sfx-volume` -> updated `ProjectDetail` (`{ sfxVolume }`)
- `POST /api/project/:id/generate-bgm` -> updated `ProjectDetail`
- `POST /api/project/:id/render` -> 201 `{ jobId }`
- `PUT /api/project/:id/logo` / `DELETE /api/project/:id/logo` -> updated `ProjectDetail`
- `POST /api/project/:id/seo/generate` -> 201 `{ jobId }` (or active job 200)
- `GET /api/project/:id/seo/manual-prompt` -> `{ prompt, promptVersion }`
- `POST /api/project/:id/seo/manual-import` -> updated `ProjectDetail`
- `PATCH /api/project/:id/seo` -> updated `ProjectDetail`
- `PUT /api/project/:id/seo/thumbnail` / `DELETE /api/project/:id/seo/thumbnail` -> updated `ProjectDetail`
- `PATCH /api/project/:id/render-engine` -> updated `ProjectDetail` (`{ engine: 'ffmpeg' | 'remotion' }`)
- `PATCH /api/project/:id/scenes/:sceneId` -> updated `ProjectDetail`
- `POST /api/project/:id/scenes/set-asset-type` -> updated `ProjectDetail`
- `POST /api/job/:id/cancel` -> current `JobSummary` or 404/409
- `GET /api/job/:id/events` -> SSE current state/deltas/heartbeats until terminal

Unknown `/api/*` returns JSON 404.

### Client screens
| Route | State |
|---|---|
| `/production/init` | implemented and browser-verified: NewProjectForm (react-hook-form + zodResolver, error summary, focus-first-invalid, duration chips, aspect->resolution) + RecentProjects (server-side search/status filter, debounced 300ms, open/duplicate/delete) + ConfirmDeleteDialog (native `<dialog>`) |
| `/production/:projectId/review` \| `/studio` \| `/seo` | ReviewScriptPage implemented for `/review`; Studio asset import/export/editor plus voiceover/SFX/BGM/preview/render controls implemented; SEO production page implements package editing, thumbnail upload, publish checklist, Markdown export, and download links |

### Run and verify
Task 91 is the latest verification: `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass on the isolated Task 91 worktree. Vitest reports 876 passed and 1 skipped; focused Phase 3 tests pass 160/160. The production build retains the existing non-blocking Vite chunk-size warning.
The Remotion integration rendered a non-empty one-second MP4 with `node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe`; FFmpeg/ffprobe are available as `C:\ffmpeg\bin\ffmpeg.exe` and `C:\ffmpeg\bin\ffprobe.exe`. The artifact scan found no Remotion composition code in built server/worker/client outputs. Vite emits a non-blocking client chunk-size warning above 500 kB.
- The post-review Remotion parity fix mutes embedded audio on source video scenes, and progress log writes are serialized and surfaced as controlled render failures instead of unhandled rejections; the focused Remotion suite passes 13/13.
- Remotion cleanup failures are logged without replacing the primary staging/render error.
- ReviewScriptPage now derives its production stepper from chapter/job state and uses the shared dark-theme tokens; four focused regression tests cover the state matrix and CSS token references.
- ReviewScriptPage records chapter-history snapshots only for actual paragraph/title edits, leaves decision-only changes out of content history, stops a regeneration batch after cancellation, and preserves an explicitly collapsed list across refetches.

### Known gaps / TODO
- Directly opening the prototype `file:///.../docs/prototypes/khoi-tao-du-an/index.html` was blocked by the browser automation URL policy, so the comparison used the fully read prototype source and matched the shared 1440px layout measurements (232px sidebar, 430px recent-project panel, no horizontal overflow). A direct visual side-by-side comparison remains unverified.
- No automated tests were added for the `project` module by explicit request; acceptance coverage is manual on Windows plus the existing suite.
- Generic reference-file upload still has no dedicated client screen; Studio Flow ZIP import is implemented for Phase 4.
- Tabs 2/3/4 are all gated on "there is a current project" (disabled otherwise) — the prompt only specified this rule for tab 2; extended it to 3/4 too since their routes require a `:projectId`. Flag if you want tab 1's gate rule only.
- Project chapter/scene writes now exercise the `version` increment and history snapshot paths; compare-and-swap remains a future enhancement because the current mutation APIs use targeted atomic updates without an expected-version parameter.
- A brief empty-list state can appear while TanStack Query fetches a newly selected status filter; the settled result is correct (`3/3` in the acceptance run). This is a loading-state polish item, not a data or API failure.
- The client hook's EventSource open/change/unmount lifecycle is not DOM-automated by design; its pure state transition is covered by Node tests and the hook is not consumed until Phase 4/5.
- Browser visual acceptance of the updated Studio engine selector at 1440px remains pending in this headless environment; API, real Remotion render, and build checks are green.
- Task 6 verified a real one-second image-only Remotion MP4 with local Chrome Headless Shell and no staged render leftovers; the artifact scan found no composition imports in server/worker/client outputs. Studio exposes mutually exclusive FFmpeg/Remotion choices, disables them while busy, refreshes project state on success, and preserves the prior state on failure.
- Live VieNeu and Freesound calls are not made in automated tests; provider adapters are covered with mocks, and an empty `FREESOUND_API_KEY` intentionally disables optional audio generation.
- Orphaned files after partial failures, re-imports, or project deletion are not garbage-collected; deferred by design.
- Task 67 adds a nullable per-project logo file, Studio upload/replace/remove controls, and a faint composition-level Remotion watermark; FFmpeg ignores the logo. Focused logo tests and the real Remotion verification script cover staging, z-order, aspect ratios, and cleanup.
- Phase 8 Task 1 remains a prototype reference under `docs/prototypes/seo-dong-goi-kenh/`; Tasks 2–8 now add reviewed production contracts, storage, pure formatting, placeholder AI structure, routes, jobs, thumbnail handling, the production client page, publish export, and build/browser acceptance evidence. Exact viewport, provider, and file-upload gaps are listed here.

### Decisions log (newest first, keep the last 15)
- 2026-10-02: Phase 8 Task 4 keeps the SEO AI preset as a frontmatter-validated placeholder until content review; the module validates snake_case output, normalizes only accepted hashtags, retries one schema failure, and writes no project section after repeated failure.
- 2026-10-02: Phase 8 Task 5 keeps SEO route handlers thin, deduplicates active generation jobs, checks cancellation before the worker generation path, and stores thumbnails with MIME-derived extensions before replacing/deleting the project pointer.
- 2026-10-02: Phase 8 Task 6 keeps the SEO UI server-state driven, centralizes title-angle labels, debounces PATCH writes while flushing on blur/unmount, and preserves pasted manual JSON when import fails. The preset remains a placeholder by design.
- 2026-10-02: Phase 8 Task 7 keeps publish readiness derived from current project/file data, exports generated chapter timestamps through the shared formatter, and treats missing checklist items as warnings while keeping copy/download actions available.
- 2026-10-02: Phase 8 Task 8 accepts typecheck/lint/full-test/build isolation and manual browser checks at the available 1280×720 viewport; automatic provider execution was not forced because the worker/external payload approval was rejected and the SEO preset remains a placeholder.
- 2026-10-02: Phase 8 Task 3 computes chapter starts from per-scene rounded Remotion frames; crossfade/wipe visual extensions do not move audio starts, so no transition overlap is added to chapter timestamps. YouTube readiness stays warn-only through an `{ok, reason}` result.
- 2026-10-02: Phase 8 Task 2 stores SEO as an additive embedded project package with zod defaults for legacy reads; duplicate projects retain generated text but clear the thumbnail file pointer, and section mutations increment project version once.
- 2026-10-02: Phase 8 Task 1 keeps SEO packaging as a standalone vanilla prototype until the UI gate is approved; the sample uses Điện Biên Phủ 1954 and treats fact warnings and chapter-readiness notes as warn-only.
- 2026-10-02: Task 67 stores one project-owned logo with purpose `logo`, replaces it by storing and pointing to the new file before best-effort old-file cleanup, removes it by clearing the project pointer before cleanup, and renders it once at Remotion composition level outside FilmLook; FFmpeg intentionally ignores the logo.
- 2026-09-23: Task 4 review fixes seed visual style from all existing non-empty prompts at job start; failed and skipped chapters preserve that context. `project.applyEmptySceneVisualPromptsWithResult` uses a single `findOneAndUpdate` pre-image to report exactly which empty prompts the atomic write filled; the original `ProjectDetail` wrapper delegates to it.
- 2026-09-23: Script Task 4 maps each chapter to a stable slice of the finalized project scene array, validates complete global-index echoes before any write, and retries only parse/schema/index failures once. It carries a maximum 500-character continuity note, counts only empty scenes filled by the project mutation, and stops on cooperative cancellation without writing an in-flight response.
- 2026-09-23: Script Task 6 adds the Studio visual-prompt enqueue action and tests `isProjectJobActive` for no job, the enqueue-to-progress gap, and terminal job states; the action stays disabled while a project job is active.
- 2026-09-23: Script Task 7 regression coverage asserts documentary contains `open a chapter with a hook` without explainer's `one self-contained beat`, and vice versa; it also covers the visual count-mismatch retry alongside missing, duplicate, extra, and out-of-range indexes.
- 2026-09-23: Script Task 3 makes `project.applyEmptySceneVisualPrompts` the sole added writer for AI visual prompts. It validates scene IDs, deduplicates last-value-wins, and uses a top-level empty-target predicate plus per-target array filters so manual edits win; no schema migration is needed. Mongo-backed script integration tests cover the public API while `project.test.ts` remains a todo.
- 2026-09-22: Phase 5 Task 2 keeps audio, SFX, BGM, and final-render writes in `project`; BGM mood/file and render file/status each update atomically with one version increment.
- 2026-09-22: Phase 5 Prompt 2 chooses copy-based Remotion staging into the effective bundle `public/` directory because `bundle()` snapshots its source public directory; this preserves bundle-once behavior without coupling renders to Express uptime.
- 2026-09-22: Phase 5 Prompt 2 implementation is split into seven sequential TDD tasks: scaffold/build isolation, project mutation, renderer/staging, route wiring, Studio selector, conditional integration, and acceptance docs.
- 2026-09-22: Phase 5 Prompt 2 Task 1 keeps `src/remotion` outside the Vite/tsup TypeScript graphs; server/client artifacts are checked for composition imports while the Remotion bundle remains an independent entry.
- 2026-09-22: Phase 5 Prompt 2 Task 2 keeps `renderEngine` writes in `project.setProjectRenderEngine`, with one version increment and no direct project-collection access from video code.
- 2026-09-22: Phase 5 Prompt 2 Task 3 caches one Remotion bundle per renderer process, stages generated media under bundle-output `public/renders/<renderId>/`, validates purpose/MIME/extension before copy, and awaits cleanup on every render path.
- 2026-09-22: Phase 5 Prompt 2 Task 4 mounts `PATCH /api/project/:id/render-engine` in the video router and passes the same configured Remotion public root through web `createApp` and worker startup.
- 2026-09-22: Phase 5 Prompt 2 Task 5 keeps the Studio engine selector typed through `contracts/project`, uses the new PATCH API, disables choices during mutations, and refreshes the persisted project after success.
- 2026-09-22: Phase 5 Prompt 2 Task 6 runs the Chromium integration under an explicit temp-file render lock so it cannot contend with the existing FFmpeg integration; the lock is test-only and leaves no file behind.
- 2026-09-22: Phase 5 Prompt 2 caches the Remotion bundle for the worker process lifetime, uses Remotion's default host-aware concurrency, and keeps SFX/BGM numeric volumes derived from the existing FFmpeg string constants.
- 2026-09-22: Phase 5 Prompt 2 places render-engine selection in the video router while the project service owns the atomic `renderEngine` mutation.
- 2026-09-22: Phase 5 Prompt 2 review fix mutes embedded source-video audio to match FFmpeg's explicit audio mapping and serializes/awaits Remotion progress-log writes so persistence failures remain controlled render errors.
- 2026-09-22: Phase 5 Prompt 2 cleanup diagnostics log staging/output removal failures while preserving the original render error.
- 2026-09-22: ReviewScriptPage fixes derive stepper progress from chapters/job state and replace undefined light-theme CSS fallbacks with the shared dark tokens; pure client regression coverage avoids adding a DOM dependency.
- 2026-09-22: Phase 5 Task 3 adds a plain-fetch VieNeu client with one retry, timeout/error mapping, FFmpeg mastering fallback, and ffprobe duration measurement; no TTS SDK or runtime dependency was added.
- 2026-09-22: Phase 5 Task 4 adds resilient Freesound search/download adapters and ports the Vietnamese keyword dictionary/reference query extraction verbatim; missing API key, no result, malformed response, and download failure all return null without throwing.
- 2026-09-22: Phase 5 Prompt 1 follow-up corrects Freesound matching order, delimiter splitting, two-word fallback queries, and first-seen deduplication to match the reference implementation exactly.
- 2026-09-22: Phase 5 Task 5 adds pure FFmpeg scene/concat/BGM builders, temporary-file cleanup, project-owned path resolution, and a documented Remotion 501 stub; the BGM second pass intentionally re-encodes the full video.
- 2026-09-22: Phase 5 Task 6 keeps generated binaries in file-store, patches scene/project metadata through project APIs, continues batch voiceovers after per-scene failures, and rejects renders with one-based `SCENES_NOT_READY` numbers.
- 2026-09-22: Phase 5 Task 7 mounts video routes explicitly under `/api/project`; project-wide voiceover/render work is queued as `generate-voiceover` and `render-full-video`, and handlers check cooperative cancellation before work.
- 2026-09-22: Phase 5 Task 8 runs real scene+BGM and short-video duration FFmpeg integration because `C:\ffmpeg\bin\ffmpeg.exe` and `C:\ffmpeg\bin\ffprobe.exe` are installed; no binary tests were skipped. Prompt 2 raises final acceptance to 154 passing tests with the existing project todo file skipped.
- 2026-09-22: Phase 5 Task 9 keeps Studio media URLs derived from MIME-checked `FileSummary` records, revokes preview object URLs on replacement/unmount, and exposes project readiness/job logs without adding client dependencies.
- 2026-09-22: Phase 5 Task 1 adds render/audio/SFX/BGM defaults, TTS/FFmpeg/Freesound config, five file purposes, audio MIME support, and ownership-checked `resolveFilePath`; no new dependency or boundary rule was added.
- 2026-09-22: Phase 5 Prompt 1 combined design spec includes VieNeu TTS, FFmpeg rendering, Freesound SFX/BGM, atomic file/project ownership, and a Remotion stub; implementation proceeded after the approved review.
- 2026-09-22: Final Phase 4 review fixes pass 101 tests (2 stub files skipped): ZIP enumeration/extraction failures map or skip safely, Studio uses dark design tokens and MIME-based previews with mismatch notice, and duplicated projects clear file references; browser Studio comparison remains a documented headless-environment gap.
- 2026-09-22: Phase 4 acceptance before final review passed 97 tests; the follow-up regression pass added malformed ZIP, duplicate-project, and MIME preview coverage without adding dependencies.
- 2026-09-22: Phase 4 Task 5 keeps `FlowSceneExport` in `contracts/asset.ts` so client code shares the route contract without importing the server asset module; Studio ZIP upload uses dependency-free XHR progress and preview URLs use validated `storedPath`.
- 2026-09-22: Phase 4 Task 4 treats `skipped[]` as an unordered membership list because `adm-zip` may enumerate entries in archive order; tests assert exact membership/count, not incidental order.
- 2026-09-22: Phase 4 Task 3 adds configured asset orchestration over `createFileStoreService`, root-level Flow ZIP parsing, image/video MIME/type checks, 200 MB upload middleware, and explicit `/api/project` route mounting; `eslint.config.js` remains unchanged.
- 2026-09-22: Phase 4 Task 2 keeps all scene writes in `project`; `applySceneAssets` deduplicates last-value-wins and applies dynamic array-filter `$set` paths in one versioned update.
- 2026-09-22: Phase 4 Task 1 adds defaulted `SceneDoc.assetType` (`image`) and `assetFileId` (`null`) for legacy reads, plus additive `FileSummary.storedPath` for client previews; no migration or `assetUrl` field is used.
- 2026-09-22: final review fixes normalize legacy project reads through `ProjectDocSchema` defaults, target only the regenerated chapter during generating/error transitions, force paragraph edits back to `pending`, reject empty scripts/finalizations, and abort/serialize client regeneration streams across unmount/project changes.
- 2026-09-22: review regression coverage uses a controlled concurrent chapter edit during an aborted stream; the unrelated chapter must survive while the target chapter becomes `needs-fix`.
- 2026-09-22: Phase 2 Task 6 will test a dependency-free job-event state transition helper in the existing Node Vitest environment; EventSource lifecycle wiring is manually verified because the hook has no Phase 2 consumer and adding jsdom/testing-library would expand dependencies.
- 2026-09-22: `jobs.cancelRequested` is persisted so a running handler can observe cooperative cancellation without another process releasing its worker lock.
- 2026-09-22: repository tests use `mongodb-memory-server` successfully on this Windows environment; no local MongoDB fallback was needed for Task 2.
- 2026-09-22: service-owned handler errors retry with `min(2 ** attempts * 1000, 30000)` until `maxAttempts`; unknown handler types fail terminally because the registry is explicit.
- 2026-09-22: SSE sends the current job state on the first poll (`lastState` starts undefined), then only changed state and heartbeat comments; terminal state closes the stream.
- 2026-09-22: worker loop drains claims in one tick but checks `closing` before every claim, uses a single in-flight tick guard, and recovers stale jobs every tick.
- 2026-09-22: client hook lifecycle wiring is manually verified in this phase; state transitions use a dependency-free helper test instead of adding jsdom/testing-library dependencies before the hook has a consumer.
- 2026-09-22: Phase 2 Prompt 1 acceptance uses `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, a forbidden-route/boundary scan, and a built-worker idle/startup/shutdown smoke run; no push was performed.
- 2026-09-22: job logs are append-only persisted strings and handlers write them through `JobContext.appendLog`; log SSE events will reuse the existing one-second progress poll.
- 2026-09-22: SSE log events use `lastLogIndex` on the existing poll, flush existing logs on connect, and the client accumulates them separately from main state events.
- 2026-09-22: file-store routes delegate scene replacement to `project.replaceProjectScenes`; only the project module updates `projects` with `$inc: { version: 1 }`.
- 2026-09-22: Multer `LIMIT_FILE_SIZE` maps to HTTP 400 `FILE_TOO_LARGE` in the shared error handler and is covered by a multipart route test.
- 2026-09-22: ZIP import requires root-level `scenes.json`, validates `SceneDoc[]`, and replaces scenes through `project.replaceProjectScenes` with a version increment.
- 2026-09-22: file-store remains shared infrastructure outside `eslint.config.js` module boundaries; only its own `files` collection is owned here, while project scene writes remain in the project module.
- 2026-09-22: `project.replaceProjectScenes` performs its own direct `projects.updateOne` and version increment; file-store routes call only that public project service API.
- 2026-09-22: Phase 2 Prompt 2 acceptance uses exactly four new packages (`multer`, `adm-zip`, `@types/multer`, `@types/adm-zip`); no UI wiring or static `/files` changes were added.
- 2026-09-22: search input in RecentProjects is debounced 300ms client-side before hitting the server (the prototype searches an in-memory array on every keystroke; a real HTTP call per keystroke would be wasteful).
- 2026-09-22: tabs 2/3/4 (Duyệt & Tái Tạo / Studio / SEO) are all disabled without a current project, not just tab 2 as literally specified, because their routes need `:projectId`.
- 2026-09-22: CSS Modules per component, global tokens+resets+small utility classes (`.label`, `.ic`, `.mono`, `.muted`, `.spacer`, `.sr-only`) in `styles/tokens.css` (loaded once); `.btn`/`.badge` variants live in the shared `ui/Button`, `ui/Badge` components instead of global classes.
- 2026-09-22: No automated tests for the `project` module in Phase 1 (user decision): skipped `test-utils/mongo.ts`, `factories.ts` and `project.test.ts`; user verifies manually on Windows and reports bugs.
- 2026-09-22: `docs/prototypes/khoi-tao-du-an/` and `duyet-tai-tao/` added to the repo under `docs/prototypes/` (were missing at repo creation).
- 2026-09-22: Search/list validation lives in one `superRefine` per contract schema (`contracts/project.ts`) instead of per-field zod checks, so each field surfaces exactly one Vietnamese message, matching the prototype's `validate()` behaviour.
- 2026-09-22: Chapters remain an embedded scene/chapter concern for Phase 1; a dedicated chapters model is deferred to Phase 3 (`chapters model (Phase 3)`).
- 2026-09-22: `NODE_ENV=production` (in `.env`) makes web serve `dist/client`; default is development (no cross-platform way to set it in `npm start`).
- 2026-09-22: API error body is `{ error: { code, message, fields? } }` (`contracts/common.ts`); server messages are Vietnamese because they surface in the UI.
- 2026-09-22: `react-hook-form` + `@hookform/resolvers@5` added (resolver supports zod 4; not yet exercised in code).
- 2026-09-21: `video-tool` is its own git repo (`.git` at its root, intentional). Commit only here, never push.
- 2026-09-21: verification runs in a Linux scratch copy because the committed `node_modules` is Windows-built.
- 2026-09-22: shared chapter/snapshot schemas live in `contracts/script.ts` and are re-used by project/script to preserve the one-way `script -> project` boundary.
- 2026-09-22: `replaceProjectScenes(projectId, scenes, newStatus?)` applies scenes and optional project status in one atomic update; script finalization will use `newStatus: 'assets'`.
- 2026-09-22: `CreateProjectRequest` is the zod input type so the defaulted `aiProvider` stays optional for existing callers; project service persists `deepseek` when omitted.
- 2026-09-22: AI adapters warn on missing provider keys at client construction and pass abort signals through provider request options; tests mock both SDKs and make no network calls.
- 2026-09-22: script parsing tolerates one optional JSON markdown fence for provider robustness, while still rejecting non-JSON/non-schema output with `SCRIPT_PARSE_ERROR` before any chapter write.
- 2026-09-22: finalization writes chapter metadata/history separately, then updates scenes and project status `assets` in one atomic `replaceProjectScenes` update as required by the implementation review note.
- 2026-09-22: script job handler uses a local structural context type instead of importing `job`, preserving the enforced `script -> project` boundary while remaining assignable to the worker's `JobHandler`.
- 2026-09-22: script routes receive an injected `enqueueJob` callback from `app.ts`; this keeps route behavior public-API based without adding a forbidden script-to-job module import.
- 2026-09-22: regeneration listens to request close before headers and response close after headers, avoiding false aborts when a normal request body stream closes while the SSE response is still active.
- 2026-09-22: script edge tests pin ten-snapshot pruning, invalid restore index, deterministic remainder seconds, and SSE error/no-done behavior for malformed streamed output.
- 2026-09-22: ReviewScriptPage uses fetch + ReadableStream for chapter regeneration (not EventSource) so AbortController cancellation works; no DOM test dependency was added.
- 2026-09-22: Phase 3 acceptance uses `mongodb-memory-server`; 81 tests pass and 3 stub files remain skipped. Vite reports a non-blocking client chunk-size warning above 500 kB.

### Next step
Phase 8 Tasks 1–8 are committed after Hung/Claude approval. Follow-up: finalize reviewed SEO preset wording, then repeat provider and full-width browser acceptance with an approved project/file fixture.

## 2. Stack

- Runtime: Node.js >= 22, ESM, TypeScript strict
- Backend: Express 5, zod, official `mongodb` driver (no Mongoose), ULID string ids (`_id` is a string, never ObjectId)
- Frontend: React + Vite SPA, React Router, TanStack Query (server state), Zustand (UI-only state), react-hook-form
- Tests: Vitest + mongodb-memory-server
- Dev: `tsx watch`. Build: `vite build` (client) + `tsup` (server, worker)
- Renderer: FFmpeg implemented; Remotion design committed and awaiting implementation-plan review. Isolated behind `modules/video` renderer interfaces.
- Imports are relative. No path aliases.

## 3. Runtime layout

Two Node processes from the same code:

- **web** `src/server/main.ts`: HTTP API under `/api/*`, static `/files/*`, serves `dist/client` (SPA fallback last)
- **worker** `src/worker/main.ts`: polls the `jobs` collection, runs handlers. Opens no HTTP port

The web process never does heavy work; it enqueues jobs. Long/failing work (asset generation, rendering) is always a job.
Dev: Vite (5173) proxies `/api` and `/files` to Express (3000).

## 4. Directory map

```
video-tool/
├── AGENTS.md                      this file
├── package.json, tsconfig.{base,server,client}.json
├── tsup.config.ts, vite.config.ts, vitest.config.ts, eslint.config.js
├── .env.example                   PORT, NODE_ENV, MONGODB_URI, MONGODB_DB, FILES_DIR, WORKER_POLL_MS, AI_*_API_KEY
├── docs/prototypes/                vanilla HTML/CSS/JS prototypes (khoi-tao-du-an/, duyet-tai-tao/): source of truth for layout, VN copy, tokens, behaviour
├── migrations/                    numbered scripts, only when reshaping existing documents
├── data/files/<projectId>/        assets/<sceneId>.<kind>.<ext>, output/<renderId>.mp4   (gitignored)
└── src/
    ├── contracts/                 zod schemas + types shared by server AND client (API request/response)
    │   └── common.ts project.ts script.ts asset.ts video.ts job.ts
    ├── server/
    │   ├── main.ts app.ts config.ts error-handler.ts
    │   ├── db/                    client.ts (MongoClient, getCollection<T>), ensure-indexes.ts (calls each module's indexes.ts explicitly)
    │   ├── modules/               business modules, see section 5
    │   │   ├── project/  script/  asset/  video/  job/
    │   └── shared/                no business logic, never imports modules/
    │       ├── ai-clients/        generate-json.ts generate-image.ts tts.ts providers/
    │       ├── file-store/        write/read asset files, path-traversal safe
    │       └── errors.ts logger.ts ids.ts
    ├── worker/                    main.ts (claim loop), registry.ts (job type -> handler, explicit map)
    ├── client/
    │   ├── index.html main.tsx
    │   ├── styles/tokens.css      design tokens (CSS variables), copied from the prototypes' :root block
    │   ├── app/                   App.tsx router.tsx Layout.tsx, pages/ (ComingSoonPage, etc.)
    │   ├── features/              project/ script/ asset/ video/   (same names as server modules)
    │   │   └── project/           api.ts hooks.ts store.ts ProjectInitPage.tsx components/
    │   │   └── <other feature>/   api.ts hooks.ts <Feature>Page.tsx components/
    │   └── shared/                api-client.ts, hooks/use-job-progress.ts (SSE), ui/
    └── test-utils/                mongo.ts (in-memory DB), factories.ts, fake-ai.ts  (Phase 1: not created; see Status)
```

Every module has the same base files:

```
modules/<name>/
├── MODULE.md      purpose, owned collections, allowed imports, invariants, pitfalls
├── index.ts       the ONLY public API of the module
├── docs.ts        zod schema + types of the documents this module owns
├── indexes.ts     Mongo indexes for the collections it owns
├── repo.ts        DB queries only
├── service.ts     business logic / orchestration
├── routes.ts      thin HTTP layer
└── <name>.test.ts
```

Extra files per module:

- `script/ai/`: `presets/*.md`, `build-prompt.ts`, `output-schema.ts`, `parse-output.ts`, `fixtures/`
- `asset/`: `input-hash.ts`, `handlers/{generate-image,generate-voice}.ts`, `ai/` (same shape as script/ai)
- `video/`: `build-timeline.ts` (pure), `handlers/render-video.ts`
- `job/`: `routes.ts` also exposes SSE progress; claim/recover logic lives in `service.ts`

## 5. Modules and dependencies

| Module | Responsibility | Owns collection | May import |
|---|---|---|---|
| project | project CRUD, scene model (scenes embedded in project doc), optimistic lock | `projects` | none |
| job | generic queue: enqueue, claim, progress, cancel, recover stuck jobs. No business logic | `jobs` | none |
| script | AI script generation from brief + preset, run history | `script_runs` | project |
| asset | per-scene assets via jobs, stale detection, retry | `assets` | project, job |
| video | timeline from scenes + assets, render via jobs | `renders` | project, asset, job |
| seo | YouTube packaging generation and section orchestration | none; embedded in `projects` | project |

```
script -> project <- asset -> job
                      ^         ^
                      +-- video-+
seo -> project
```

Direction is one-way, no cycles. `job` never imports asset/video; `worker/registry.ts` is the only place that knows both.

## 6. Hard rules (enforced by `eslint.config.js` where possible)

1. Import another module only via its `index.ts`. Never `../project/repo`.
2. Follow the dependency table above. Need something that violates it? Move shared logic down (e.g. into `project`) or pass data in via parameters; do not add exceptions.
3. Each collection has exactly one owning module; only it writes to it. Others call its exported functions.
4. `client/` imports only `contracts/` and itself. `contracts/` imports nothing from server/client/worker. `shared/` never imports `modules/`. `worker/` imports modules only via `index.ts`.
5. Routes are thin: `zod.parse` -> call service -> respond. No business logic in routes or repo.
6. `repo.ts` = queries. `service.ts` = orchestration. Put decision logic in small pure functions (easy to test).
7. Validate everything first; write to Mongo only at the end so a failure never leaves half-written state.
8. Secrets (AI keys) exist only in server/worker env. Never in `client/`.
9. No magic registration. Routes are mounted explicitly in `app.ts`, indexes in `db/ensure-indexes.ts`, job handlers in `worker/registry.ts`.
10. Files ~100-300 lines, one responsibility, descriptive names (no `utils.ts` / `helpers.ts`). Split only when a file has two responsibilities.
11. After every step, and in the same commit as the code change, update the "Status" section. A step is not done until Status matches the code. Never mark something as done unless you verified it by running a command.

## 7. Pipeline

**Script** (synchronous request at first)
`POST /api/script/generate` -> load project + preset -> `buildPrompt` -> `generateJson` (validate with zod, retry once with the zod error) -> `parseOutput` (AI shape -> `SceneDoc[]`) -> insert `script_runs` (with `scenesBefore`) -> update project (`scenes`, `status`, version check).
Manual edit of one scene goes through `PATCH /api/project/:projectId/scenes/:sceneId` (no AI).

**Asset** (always jobs)
`POST /api/asset/generate` -> `asset.service` enqueues `asset.generate-image` / `asset.generate-voice` per scene -> worker runs the handler -> writes file via `file-store` -> upserts `assets` doc (`status`, `path`, `inputHash`).

**Video** (always a job)
`POST /api/video/render` -> `build-timeline(scenes, assets)` (pure) -> enqueue `video.render` -> worker renders -> writes `output/<renderId>.mp4` -> updates `renders` (`progress`, `status`, `outputPath`).

**Stale assets** are computed at read time, not stored: `stale = hashInput(currentScene) !== asset.inputHash`. Regenerating the script never needs to touch `assets`.

## 8. Data model (MongoDB)

| Collection | Key fields |
|---|---|
| `projects` | `_id`, `schemaVersion`, `title`, `titleSearch` (accent-stripped, lowercased `title`), `language` (`vi`\|`en`), `brief`, `referencesText`, `scriptPresetId`, `targetDurationSec`, `chapterCount` (int 1-20 or `null`), `voiceId` (string or `null`), `status` (`draft`\|`script`\|`assets`\|`rendered`), `renderSettings {aspect,width,height,fps}`, `scenes[]`, `version`, `createdAt`, `updatedAt` |
| `assets` | `_id`, `projectId`, `sceneId`, `kind` (image, voice, music, subtitle), `status` (pending, running, done, failed), `path`, `inputHash`, `error`, `meta`, `updatedAt`. Unique `{sceneId, kind}` |
| `script_runs` | `_id`, `projectId`, `presetId`, `promptVersion`, `model`, `rawOutput`, `scenesBefore`, `createdAt` |
| `renders` | `_id`, `projectId`, `status`, `settings`, `timelineHash`, `outputPath`, `progress`, `error`, `createdAt` |
| `jobs` | `_id`, `schemaVersion:1`, `type`, `projectId`, `payload`, `status` (queued, running, done, failed, cancelled), `attempts`, `maxAttempts`, `runAt`, `lockedBy`, `lockedAt`, `progress`, `result`, `error`, `cancelRequested`, `logs[]`, `createdAt`, `updatedAt`. Index `{status, runAt}` |
| `files` | `_id`, `projectId`, `originalName`, `mimeType`, `ext`, `sizeBytes`, `purpose: reference`, `storedPath` (relative to `FILES_DIR`), `createdAt`. Indexes `{projectId, createdAt}` and `{purpose}` |

`SceneDoc` (embedded in `projects.scenes`): `{ id, narration, visualPrompt, durationSec }`. `id` is stable; assets reference it; array order = scene order.

Concurrency patterns:

- **Optimistic lock:** `updateOne({_id, version: expected}, {$set: ..., $inc: {version: 1}})`; `matchedCount === 0` -> throw `Conflict` (HTTP 409).
- **Single scene edit:** `$set: {'scenes.$[s].narration': ...}` with `arrayFilters: [{'s.id': sceneId}]`, and `$inc: {version: 1}`.
- **Job claim (atomic):** `findOneAndUpdate({status:'queued', runAt:{$lte:now}}, {$set:{status:'running', lockedBy, lockedAt:now}, $inc:{attempts:1}}, {sort:{runAt:1}, returnDocument:'after'})`. Worker polls every `WORKER_POLL_MS`.
- **Recovery:** `running` jobs with an old `lockedAt` go back to `queued`.
- Mongo runs standalone (no replica set): do not rely on multi-document transactions or change streams.
- Every doc has `schemaVersion`; zod in `docs.ts` is the single source of truth for shape.

## 9. AI content generation convention

Applies to every `modules/*/ai/` folder. Code, prompt text and JSON format are separate on purpose:

- `presets/*.md`: the only preset source of truth (prompt text data), with validated `id` + `version`; the production build copies these Markdown files to `dist/presets/`.
- `output-schema.ts`: zod schema of the JSON the AI returns. Shape chosen for the AI (may use snake_case). One source of truth -> derive TS type, validator and JSON Schema (`z.toJSONSchema`).
- `build-prompt.ts`: typed pure function `(input) => { system, user, jsonSchema, promptVersion }`. No `{{var}}` string templates.
- `parse-output.ts`: the only place that knows both the AI shape and the system model (`AiScriptOutput` -> `SceneDoc[]`: rename fields, generate ids, estimate duration).
- `fixtures/`: real saved AI responses. Tests use them instead of calling the AI.

Rules: always validate AI output even with structured output; on failure retry once, passing the zod error back; then throw `AiOutputError` (HTTP 502) and write nothing. Store `presetId`, `promptVersion`, `model` with generated results.
Do not confuse: API schemas (client<->server) live in `contracts/`; AI output schemas live in `modules/<x>/ai/`.

## 10. Jobs

- Types: `asset.generate-image`, `asset.generate-voice`, `video.render`.
- Handler: `(job, ctx) => Promise<result>` where ctx can report progress and observe cancellation. Exported from the owning module's `index.ts`, registered in `worker/registry.ts`.
- Retries: up to `maxAttempts` with backoff. Store per-asset `failed` + `error` so only the failed part is retried.
- Client tracks progress via SSE (`use-job-progress`), fallback to polling with TanStack Query.

## 11. API conventions

- Prefix `/api/<module>`; files served from `/files/<projectId>/...`.
- Error mapping in `error-handler.ts`: `ZodError` 400, `NotFound` 404, `Conflict` 409, `AiOutputError` 502, otherwise 500. Handlers are `async`; Express 5 forwards thrown errors, no try/catch wrapper needed.
- Validate every request body/params with the zod schema from `contracts/`.

## 12. Client conventions

- Feature folders mirror server modules. One `api.ts` (typed with `contracts/`), one `hooks.ts` (TanStack Query), one `<Feature>Page.tsx`, `components/` for the rest.
- Server data goes through TanStack Query. Zustand only for UI state (selected scene, timeline UI).
- The client only uses URLs (`/api/...`, `/files/...`); it never touches disk or workers.

## 13. Commands

```
npm run dev          # vite + web (tsx watch) + worker (tsx watch)
npm run typecheck    # tsc for server and client
npm run lint         # eslint incl. module boundary rules
npm test             # vitest (in-memory Mongo, fake AI)
npm run build        # dist/client (vite) + dist/server.js + dist/worker.js (tsup)
npm start            # node dist/server.js       (second process: npm run start:worker)
```

Always run `typecheck` and `test` after changes; both are cheaper than reading more code to be sure.

## 14. Where to change what

| Task | Touch |
|---|---|
| Change a request/response shape | `contracts/<m>.ts`, then `modules/<m>/routes.ts`, `client/features/<m>/api.ts` |
| Change a stored document | `modules/<m>/docs.ts` (+ `indexes.ts`, + `migrations/` if old data exists) |
| Tweak AI output text/style | `modules/<m>/ai/presets/*.md` (bump `version`) |
| Change what the AI must return | `ai/output-schema.ts` + `ai/parse-output.ts` + `ai/fixtures/` |
| New AI provider | `shared/ai-clients/providers/` |
| New job type | handler in the module, register in `worker/registry.ts`, enqueue from that module's `service.ts` |
| New page | `client/features/<m>/`, route in `client/app/router.tsx` |
| New module | copy the base layout, add `MODULE.md`, update section 5, `eslint.config.js` (`MODULES`, `ALLOWED`), `db/ensure-indexes.ts`, `app.ts` |

## 15. Open decisions

- Renderer: Remotion vs FFmpeg
- AI providers for text, image, TTS
- Custom presets editable in UI (would become a `preset` module; today only default presets in files)
- Auth (none for now)
