# Script outline, word budget, provider, manual mode, and hubris-trap design specification

**Date:** 2026-09-23  
**Status:** Design only; implementation is intentionally blocked until this spec is reviewed.  
**Source:** Updated brief for outline budgeting, retention shape, provider selection, manual generation, and the `hubris-trap` preset.

## Goal

Extend the accepted script-preset/visual-prompt foundation with four related capabilities:

1. Replace one large automatic script-generation response with a bounded outline call followed by sequential per-chapter expansion calls.
2. Give the outline and expansion prompts a word budget, retention shape, and continuity/open-loop context, with a conservative under-length retry.
3. Expose the existing AI-provider choice and add a synchronous copy/paste generation path that bypasses server-side AI calls.
4. Add the selectable `hubris-trap` narrative preset without changing existing projects or introducing a preset database.

The existing single-chapter regeneration flow remains streaming and behaviorally unchanged except that its prompt receives the new chapter narrative metadata when available. Finalization remains synchronous, but its pre-voiceover duration estimate becomes word-based.

## Non-goals

- Adding a user-editable outline-review pause between outline and expansion.
- Hard-validating narrative quality, exact open-loop resolution, exact 100% word-budget use, or act-weight percentages.
- Detecting whether a topic is suitable for `hubris-trap` or automatically falling back to another preset.
- Supporting manual copy/paste for single-chapter regeneration.
- Adding a fourth preset, a generic user-defined motif system, a preset editor, or a preset collection.
- Increasing provider `max_tokens` as a substitute for batching.
- Changing the scene/asset model or adding a schema migration script.
- Adding a second progress/SSE protocol or making manual generation a job.

## Existing-repo constraints

- `script` imports `project` only through `src/server/modules/project/index.ts`.
- `project` remains the sole owner of `projects`, chapter persistence, and scene persistence.
- `job` remains generic; the worker registry is the only place that maps job types to handlers.
- AI keys and provider clients remain server/worker-only.
- `ChapterDoc` and `ProjectDoc` receive additive Zod defaults so existing Mongo documents remain readable without migration.
- `eslint.config.js` remains unchanged and no client DOM-testing dependency is added.
- `AGENTS.md` and the relevant `MODULE.md` files are updated in the same meaningful commits as code changes.
- Tests use mocked AI clients and `mongodb-memory-server`; provider network calls are never made by automated tests.

## 1. Shared narrative and word-budget contracts

### Pacing constant and word counting

Add one shared constant:

```ts
export const NARRATION_WORDS_PER_MINUTE = 150;
```

The total budget is calculated by the server from the persisted project duration:

```ts
totalWordBudget = Math.round(project.targetDurationSec / 60 * NARRATION_WORDS_PER_MINUTE);
```

Word counting is a dependency-free shared helper used by server duration logic and client review display. It counts non-empty whitespace-delimited tokens (`/\S+/gu`) and does not attempt language-specific linguistic segmentation. Punctuation remains attached to its token; the count is a pacing estimate, not a linguistic quality score.

For an individual paragraph or chapter:

```ts
estimatedDurationSec = Math.max(1, Math.round(wordCount / NARRATION_WORDS_PER_MINUTE * 60));
```

The minimum of one second prevents very short non-empty narration from becoming a zero-duration scene. Empty legacy paragraphs use the same minimum safeguard when finalized.

### Persisted chapter metadata

Extend `ChapterDocSchema` additively with defaults:

```ts
role: z.enum(['hook', 'context', 'rising', 'climax', 'resolution']).nullable().default(null),
beat: z.string().default(''),
targetWords: z.number().int().positive().nullable().default(null),
endsOnTension: z.boolean().default(false),
```

Newly generated outline chapters always populate all four values. Legacy chapters normalize to `null`, `''`, `null`, and `false`; this is backward-compatible and requires no migration. `regenerateChapter` includes whichever metadata is available and keeps working for legacy chapters with null metadata.

