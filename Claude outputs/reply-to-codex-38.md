# Updated brief: outline with word budget/retention, a new narrative preset, plus the earlier provider/manual-mode work

This supersedes Requirement 1 of `reply-to-codex-37.md` with a much more concrete design (below). Requirements 2 and 3 from that brief (AI provider selection in the UI, manual/semi-automatic copy-paste generation mode) are unchanged — carry them forward into the same spec. Everything here still queues after the just-accepted preset/visual-prompt phase, which it is already built on (`ai/build-prompt.ts`, `ai/output-schema.ts`, `ai/parse-output.ts`, `presets/loader.ts`).

## Why this replaces the old Requirement 1

The original ask was just "split one big call into outline + per-chapter calls to avoid truncation." Working through it with the user surfaced a second, related problem visible in real testing: with no per-chapter word target, `generateScript()` produces chapters that are far too short to add up to the requested `targetDurationSec` — a real 900s/18-chapter test run produced a first chapter of only 2 short paragraphs (well under what 900s ÷ 18 requires). The fix for truncation (batching) and the fix for under-length chapters (word budgeting) are the same mechanism, so they're specified together now.

## Requirement 1 (revised): outline with word budget, retention shape, and per-chapter expansion

### Pacing constant

Add one constant, e.g. `NARRATION_WORDS_PER_MINUTE = 150`, used to convert `targetDurationSec` into a total word budget: `totalWordBudget = Math.round(targetDurationSec / 60 * 150)`.

### Outline call (AI call #1)

Replace the current single call with an outline call that returns, for every chapter:

```ts
{
  no: number,
  title: string,
  role: 'hook' | 'context' | 'rising' | 'climax' | 'resolution',
  beat: string,        // one sentence: what happens in this chapter
  targetWords: number, // this chapter's share of totalWordBudget
  endsOnTension: boolean, // true for every chapter except the last
}
```

Plus, at the script level: `openLoops: Array<{ question: string, plantedInChapter: number, resolvedInChapter: number }>` — questions/details planted early that a later chapter must pay off.

The prompt must give the AI `totalWordBudget` and instruct it to allocate `targetWords` per chapter according to a 5-act weighting, not an even split. Default weighting (guidance, not a hard-validated constraint): hook ~8%, context ~15%, rising ~55%, climax ~12%, resolution ~10%. This weighting applies to `documentary` and the new `hubris-trap` preset (below); `explainer` should use its own simpler shape — recommend a flatter, mostly-`rising`-role sequence without forcing a climax/hook structure onto explainer content, since it doesn't naturally have one. Decide the exact `explainer` shape in the spec.

### Per-chapter expansion calls (AI call #2..N)

Same sequential-per-chapter/cancellation/progress pattern as visual-prompt generation. Each call receives that chapter's `beat`, `role`, `targetWords`, `endsOnTension`, any `openLoops` planted or due to resolve in this chapter, and a running style-continuity note from the previous chapter (same mechanism already built for visual prompts).

**Word-count safety net:** after a chapter's paragraphs come back, count words. If under 80% of `targetWords`, retry once with the actual/target counts and an explicit "write longer, add detail" instruction; accept the second response regardless (same conservative one-retry-then-accept shape used for visual-prompt validation, to avoid unbounded loops). Do not hard-fail a chapter for being short — under-length is a quality issue to flag, not a structural error like a bad visual-prompt index.

### Duration display fix

While in this area: `ReviewScriptPage` currently shows scene/chapter duration from `sceneDurations()` (an even split of `targetDurationSec` across all paragraphs), which is why the user saw a chapter that felt too short to read in the time shown. Once chapters carry `targetWords`, show the review UI an estimate derived from actual word count (`wordCount / 150 * 60`) instead of the even split, so a genuinely short chapter is visible as short *before* finalization, not discovered later at voiceover time. Confirm in the spec whether `finalizeScript()`'s actual scene `durationSec` (used before voiceover overwrites it) should also switch to this word-based estimate instead of the even split — recommend yes, for the same reason.

### Explicitly out of scope for Requirement 1

- A UI step where the user reviews/edits the outline before per-chapter expansion runs. Recommend the job runs outline → expansion continuously, no pause — matches the existing single-job/single-progress-bar UX and the visual-prompt job's shape. Revisit only if real use shows a need to catch bad outlines earlier.
- Mechanically validating `openLoops` get resolved, or that word counts hit exactly 100% of target, or any other narrative-quality check beyond the 80%-of-target word floor above. Structural/shape validation (JSON, indexes) stays mechanical, as in visual prompts; narrative quality is not something to hard-validate.
- Changing `regenerateChapter`'s context or behavior beyond also receiving `targetWords`/`role`/`endsOnTension` for the chapter being regenerated, so a regenerated chapter doesn't regress to no word target.

