# Task 61 — Task 60 follow-ups; chapter regeneration: visible mode + manual JSON path; QA reasons in project language

Task 60 (`10e5f60`, QA reviewer model) is merged. Do this on top of it. Three separate commits: Part C first (small follow-up fixes to Task 60), then Part A, then Part B.

## Context (verified in code)
- First-time script generation has an "Tự động / Thủ công" toggle (`generationMode`) with a manual JSON path (`GET /:id/generate-script/manual-prompt`, `POST /:id/generate-script/manual-import`).
- Once chapters exist, the page shows no mode at all. `regenerateChapter` (`src/server/modules/script/service.ts` ~line 279) always streams from `getAiClient(project.aiProvider)`. There is no manual (copy prompt → paste JSON) path for regenerating a chapter, and nothing tells the user it is automatic or which AI is used (only the small "AI" dropdown).
- The QA issue `reason` text comes back in English even for a Vietnamese project (`buildQaPrompt` in `ai/build-prompt.ts` does not tell the model which language to use).

## Part A — make regeneration mode visible, and add a manual JSON path

### A1. Server (no behavior change to the automatic path)
1. In `service.ts`, extract two helpers from `regenerateChapter` and make the automatic path call them:
   - `buildRegenerationPromptForChapter(project, chapterId, opts)` → returns `{ prompt: BuiltPrompt, chapter, nextChapter }` using the exact same context object as today (core question, opening hook for chapter 1, loops, previous chapter summary/avoidRepeating/persistentFacts).
   - `applyRegeneratedChapter(projectId, chapter, nextChapter, raw)` → runs `parseRegeneratedParagraphs(raw)` and applies the same patch as today (paragraphs, `status: 'pending'`, chapterSummary, avoidRepeating, persistentFacts, `reviewStatus: 'clean'`, and marks the next chapter `upstream-changed`). Keep the Task 54 field-truncation behavior; manual import must go through the same parser.
2. New routes in `routes.ts`:
   - `POST /:id/chapters/:chapterId/regenerate/manual-prompt` body `{ instruction: string, level: 'light'|'medium'|'rewrite' }` → `{ prompt: "SYSTEM\n…\n\nUSER\n…", promptVersion }` (same shape/format as the existing manual script prompt). No AI call, no state change, no `generating` status.
   - `POST /:id/chapters/:chapterId/regenerate/manual-import` body `{ raw: string }` → applies `applyRegeneratedChapter`, returns the updated chapter (same response shape as the automatic regenerate). Parse/validation errors return the same 4xx error shape as `manual-import` for scripts, and must leave the chapter unchanged (do not leave it in `needs-fix`/`generating`). 404 for an unknown chapter, 409 when the project version check applies elsewhere.
3. Do not add a new job type; both endpoints are synchronous.

### A2. Client (`ReviewScriptPage.tsx`, `api.ts`)
1. In the chapters panel header, add a mode toggle for regeneration mirroring the first-run toggle: radio `Tự động` / `Thủ công (JSON)`, state `regenMode` (default `automatic`). Next to it show a muted line:
   - automatic: `Tái tạo tự động bằng <DeepSeek|Claude>`
   - manual: `Tái tạo thủ công: lấy prompt, dán vào AI bất kỳ, rồi dán JSON kết quả vào`
   Disable the toggle while any generation/regeneration is busy (reuse `controlsBusy`).
2. Manual mode UI, per chapter (the existing per-chapter "Tái tạo" button):
   - Button label becomes `Lấy prompt tái tạo`. Clicking it calls `manual-prompt` with the current instruction/level from the right-hand "Yêu cầu tái tạo" panel and opens an inline box under that chapter (same pattern as the first-run `manualBox`): prompt version, `Sao chép` button, textarea with placeholder showing the expected shape `{"paragraphs":[…],"chapterSummary":"…","avoidRepeating":[…],"persistentFactsNext":[…]}`, and `Nhập chương` button calling `manual-import`. After success: refresh project/chapter data, clear the box, toast `Đã nhập chương <no>.`; on error: show the server message in the box, keep the pasted text.
   - Bulk buttons (`Tái tạo chương đã chọn`, `Tái tạo toàn bộ`) are disabled in manual mode with a `title` explaining `Chế độ thủ công chỉ tái tạo từng chương`.
