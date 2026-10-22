# Tasks 108–111 — Multi-channel profiles and SEO/packaging v2 (four tasks, four commits, in this order)

Work directly on `main` (no feature branch, no worktree). Never push. Do not stage temp files (`.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`, `docs/superpowers/plans/*`, the stray `01M4W…` files in the repo root, anything under `tools/explainer-3d/out` or `reference`). Keep LF line endings in commits. Follow AGENTS.md (rule 11: Status line in the same commit; import through each module's `index.ts`; CSS Modules + design tokens; modular monolith boundaries: a module never touches another module's collection directly). UI copy is Vietnamese; code, comments, AI prompts and commit messages are English. Primary viewport 1920×1080. `app.test.ts` has a known pre-existing SPA fallback failure; do not fix it. Vitest cannot run in some of the Linux VMs used by reviewers; run it on the Windows machine and report real output.

## Context

Video Tool already has a per-project SEO package (`src/contracts/seo.ts`, `seo-format.ts`, module `src/server/modules/seo`, client `src/client/features/seo`, preset `seo-documentary` v7): five title angles, `descriptionIntro` + generated chapter timestamps (`assembleDescription`), tags, hashtags, one pinned comment, thumbnail ideas with a fixed thumbnail template, publish checklist and Markdown export (`buildPublishChecklist`, `buildPackageMarkdown`). There is no channel entity: everything channel-level (name, links, footer, hashtags, thumbnail template, posting schedule) is repeated by hand. The user runs several YouTube channels; the first is "Lịch Sử Không Khô" (@lichsukhongkho213, positioning "những nghịch lý ít ai để ý"). The upgrade has four parts: shared channel profiles (108), channel-aware SEO v2 with a better description and AI-content reminder (109), publishing schedule and checklist (110), and a Shorts package derived from a long video (111).

General rules for all four tasks:
- Do not invent facts anywhere. YouTube-behavior claims (best posting hours, ideal description length, CTR targets) are hypotheses; show them in the UI as "gợi ý, chưa kiểm chứng" and keep them in named constants, never as hard validation errors.
- Do not add YouTube API integration, auto-upload, analytics import or a keyword-research tool (out of scope for all four).
- Existing projects, existing SEO packages and the existing preset output must keep working: every new field is optional with a safe default; legacy documents parse unchanged.
- Each task ends with: focused tests, `npm run typecheck`, `npm run lint`, `npm run build`, relevant vitest files plus `src/contracts`, a MODULE.md update, an AGENTS.md Status line in the same commit, and an untracked report `docs/superpowers/tasks/task-1NN-report.md` (commits, files, rules as implemented, verification, what you could not verify, deviations).

---

## Task 108 — Channel profiles (multi-channel) — commit `feat(channel): channel profiles and project assignment`

### Contract (`src/contracts/channel.ts`, exported like other contracts)