## Requirement 4 (new): add a third script preset, `hubris-trap`

Add `'hubris-trap'` to `SCRIPT_PRESET_IDS` in `src/contracts/project.ts` (becomes `['documentary', 'explainer', 'hubris-trap']` — additive, no migration, existing projects unaffected). Add it to the preset `<select>` in `NewProjectForm.tsx` (label: "Kẻ đi săn kiêu ngạo (Hubris Trap)") alongside the existing documentary/explainer options.

This is a distinct, user-selectable preset — not a default folded into `documentary`. A project only gets this narrative treatment when the user picks it for a topic that actually fits.

### `hubris-trap.md` (`version: 1`) — use this content as the starting draft

**System guidance:** Bạn là biên kịch chuyên viết video tài liệu theo mô-típ "Kẻ đi săn kiêu ngạo tự chui vào bẫy do chính mình giăng ra". Đây không phải kể sự kiện theo trình tự thời gian, mà là dựng câu chuyện bi kịch có tính tất yếu: một bên có ưu thế vượt trội (quyền lực, công nghệ, tri thức, nguồn lực) tự tin xây dựng kế hoạch dựa hoàn toàn vào khung tư duy của họ — rồi chính khung tư duy đó có 1 điểm mù, đối thủ/hoàn cảnh khai thác đúng điểm mù ấy bằng một hệ quy chiếu hoàn toàn khác, và cuối cùng chính thứ tạo nên ưu thế ban đầu quay lại hủy diệt kẻ mạnh. Mô-típ này áp dụng được cho mọi lĩnh vực (quân sự, kinh doanh, kỹ thuật, tài chính, thể thao...), không giới hạn chủ đề chiến tranh.

**Instructions:** Trước khi lên outline, xác định rõ 4 yếu tố và đưa vào một trường `motif` ở outline: `hunter` (ai/phe nào là kẻ đi săn), `perfectPlan` (tuyệt tác trên giấy của họ dựa trên logic nào), `blindSpot` (biến số nằm ngoài khung tư duy của họ, đối thủ khai thác bằng hệ quy chiếu khác ra sao), `selfDestruction` (chính thứ gì đã tạo nên ưu thế ban đầu quay lại hủy diệt họ). Dùng 4 yếu tố này để phân bổ 5 hồi: Hook (~8%, mở vào khoảnh khắc tự hủy diệt hoặc đỉnh điểm mâu thuẫn, không theo trình tự thời gian), Bối cảnh (~15%, giới thiệu kẻ đi săn và tuyệt tác trên giấy), Diễn biến chính (~55%, điểm mù dần lộ diện, gài open-loop), Cao trào (~12%, điểm mù phát huy tác dụng, lật kèo), Kết (~10%, cú chốt tự hủy diệt, giải các open-loop, kết bằng một suy ngẫm mở rộng ý nghĩa). Mỗi chương trừ chương cuối kết bằng một câu tạo tension dẫn sang chương sau. Nhả chi tiết bất ngờ theo lớp, không liệt kê thông tin khô khan.

Add the `motif` object (`hunter`, `perfectPlan`, `blindSpot`, `selfDestruction`) to the outline schema as an optional field — required/populated only when `scriptPresetId === 'hubris-trap'`, absent for `documentary`/`explainer`. Decide in the spec exactly how the outline schema conditionally includes it (a preset-specific schema variant, or one optional field validated only when present) without weakening the shared `role`/`beat`/`targetWords`/`endsOnTension` shape every preset uses.

### Explicitly out of scope for Requirement 4

- Any mechanism to detect when a topic doesn't fit the hubris-trap motif and warn the user — the preset choice itself is the user's signal that the topic fits; no runtime fallback logic needed.
- A fourth preset or a generic "pick your own narrative motif" system — just this one addition for now.

## What to send back

A design spec covering the revised Requirement 1 (outline schema, word budget, per-chapter expansion, word-count retry, duration display fix), Requirement 4 (new preset, contracts/UI change, exact markdown content — refine the drafted Vietnamese wording if you see a way to make it clearer, but keep the same 4-element motif and 5-act shape), and Requirements 2–3 from `reply-to-codex-37.md` unchanged. Same review flow as always — I'll review the spec before any implementation plan, and the user plans to test this hands-on once it ships and may bring back concrete adjustments from real runs rather than everything being nailed down up front.
