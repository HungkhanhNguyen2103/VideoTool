# Runner mission — Task 97: Project-wide AI popup analysis (AI decides every text popup)

Crew: `video-tool-pair` (@coder Codex leads, @reviewer duyệt). Repo: `E:\ToolV2\ProjectHK\video-tool`.
Language: Vietnamese to Hung, English between agents. UI strings are Vietnamese.
Tasks 87–96 are done. Do not touch their behavior except where listed below.

## Goal (one line)
Text popups (center number/year/date popups and name/place lower-thirds) appear only when truly needed. A single project-wide AI analysis judges, for every scene and its voiceover, whether a popup is really needed; if the AI says it is not needed, nothing is shown. The AI's judgement is the authority. All hidden rule-based selection is removed, and code never cuts a popup the AI judged needed except for the minimal safety net in A4. Hung chooses the backend (DeepSeek/API or Claude CLI) and a density level, and can see why each popup exists.

## Why (verified by reading the code at HEAD)
- `src/server/modules/video/keywords.ts` `selectKeywordsWithSource`: every token containing a digit becomes a number popup (up to `MAX_KEYWORDS_PER_SCENE = 2` per scene) with no importance check; units list lacks nouns like "người"/"quân" so "3000 người" shows only "3000"; dates are recognised only as "ngày N tháng M năm Y" and "năm N".
- Name lower-thirds: AI candidates (Task 82, `name-keyword-service.ts`) are followed by rule candidates in `orderedNameCandidates`, so when the AI says "nothing important" the capitalised-word rules still pick something. Only one lower-third per scene, first unused wins; no project-wide density limit (only a 2.5 s spacing inside a scene).
- Current AI analysis already sends all scenes in one call but asks for names only, max 2 per scene, sees only narration (no title/brief/references), and has no importance, reason, or budget.

## Git and process rules
- Work directly on `main`. No branch, no worktree. Commit per part (A, B, C). Never push. Do not stage "Claude outputs/".
- Start with `git status`: only untracked "Claude outputs/" files allowed; otherwise stop and report.
- Line endings: files in HEAD are LF. Keep LF. Before every commit run `git diff --stat` and `git diff --ignore-cr-at-eol --stat`; the numbers must match (a CRLF churn problem happened in Task 96).
- AGENTS.md rules: Status update in the same commit (rule 11), imports only through `index.ts`, contracts/zod, CSS Modules + tokens, respect module boundaries (`script -> project`, `seo -> project`; check AGENTS.md before making `video` depend on `script`; if the Claude CLI runner lives in `script`, extract the minimal shared piece instead of a forbidden import, and say so in the plan). No new dependency unless unavoidable.
- Flow: @coder posts a short plan (files, data model, boundary decision, open questions) → @reviewer replies ACCEPTED or numbered defects → implement → @reviewer reviews each part with real evidence before commit. Max 3 fix rounds per part, then stop and report.
- Environment: VieNeu TTS (`npm run tts`) and MongoDB (localhost:27017) are already running. Do not start another TTS. Start API, worker and web yourself for real verification and stop them afterwards.

## Part A — Analysis core (server + contracts)

### A1. What the AI receives (one analysis per project)
Project title, brief, referencesText, language, the numbered narrations of all analysable scenes (same eligibility as today: narration + current audio + matching wordTimings) with scene start time in the video (so the AI knows the story position), the chosen density level, and the definition of each popup kind and of "needed". If the project is too long for one call, split into overlapping chunks, then merge and apply the budget (A4) over the whole project, never per chunk.