`ChannelSchema` (strict): `id`, `name` (1–100), `handle` (optional, `@` + 3–30 chars of letters, digits, `_`, `-`, `.`), `tagline` (≤ 200), `description` (≤ 1000, the YouTube channel-description limit), `language` (`vi` | `en`), `links` (array of `{ label ≤ 40, url }`, max 10, `url` must be http/https), `defaultHashtags` (use `normalizeHashtags`, max 5), `descriptionFooter` (≤ 1500, free text appended to every description), `aiDisclosureText` (≤ 500, optional voluntary line), `thumbnailTemplate` (≤ 4000 chars, optional English text that will describe the channel's fixed thumbnail layout; empty means "use the preset default"), `publishSchedule` (reserved for Task 110: define the field now as optional with `null` default so Task 110 only adds UI and rules), `createdAt`, `updatedAt`. Create/update input schemas and a `ChannelSummarySchema` (`id`, `name`, `handle`). Contract tests: defaults, limits, handle and URL validation, legacy-safe parsing.
Add optional `channelId: string | null` (default `null`) to the project contract and project document; update every place that maps projects (grep `scriptPresetId` and `visualStylePresetId` to find all mappers, including duplicate/import-from-ZIP paths: duplicating a project keeps its channel; ZIP import keeps it only if the channel exists, else null).

### Server (`src/server/modules/channel`, new module with MODULE.md)

- Collection `channels`; routes `GET /api/channels`, `POST /api/channels`, `GET /api/channels/:id`, `PATCH /api/channels/:id`, `DELETE /api/channels/:id` (409 with a Vietnamese message when projects still use the channel; list how many). Validation with the shared schemas, standard `AppError` codes, `updatedAt` maintained.
- Project assignment: `PATCH /api/project/:id` (or the existing project patch route — read how `aiProvider` is patched and follow it) accepts `channelId` (existing channel id or `null`); unknown channel id → 404/422. The project module reads channel existence only through the channel module's public API (`index.ts`), not its collection. Provide a public `listChannelProjectsCount`-style function or let project count its own references (choose the cleaner dependency direction and document it; avoid a circular import).
- Mount in `app.ts`, add indexes (`channels` unique `name` case-insensitive if the repo has a helper for that; otherwise a normal index and a duplicate-name check).

### Client

- Create-project form: optional "Kênh" select (default none; remembers the last used channel in `localStorage` with try/catch) — keep the rest of the payload unchanged.
- SEO page (tab "4. SEO & Đóng Gói Kênh"): new top section "Kênh" with a select for the project's channel, a "Quản lý kênh" button opening a panel (dialog) with the channel list, create/edit/delete, and a "Dùng mẫu Lịch Sử Không Khô" button that prefills the form with: name "Lịch Sử Không Khô", handle "@lichsukhongkho213", tagline "những nghịch lý ít ai để ý", language `vi`. Prefill only, never auto-save. Disabled states and Vietnamese errors follow existing patterns. Put the logic in small pure helpers with tests; no DOM-test dependency (repo style).
- API helpers and hooks for channels following `features/seo` conventions; query invalidation for list and project.

### Tests

Contract tests, server route tests (CRUD, handle/url validation, 409 on delete in use, assignment, unknown channel), project mapper tests (legacy documents without `channelId`), client api/hook/helper tests.

---

## Task 109 — Channel-aware SEO v2: richer description, sources, AI-content reminder — commit `feat(seo): channel-aware packaging and description v2`

### Prompt and preset

- `buildSeoPrompt` receives the project's channel (if any) and adds a `Channel:` block to the user message: name, handle, tagline, language, default hashtags, and the thumbnail template override. If `thumbnailTemplate` is non-empty it REPLACES the fixed "Template, left to right" section of the preset for that call (implement by moving the current template text into a named default constant used by the preset loader, and substituting it; do not duplicate the preset file). With no channel, output is identical to today (add a snapshot/regression test that proves the prompt text is unchanged for a project without a channel, apart from the version).
- Channel `defaultHashtags` are merged after generation: keep at most `SEO_HASHTAGS_MAX_COUNT`, the first three visible slots stay the AI's most relevant unless the channel defines fewer than three defaults, dedupe through `normalizeHashtags` (they must still not repeat tags).
- Bump the preset to v8 and the prompt version accordingly; update tests and docs that expect `@7`.

### New section: description keywords

Add optional `descriptionKeywords` to the SEO package (string, ≤ 800 chars, default `''`): one natural paragraph of 40–100 words that restates the subject with the event, person, place and era keywords a viewer would search, without stuffing and without new facts. It is generated by the AI as part of the `description` section (extend output schema/parser; one validation retry as today) and editable in the Description panel.

### Description assembly v2 (`assembleDescription`, pure, deterministic)

New order, each block omitted when empty, separated by one blank line:
1. `descriptionIntro`
2. `descriptionKeywords`
3. chapter timestamps (existing behavior)
4. **Sources** ("Nguồn tham khảo:" in Vietnamese projects, "Sources:" in English): derived ONLY from `project.referencesText` by a conservative parser that keeps lines of the numbered source list that contain an http/https URL (accept `[1] Title: URL`, `1. Title - URL`, bare numbered URL lines); keep title text as written, at most 8 entries, de-duplicated by URL, no AI involvement. If none parse, omit the block.
5. channel links (`label: url` lines) when a channel is assigned
6. channel `descriptionFooter`
7. channel `aiDisclosureText` when non-empty
8. hashtags (last, as today)
Total must stay ≤ `SEO_DESCRIPTION_MAX_CHARS`; if over, trim in this order: sources, then keywords, never the intro, chapters or hashtags, and report it in the checklist as a warning.
Description panel shows: word count of the assembled description with a soft hint "gợi ý 150–300 từ, chưa kiểm chứng" (constants `SEO_DESCRIPTION_HINT_MIN_WORDS`/`MAX_WORDS`, never an error), a preview of the assembled text, and the keywords field with its own regenerate button (the existing section-level regeneration).

### Checklist and export

- New checklist items: `channel` (a channel is assigned; warning if not), `sources` (sources block present; warning when `referencesText` has no parsable URLs), `ai-content` (a reminder item, never auto-ticked: "Trả lời câu hỏi nội dung bị thay đổi/tổng hợp trong bước tải lên của YouTube nếu video có cảnh hoặc giọng thật được tạo bằng AI." State clearly in the detail text that the rule is YouTube's and the user decides; do not claim what is or is not required).
- Markdown export includes the channel block and the assembled description.

### Tests

Pure tests for the sources parser (each accepted format, rejections, 8 cap, dedupe, no URL), assembly order and trimming, channel merge of hashtags, prompt regression for no-channel projects, schema/parser tests for `descriptionKeywords`, checklist items, panel helpers.

---

## Task 110 — Publishing schedule and checklist — commit `feat(seo): channel publishing schedule and upload workflow`

- Fill in the reserved `publishSchedule` on the channel: `{ timezone (IANA, default 'Asia/Ho_Chi_Minh'), slots: [{ weekday 0–6, time 'HH:mm', kind 'long' | 'short' }], notes ≤ 500 }`, max 14 slots. Editor in the channel panel with a button "Dùng gợi ý ban đầu (giả thuyết)": long videos Tue/Fri/Sun 19:30–21:00 slot at 20:00, shorts weekdays 11:30–12:30 slot at 12:00; label it "chưa kiểm chứng, hãy chỉnh theo số liệu YouTube Studio của kênh".
- Pure helper `nextPublishSlots(schedule, now, kind, count)` returning the next N instants in the channel's timezone (use `Intl` with the IANA zone; no new date library unless one already exists in the repo), with tests across a week boundary and DST-free zone (and one test with a zone that has DST).
- Publish panel: "Lịch đăng gợi ý" shows the next 3 slots for the video kind, each with a "Sao chép giờ" button, and a short numbered workflow: upload as unlisted or scheduled 2–4 hours earlier so processing and copyright checks finish first; set title, description, tags, thumbnail, playlist; schedule. Mark the 2–4 hours as a suggestion.
- Checklist additions: `schedule` (a slot is available or the channel has none: neutral reminder, not a warning) and `duplicate-title` (compare the chosen title with chosen titles of other projects of the same channel after accent/case/punctuation normalization; warning when equal or when one contains the other and is ≥ 12 chars). Provide the other projects' titles through the project module's public API; do not read its collection from the seo module.
- Markdown export includes the suggested slots.
- Tests: schedule schema, `nextPublishSlots`, duplicate-title rules (accents, punctuation, containment, different channel ignored, project itself ignored), panel helpers.

---

## Task 111 — Shorts package from a long video — commit `feat(seo): shorts package candidates and export`

- New optional SEO section `shorts` (add to `SEO_SECTIONS` carefully: the generate route, worker handler, UI section list and tests that enumerate sections must all be updated; existing packages without it parse unchanged). Stored as `shorts: [{ id, startSec, endSec, chapterNo, hookLine, title (≤ 100), caption (≤ 500), hashtags (max 5, always includes #Shorts), reason }]`, max 3.
- Candidate windows are chosen DETERMINISTICALLY by the server, never by the AI: from active scenes only, snap start/end to scene boundaries, length 30–55 s, prefer windows inside chapters whose `role` is the climax act (read `NARRATIVE_ROLES`/chapter roles in `contracts/project.ts`; if no climax chapter exists, use the highest-weighted act), no overlap, ordered by a documented score (for example narration density of numbers/names/question marks is NOT allowed to invent facts; keep the score simple and explainable, such as closeness to the climax centre). Put this in a pure function `pickShortsWindows(project)` with tests (inactive scenes ignored, snapping, bounds, no overlap, short videos produce fewer/zero windows, deterministic).
- The AI only writes `hookLine`, `title`, `caption`, `hashtags` and `reason` for each given window from that window's narration excerpt, with the same no-invention rules as the main preset; use a separate small preset section or file with its own version. The caption may contain the literal placeholder `{LONG_VIDEO_URL}`; add an optional `longVideoUrl` field to the SEO package (http/https only) and substitute it at export time; when empty the placeholder is shown highlighted and the checklist warns.
- UI: a "Gói Shorts" panel in the SEO page listing the candidates with timecodes (`mm:ss–mm:ss`), the narration excerpt, editable title/caption/hashtags, copy buttons, and a plain "Mốc cắt" note: cutting and the vertical render are done manually for now (no render in this task). Regenerate per section like the others.
- Markdown export includes the Shorts block. Checklist adds `shorts` as an optional (never blocking) item.
- Tests: window picker, schema/parser/retry for the shorts output, section enumeration regressions, placeholder substitution, export, panel helpers.

## Out of scope for all four

Vertical Shorts rendering, YouTube/Facebook API integration, automatic upload, analytics, keyword research, channel branding assets (banner/avatar generation), playlist management, and any change to the Remotion/Blender work.

## Verification for each task (run and report real output)

`npm run typecheck`, `npm run lint`, `npm run build`, `npx vitest run` for the touched files plus `src/contracts`, `src/server/modules/<touched modules>` and `src/client/features/<touched features>`. Exact 1920×1080 browser acceptance on a disposable duplicate project: create two channels, assign one to a project, generate/edit SEO, view the assembled description, the checklist items, the schedule slots, and the Shorts panel, and confirm persistence after reload. Say clearly what was not exercised (for example a real AI provider call) rather than implying it was.