Add shared contracts for:

```ts
type NarrativeRole = 'hook' | 'context' | 'rising' | 'climax' | 'resolution';

type OpenLoop = {
  question: string;
  plantedInChapter: number;
  resolvedInChapter: number;
};

type HubrisMotif = {
  hunter: string;
  perfectPlan: string;
  blindSpot: string;
  selfDestruction: string;
};
```

Extend `ProjectDocSchema` and `ProjectDetailSchema` with:

```ts
openLoops: z.array(OpenLoopSchema).default([]),
motif: HubrisMotifSchema.nullable().default(null),
```

Existing projects read as `openLoops: []` and `motif: null`. The project service maps and persists these fields through its existing project-owned chapter mutation path.

### Preset IDs

Change the shared constant to:

```ts
export const SCRIPT_PRESET_IDS = ['documentary', 'explainer', 'hubris-trap'] as const;
```

The addition is additive. Existing documents containing `documentary` or `explainer` remain valid.

## 2. Three explicit AI response shapes and parsers

The three AI responses are deliberately not represented by one overloaded parser. Each has its own schema and parser:

### 2.1 Outline response: `ScriptOutlineSchema` / `parseScriptOutline`

The outline call returns one root object:

```json
{
  "chapters": [
    {
      "no": 1,
      "title": "...",
      "role": "hook",
      "beat": "One sentence describing what happens in this chapter.",
      "targetWords": 240,
      "endsOnTension": true
    }
  ],
  "openLoops": [
    { "question": "...", "plantedInChapter": 1, "resolvedInChapter": 4 }
  ],
  "motif": {
    "hunter": "...",
    "perfectPlan": "...",
    "blindSpot": "...",
    "selfDestruction": "..."
  }
}
```

`parseScriptOutline(raw, presetId)` selects a strict preset-specific root schema:

- `documentary` and `explainer`: `chapters` and `openLoops` are required; `motif` is absent.
- `hubris-trap`: `chapters`, `openLoops`, and a fully populated `motif` are required.

The shared chapter fields and role enum are identical for all presets. The parser rejects a motif on non-hubris output and rejects a missing motif on hubris output. It also rejects empty chapter arrays, invalid positive integer fields, invalid open-loop chapter references, and malformed JSON/fences.

If `project.chapterCount` is non-null, the outline must contain exactly that many chapters. If it is null, the AI chooses a count in the existing allowed range of 1–20; the project field remains null because the user did not explicitly set a count. The count rule is structural, not a narrative-quality check.

The outline prompt receives `totalWordBudget`, the selected preset, the project brief, and the requested chapter-count rule. It asks for positive `targetWords` whose sum approximately follows the total budget. The implementation does not hard-reject a small allocation mismatch or force exact act percentages.

### 2.2 Expansion response: `ChapterExpansionSchema` / `parseChapterExpansion`

Each automatic per-chapter call returns only one chapter's expansion:

```json
{
  "paragraphs": ["...", "..."],
  "styleNote": "A bounded continuity note for the next chapter."
}
```

`parseChapterExpansion(raw)` owns this shape, JSON/fence handling, non-empty paragraph validation, and the maximum 500-character `styleNote`. It is not the outline parser and does not accept chapter metadata, open loops, or a chapter array.

The prompt receives the chapter's `title`, `beat`, `role`, `targetWords`, `endsOnTension`, the project brief/language/preset, a bounded previous `styleNote`, and open loops planted in or due to that chapter. It asks for concrete, speakable paragraphs and for unresolved tension to carry forward when `endsOnTension` is true.

After parsing, the server counts words. If the result is below 80% of `targetWords`, it makes exactly one retry containing the actual count, target count, and an explicit request to write longer and add relevant detail. The second valid response is accepted regardless of its word count. A parse/provider failure is logged as a chapter failure and does not block later chapters.