### A2. What the AI returns (strict zod schema, JSON)
Per scene a verdict: `{ scene, needed: boolean, reason }` (a one-sentence Vietnamese reason for BOTH outcomes, e.g. "không cần popup vì không có mốc mới") and, only when `needed` is true, its popups. The AI must judge each scene by asking: would a viewer be lost or miss a key fact without this text on screen while hearing this voiceover? Default to `needed: false`. Per popup: `scene` (number), `kind` (`person`|`place`|`event`|`number`|`year`|`date`), `anchor` (verbatim contiguous words from that scene's narration, used for timing), `display` (text to show), `importance` (1–5), `reason` (one Vietnamese sentence: why viewers need it), optional `role` (for person), optional `evidence` (verbatim quote from brief/referencesText when the display contains a fact not in the narration, e.g. a date). Empty list for scenes with nothing needed. The AI is told to be conservative and what "needed" means:
- number: scale of a key event (army size, casualties, money, distance) with its noun ("3.000 quân"); not ordinals, durations mentioned in passing, small counts.
- year/date: first mention of an era or a real jump in time; not every repeated year; a date is shown as a date ("12/1285") when the narration refers to it ("ngày xuất binh") and the date is in the narration or in a verified `evidence` quote.
- person/place/event: first important mention only; protagonists and key locations; places must appear in narration/brief/references; not generic nouns, not minor names.

### A3. Validation (code, not selection rules)
Keep and extend `validateNameCandidate`-style checks. Reject (and count in the summary) any popup where: the anchor is not verbatim contiguous in that scene's narration or has no word timing; `display` is empty or longer than 6 words; the display contains digits that cannot be traced to the anchor/narration (digits or Vietnamese number words such as "ba nghìn" → 3.000, implement a small tested parser) or to a verbatim `evidence` quote found in brief/referencesText; the kind/shape is invalid (e.g. a `year` display that is not a year). Timing comes from the anchor's word timing as today (lead-in and hold constants stay as in `keywords.ts` unless the plan justifies a change).

### A4. Density = strictness for the AI, plus a minimal safety net
Project setting `popupDensity`: `low` | `medium` | `high`, default `low` (old projects read as `low`). It is NOT a quota enforced by code. It is passed to the AI as how strict to be: low = only facts a viewer cannot follow without (aim roughly 1 popup per 15–20 s of video at most, often fewer); medium = also useful context; high = generous. The AI sees each scene's start time in the video and spaces its own choices. Importance (1–5) is kept only to resolve conflicts below; there is NO importance threshold and NO per-video minimum gap enforced in code.
Code-side safety net only (named constants, tested): never overlap two popups in time; at most 2 popups per scene; if two popups would start closer than 3 s, keep the higher importance (ties: earlier) and record the drop reason "gần popup khác". Every drop by this net is recorded and shown in Studio. Nothing else removes an AI-approved popup.

### A5. Remove all rule-based popup selection
Delete the rule paths that decide *what* appears: digit tokens, `dateCandidate`, capitalised-name detection, prefix/role phrase heuristics and the rule fallback in `orderedNameCandidates`. No analysis for a scene = no popup for that scene. Keep what the renderer needs: `parseNumberPhrase`, `enrichKeyword`, `annotateYearKeywords` (year roll timeline), `nameKeywordDedupeKey` / first-mention dedupe, and the Keyword shape consumed by `KeywordOverlay.tsx`; AI popups must be converted into the existing `Keyword` objects so Remotion needs no new popup types. Respect the existing project `keywordPopups` on/off setting. Update `selectProjectSceneKeywords` (and the Studio preview that uses it) to read the stored popup plan.

### A6. Film look stays independent
`resolveFilmLookByScene` currently reads years from the popup keywords. After A5 that would break `auto` film look. Add a separate small year detector over the word timings (the old "năm NNNN" / numeric dates logic is fine here), used only for film look, independent of which popups are displayed. Test: film look auto still switches on at the first pre-1990 year even when no year popup is shown.

### A7. Storage
Store the plan per scene next to the existing `nameCandidates` (do not delete old data; old projects keep working until re-analysed, they just show no popups). Record freshness the same way (narration hash + audio file id) plus provider, model, backend, density, generatedAt, and the dropped list with reasons. Pinned and suppressed flags (Part C) live in the same record and survive re-analysis (match by scene id + normalised anchor). Scene preview fingerprints must include the effective popup plan so previews go stale correctly.

## Part B — Backends and jobs
- Two backends: `api` (project's configured provider/model, DeepSeek or Claude API, via `getAiClient`) and `cli` (Claude Code CLI, reuse `runClaudeCli` and the audit run folder pattern from Task 93/94 with prompt.md/output.txt/meta.json, cancel, timeout, unavailable state with 503 `CLAUDE_CLI_UNAVAILABLE` before queueing). The model for CLI is run-local and does not change project settings.
- Run as a cancellable job with progress and log; `POST` route to start with `{ backend, cliModel?, density? }`; keep the existing automatic analysis after word alignment (`autoAnalyzeProjectNameKeywordsIfStale`) but only through the API backend and only when no valid plan exists; CLI only on explicit user action.
- Failure behavior: invalid JSON retries once; schema/validation failure keeps the previous plan untouched and reports a Vietnamese error; a valid empty result is a valid result (clears popups, no fallback).
- Do not run a render while the analysis job is writing (reuse the existing render guard pattern).

## Part C — Studio UI (Vietnamese)
A "Popup chữ" section in Studio (near the existing popup/name controls; find via AGENTS.md map):
- Backend selector (API / Claude CLI with model), reuse `AiModelSelect` and the CLI status component from Task 93/94; density select Ít / Vừa / Nhiều with one-line explanations; button "Phân tích popup"; status line (fresh / stale / not analysed counts, provider/model/backend, last run time).
- Per-scene list: the AI verdict for EVERY scene (needed / not needed + its reason, so Hung can read why a scene has no popup), and for needed scenes each popup's kind, display text, importance, reason, kept or dropped by the safety net (with the drop reason), and actions Ghim / Tắt. Pinned popups are always kept (still never overlapping others; report conflicts), suppressed ones never return after re-analysis. Editing the display text inline is allowed but must pass the same validation (A3).
- Before render, if scenes are not analysed or stale, show a warning but do not block render. Empty state text must say that no popups will be shown until analysis runs.
- Layout must hold at 1920×1080 (primary), 1440×900 and 390×844; Tab order matches visual order.

## Tests (Vitest, fakes only: no live AI in automated tests)
- Schema and parsing: valid, empty, malformed, extra fields, retry once.
- Validation: anchor not verbatim, untraceable digits, number-word parsing ("ba nghìn người" → "3.000"), evidence quote verified or rejected, over-long display, wrong year shape.
- Verdicts: `needed: false` scenes show nothing and keep their reason; AI-approved popups are never dropped except by the A4 safety net (overlap, max 2 per scene, <3 s conflict) and each drop records its reason; density only changes the prompt text, not a code quota (test the prompt contains the strictness wording per level).
- Rule removal: a narration full of digits and capitalised words with an empty AI plan renders no popups; no rule fallback anywhere; the previous plan survives a failed analysis.
- Film look auto independent of displayed popups. Preview fingerprint changes when the plan changes.
- Job/route: API and CLI backends (fake CLI like `fixtures/fake-claude-cli.mjs`), CLI 503 before queueing, cancel, auto-analysis only via API.
- UI: pin/suppress persistence across re-analysis, warning state, backend/density controls, keyboard order.

## Real verification (do it, not only tests)
1. Disposable duplicate of the real "Rạch Gầm" project (name it `[verify-task-97] ...`; never modify the original). First capture the OLD behaviour at HEAD~ before your change: list every popup (scene, kind, text, start time) and popups per minute. Save as `data/files/.verification/task-97/before.md`.
2. Run the new analysis with the API backend (project provider) and with Claude CLI (Haiku, then Sonnet if available). For each: popups per minute at low/medium/high, the AI verdict count (needed vs not needed scenes) with sample reasons, list of kept popups with reason and importance, list of safety-net drops with reasons, rejected-by-validation count, wall time, tokens/cost if available. Save as `after-api.md` and `after-cli-*.md` plus a short `comparison.md`. Include the specific cases Hung cares about: how "3000 người"-like quantities, "ngày xuất binh"-like dates, and place names were handled.
3. Render a short real preview/render with the new popups (both engines if applicable) and save frames showing a center popup and a lower-third.
4. Browser captures with Playwright at an explicitly set 1920×1080 viewport, full-resolution PNG saved under `data/files/.verification/task-97/`, and print the PNG dimensions (must be exactly 1920×1080; 1905×1072 captures were rejected before). Also 1440×900 and 390×844. Captures: section idle, after analysis (list with reasons), a dropped popup, pin/suppress, CLI unavailable state, density select.
5. Full gate on `main`: `npm run typecheck`, `npm run lint`, `npm run build`, full test suite. Report real counts; fix failures you caused, prove pre-existing ones.
6. Update AGENTS.md Status, `src/server/modules/video/MODULE.md` and any docs describing the old rule-based popups.

## Definition of done
- Parts A, B, C committed on `main` (one commit each, sensible messages), LF line endings verified, AGENTS.md Status updated in each, nothing pushed, tree clean except untracked "Claude outputs/".
- No rule-based popup selection remains; no popup appears unless the AI judged that scene needs one and validation passed; scenes judged not needed show nothing and display the AI's reason; film look auto still works.
- Both backends verified for real; before/after report with popups-per-minute numbers saved; screenshots at verified sizes.
- All gates green with real counts; @reviewer replied ACCEPTED for each part.
- Final report to Hung in Vietnamese: what changed per part, before/after popup counts, how the three example cases are now handled, backend timings/costs, gate counts, screenshot paths, and limitations.

## Out of scope
Changing popup visual design or animation, the film look filter itself (note a possible grayscale option only), TTS, Task 86 density work beyond this setting, deleting old `nameCandidates` data.