3. Vietnamese text with proper diacritics; reuse existing styles/tokens; do not touch the automatic regenerate flow or streaming preview.

### A3. Tests
- Server: manual-prompt returns the same prompt text that the automatic path would send for the same input (assert equality against `buildRegenerationPrompt` output) and does not change chapter status; manual-import applies paragraphs/summary/avoidRepeating/persistentFacts, sets `status: 'pending'`, `reviewStatus: 'clean'`, marks next chapter `upstream-changed`; invalid JSON → 4xx and chapter unchanged; unknown chapter → 404; automatic regenerate still passes unchanged (existing tests).
- Client: toggle shows the correct muted line in each mode; in manual mode the per-chapter button reads `Lấy prompt tái tạo`, bulk buttons are disabled with the title; import success/failure paths.

Commit: `feat(script): manual JSON path for chapter regeneration`.

## Part B — QA reasons in the project's language
1. `buildQaPrompt(project)` (`ai/build-prompt.ts`): add a line to the system or user message using the same `language(project)` helper as other prompts: the `reason` field must be written in that language; enum values (`type`, `severity`, `suggestedAction`) stay unchanged English tokens.
2. Test: for a `vi` project the QA prompt instructs Vietnamese reasons and keeps the enum tokens; for `en` it instructs English. No schema change.
3. Do not change how results are parsed or displayed.

Commit: `fix(script): write QA reasons in project language`.

## Out of scope
Choosing a different QA model/provider, changing the first-run manual flow, new job types, any change to Task 54 truncation behavior.

## Verification
Typecheck, lint, full tests pass. Manually: on a project with chapters, (1) confirm the mode line shows in both modes, (2) in manual mode fetch a prompt for chapter 1, paste a valid JSON and a deliberately broken JSON, confirm results, (3) run QA on a Vietnamese project and report the language of the first issue's reason. Report the commit hashes, files changed, tests added. No `.env` changes, no deletions, no secrets in the report.


## Part C — follow-ups to Task 60 (`10e5f60`), do first
Review of `10e5f60` found three wording/logic issues in `qaReviewerDisplay` (`ReviewScriptPage.tsx`) and its hint. Server side is fine; do not change it.

1. Legacy result is mislabeled. A stored QA result without `reviewedBy` currently renders `Đã kiểm tra bằng: <current project provider> · Model: không có thông tin`. That attributes an old result to the CURRENT provider, which may be wrong if the provider was changed after the run. Fix: when `reviewedBy` is missing, render exactly `Đã kiểm tra: không có thông tin về model` and no provider name, and no hint.
2. Stale reviewer vs next run. After a run, the line `Sẽ kiểm tra bằng: …` disappears, so if the user then changes the AI dropdown they cannot see which model the NEXT run will use. Fix: when a result exists AND `reviewedBy.provider` differs from the project's current `aiProvider`, show two muted lines: `Lần kiểm tra trước: <provider> · <model>` and `Lần chạy tiếp theo: <current provider label>`. When they are equal keep the single `Đã kiểm tra bằng: …` line.
3. The hint overclaims. `Cùng nhà cung cấp với bước viết kịch bản…` asserts the script was written by the same provider, but the project does not record which provider wrote the script (the user can switch the AI dropdown any time). Reword to what is actually true, and show it only when `reviewedBy` exists:
   `Model kiểm tra có thể bỏ sót các lỗi giống model đã viết kịch bản nếu hai bên cùng nhà cung cấp. Hãy đối chiếu số liệu với tài liệu tham khảo.`
   Do not add new persistence for the script provider in this task.

Tests: update the existing `qaReviewerDisplay` tests for the three cases (legacy result, provider changed after run, same provider) with the exact strings above; keep the "before run" case unchanged.
Commit: `fix(script): clarify QA reviewer display`.

Also confirm in the report which provider/model the Bạch Đằng QA smoke used and whether the project's AI dropdown was Claude or DeepSeek at that moment (one sentence), because the user's screenshot showed Claude.