### 2.3 Manual combined response: `ManualScriptDocumentSchema` / `parseManualScriptDocument`

Manual mode uses one combined prompt and one combined response, because the external chat is not constrained by the server's API token budget. Its shape is:

```json
{
  "chapters": [
    {
      "no": 1,
      "title": "...",
      "role": "hook",
      "beat": "...",
      "targetWords": 240,
      "endsOnTension": true,
      "paragraphs": ["...", "..."]
    }
  ],
  "openLoops": [],
  "motif": null
}
```

`parseManualScriptDocument(raw, presetId)` has its own root schema and parser. It is a composed superset of the outline chapter fields plus `paragraphs`, reusing the same field schemas and preset-specific motif rule, but it is not an alias of `ScriptOutlineSchema` or `ChapterExpansionSchema`. It validates the requested chapter count, chapter metadata, paragraphs, open loops, and hubris motif in one synchronous parse.

All three parsers normalize into an internal persistence input. A shared `saveGeneratedScript(projectId, chapters, openLoops, motif)` function owns ID assignment, status initialization, metadata mapping, and the project-module calls. “Shared save path” means this persistence operation is shared; it does not mean the three response shapes share one Zod schema.

## 3. Automatic outline-to-expansion job

The existing `POST /api/project/:id/generate-script` endpoint and `generate-script` job type remain. The job changes from one provider call to an unconditional two-stage sequence; there is no chapter-count or duration threshold.

### Outline stage

The handler checks cancellation, loads the project, computes the total word budget, builds the outline prompt, calls the selected provider, and parses `ScriptOutlineSchema`. No chapter content is persisted before the outline is structurally valid. Once valid, the job initializes the project with outline-backed chapters (empty paragraphs, `pending`/`generating` state as appropriate), `openLoops`, and `motif` through project's public API.

The outline's `no` values are normalized to persisted one-based order after validation; titles and narrative metadata are retained. `chapterCount` is not changed when it was null.

### Expansion stage

Chapters expand sequentially in outline order. The job uses the existing job context with real `reportProgress`, `isCancelled`, and `appendLog` wiring in `handleGenerateScript`.

- Cancellation is checked before every provider call, after every provider response, and before each project write.
- A cancelled in-flight response is discarded and not persisted.
- A chapter with a provider/parse/write failure is logged and marked `needs-fix`; later chapters continue.
- Successful chapters are persisted as `pending` with their paragraphs and outline metadata.
- Progress reports outline completion and then chapter completion through the existing job SSE state; no second progress protocol is introduced.
- A rerun replaces the generated draft through the same generation save path, while manual edits after generation remain governed by the existing chapter-edit behavior.

The worker remains the only job entry point. No direct `projects` collection access is added to `script`.

## 4. Duration display and finalization

### Review UI

`chapter-actions.ts` gains pure helpers for word count and estimated duration. `chapterMetaText` and `chaptersSummaryText` use actual paragraph word counts while a chapter is being reviewed:

- Chapter metadata shows scene/paragraph count plus estimated seconds from actual words, not the old evenly split target duration.
- The summary totals estimated chapter seconds from actual words.
- Before paragraphs exist, the UI does not show a misleading duration estimate.

The existing `Dàn ý` stepper label remains, but its state reflects the real outline-backed generation sequence rather than implying a separate user review screen.

### Finalization

`finalizeScript()` keeps its synchronous API, approval checks, chapter-history behavior, empty visual prompts, and `assets` transition. It replaces the even `targetDurationSec / paragraphCount` split with per-scene estimates from each narration's word count using `NARRATION_WORDS_PER_MINUTE` and `Math.max(1, ...)` for non-empty/empty short narration. Chapter `durationSec` becomes the sum of its scene estimates.

The target duration remains the input to outline budgeting; it is no longer forced to equal the sum of pre-voiceover scene estimates. Voiceover generation may later replace those estimates with measured audio duration.

## 5. Single-chapter regeneration

`regenerateChapter` stays a streaming request with the existing request/response lifecycle, cancellation, parse behavior, history behavior, and one-chapter persistence.

`buildRegenerationPrompt` adds the available chapter metadata:

- narrative role,
- beat,
- target word count,
- whether the chapter should end on tension.

The prompt tells the provider to preserve the chapter's target length and narrative function. It does not introduce automatic word-floor retries, neighboring-chapter context, or open-loop resolution validation. Legacy chapters with null metadata continue through the current prompt shape with those fields omitted or marked unavailable.

## 6. Provider selection and route ownership

`AI_PROVIDERS` remains the source of truth for `deepseek` and `claude`; no contract change is needed for the provider values.

### Creation UI

`NewProjectForm.tsx` adds a registered `aiProvider` select alongside the existing script-preset select. Its default remains `deepseek`.

### Existing-project UI

Add `setProjectAiProvider` to the project service and export it through `project/index.ts`. The HTTP route is intentionally owned by the `script` module because script is the consumer of `aiProvider`, following the existing render-engine precedent where the consumer module owns the route while `project` owns the mutation:

```text
PATCH /api/project/:id/ai-provider
body: { provider: 'deepseek' | 'claude' }
→ ProjectDetail
```

The route lives in `src/server/modules/script/routes.ts`, validates the provider using `AI_PROVIDERS`, and calls the public project API. It does not update the `projects` collection directly. `ReviewScriptPage.tsx` adds a DeepSeek/Claude selector near the initial generation and regeneration controls and refreshes the project after a successful change.

## 7. Manual/semi-automatic generation

Manual mode is a second initial-generation path, not a replacement for automatic generation and not a job.

### Server prompt endpoint

The script module exposes:

```text
GET /api/project/:id/generate-script/manual-prompt
→ { prompt: string, promptVersion: string }
```

The server builds a dedicated combined prompt from the same project/preset inputs. It flattens the system contract and user request into one clearly labeled, copyable block and asks the external model for a complete `ManualScriptDocument` JSON response. Preset guidance is intentionally included because copying the prompt is the feature; provider credentials and server-only configuration are never included. The prompt and pasted response are not persisted.

### Manual import endpoint

```text
POST /api/project/:id/generate-script/manual-import
body: { raw: string }
→ ProjectDetail
```

The route calls `parseManualScriptDocument(raw, project.scriptPresetId)`, then the same `saveGeneratedScript` persistence function used by the automatic path. It is synchronous because no server-side provider call occurs. Invalid pasted text returns the existing `SCRIPT_PARSE_ERROR` shape and does not alter the project.

### Client flow

`ReviewScriptPage` offers `Tự động` and `Thủ công` modes when no chapters exist:

- `Copy Prompt` fetches the combined prompt and copies it with `navigator.clipboard.writeText`.
- A textarea holds the user's pasted raw response locally.
- `Paste kết quả` submits it to the import endpoint.
- Import failures show inline/toast validation feedback while preserving the textarea contents for correction and retry.
- Successful import refreshes the project and enters the existing review flow.

No manual mode is added to chapter regeneration in this round.

## 8. `hubris-trap` preset

Add `src/server/modules/script/ai/presets/hubris-trap.md` with `version: 1`, and add the option to `NewProjectForm.tsx` with label `Kẻ đi săn kiêu ngạo (Hubris Trap)`.

### System guidance

Bạn là biên kịch chuyên viết video tài liệu theo mô-típ “Kẻ đi săn kiêu ngạo tự chui vào bẫy do chính mình giăng ra”. Đây không phải kể sự kiện theo trình tự thời gian, mà là dựng câu chuyện bi kịch có tính tất yếu: một bên có ưu thế vượt trội (quyền lực, công nghệ, tri thức, nguồn lực) tự tin xây dựng kế hoạch dựa hoàn toàn vào khung tư duy của họ — rồi chính khung tư duy đó có một điểm mù, đối thủ hoặc hoàn cảnh khai thác đúng điểm mù ấy bằng một hệ quy chiếu hoàn toàn khác, và cuối cùng chính thứ tạo nên ưu thế ban đầu quay lại hủy diệt kẻ mạnh. Mô-típ áp dụng được cho quân sự, kinh doanh, kỹ thuật, tài chính, thể thao và các lĩnh vực khác; không mặc định đây là câu chuyện chiến tranh.

### Instructions

Trước khi lên outline, xác định rõ bốn yếu tố và đưa vào trường `motif`: `hunter` (ai hoặc phe nào là kẻ đi săn), `perfectPlan` (tuyệt tác trên giấy của họ dựa trên logic nào), `blindSpot` (biến số nằm ngoài khung tư duy của họ và đối thủ hoặc hoàn cảnh khai thác bằng hệ quy chiếu khác ra sao), `selfDestruction` (chính yếu tố tạo nên ưu thế ban đầu quay lại hủy diệt họ).

Dùng bốn yếu tố để phân bổ năm hồi theo hướng dẫn 8% / 15% / 55% / 12% / 10%: Hook mở vào khoảnh khắc tự hủy diệt hoặc đỉnh điểm mâu thuẫn, không kể tuần tự; Bối cảnh giới thiệu kẻ đi săn và tuyệt tác trên giấy; Diễn biến chính làm điểm mù dần lộ diện và gài open-loop; Cao trào để điểm mù phát huy tác dụng và lật kèo; Kết chốt cú tự hủy diệt, giải các open-loop, rồi mở rộng ý nghĩa bằng một suy ngẫm. Mỗi chương trừ chương cuối kết bằng một câu tạo tension dẫn sang chương sau. Nhả chi tiết bất ngờ theo lớp, không liệt kê thông tin khô khan.

## 9. Testing and verification

### Contract and parser tests

- Test additive defaults for legacy `ChapterDoc` and `ProjectDoc` reads.
- Test the three parser names independently: outline/non-hubris, outline/hubris motif requirement, expansion shape and style-note bound, and manual combined shape.
- Test exact chapter-count behavior for explicit counts and bounded AI-selected counts when `chapterCount` is null.
- Test word counting, 80%-threshold retry, second-response acceptance, and minimum duration estimates.
- Test prompt-version propagation and regeneration metadata inputs.

### Job and project tests

- Test outline initialization followed by sequential expansion and exact progress/log behavior.
- Test cancellation before and after outline, between chapters, after provider response, and before a chapter write.
- Test one failed chapter continuing to later chapters and marking the failed chapter recoverably.
- Test `openLoops` and `motif` persistence, legacy defaults, and no direct project-collection access from script.
- Test finalization's word-based scene durations and empty visual prompts.

### Route and client tests

- Test `PATCH /api/project/:id/ai-provider` is mounted by script, validates the provider, and delegates the mutation through the project public API.
- Test manual prompt construction/response shape, manual import success, malformed JSON/schema failure, and preservation of the project on failure.
- Test the NewProjectForm preset/provider options and pure review word-count/duration helpers without adding a DOM dependency.
- Keep existing visual-prompt, regeneration, SSE, and job cancellation tests green.

Run the standard acceptance commands before implementation completion:

```text
npm run typecheck
npm run lint
npm test
npm run build
```

The build must copy all three Markdown presets into `dist/presets/`. Provider calls remain mocked, and the built client must contain no provider secrets.

## Documentation and process discipline

The implementation plan will split this work into bounded TDD tasks after this spec is approved. Implementation will proceed directly on the real `main` checkout, without an isolated worktree or separate implementer/reviewer subagents, as requested for this phase. Code, tests, self-review, and incremental commits remain required; no push is performed.

No implementation commit is authorized by this spec alone. The next gate is user review of this file, followed by an implementation plan.
