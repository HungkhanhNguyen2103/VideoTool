# Task 95.1 — Align and explain the config areas (UI polish, primary viewport 1920×1080)

You are the coder. Claude (planner/reviewer) wrote this brief; Hung decides. Read `AGENTS.md` first and obey it (rule 11: update Status in the SAME commit; never `git add -A`; keep each file's line endings, new files use LF; do not read or print `.env`; never push). The Claude CLI mode controls shown in Hung's screenshots exist only on `codex/task-94-claude-cli-script-gen` (tip `036f892`, which also contains Task 93), so branch from that tip: new branch `codex/task-95-1-config-ui-polish`. If Task 93/94 have been merged into `main` by the time you start, branch from `main` instead (check with `git branch --contains 036f892 main`). The dirty `src/server/modules/video/remotion.test.ts`, untracked plan files and untracked prompt files are not yours — leave them out of every commit; use a git worktree if that is safer.

## Scope and hard limits
- **UI only.** No API, contract, schema, worker or behaviour change. No new dependency. CSS Modules + existing tokens.
- **Keep every existing Vietnamese literal, `aria-label`, `id`, `htmlFor` and test hook exactly as is.** You may add new text/elements and change layout, never reword or remove existing strings. (This matters for the new-project label "Số chương dự kiến (tùy chọn)" below.)
- Do not touch the "Tiến độ pipeline" block itself; the Studio work is about the config cards ABOVE it.
- Browser checks use a `[verify-task-95-1]` duplicate of a project, never the original.

## Primary target: 1920 × 1080
Hung works at 1920×1080. Design and judge the layout there first: the pages must use that width sensibly (no cramped columns, no huge dead space, controls aligned on a consistent grid, sensible max-widths). Then confirm nothing breaks at 1440×900, 1280×900 and 390×844 (no horizontal page overflow at 390). The screenshots Hung sent were cropped to roughly 1470 px wide, so do not assume they show the full 1920 layout: capture the real current state at 1920×1080 first.

## What Hung reported
1. **Review & Tái Tạo → "Kịch bản theo chương" config box**, three modes: `Tự động (API)` / `Claude CLI (máy này)` / `Thủ công (JSON)`. The layout is inconsistent between modes, so the box jumps when switching: the AI select, the Model select, the mode buttons, the status pill ("Tự động bằng DeepSeek" / "Claude CLI trên máy này" / "Thủ công: tự dán JSON") and the helper lines sit differently in each. Specific problems: the pill floats at the right edge not aligned with the buttons row; in CLI mode the label "Model Claude CLI" and the line "Claude Code 2.1.294 (Claude Code) · phiên đăng nhập CLI" read awkwardly (duplicated "Claude Code"); the helper under Model ("Chi phí xem trên dashboard của Claude/DeepSeek.") makes the selects row uneven; in manual mode the AI select and the buttons share one row, unlike the other two modes. Goal: one stable structure (same rows, same heights, same alignment) for all three modes, with only the content of the Model field and the explanation line changing.
2. **New project form → "CẤU HÌNH KỊCH BẢN"**: the label "Số chương dự kiến (tùy chọn)" wraps to two lines, so its input sits lower than the neighbouring "Thời lượng mục tiêu (giây)" input (which also has the hint "≈ 3 phút"); the right column below it is dead space. Do NOT shorten or reword the label. Fix the grid so inputs align independent of label wrapping and hint rows (for example bottom/baseline alignment or a reserved label/hint track), and use the 1920 width well (the whole config section, including the preset/provider/model/style/duration/chapters fields, should look intentional, not left-stacked with gaps).
3. **Studio Phân Cảnh & Xuất Video → control area** (four cards "Scene & hình ảnh", "Âm thanh", "Giao diện video", "Render & xuất" above "Tiến độ pipeline"). Hung gave no screenshot: capture the current state at 1920×1080, 1280×900 and 390×844 on a duplicate with scenes, write down every misalignment you find (uneven card heights, label/control rows not on one grid, wrapping buttons, inconsistent spacing, hint paragraphs under inputs, the Remotion-effects fieldset, card grid proportions at 1920), include that list in your final report, then fix them. Do not stop to wait for approval.

## Explanations Hung asked for
Hung does not always remember what each control does. Add a short muted description (one or two lines, wording in Vietnamese) under or next to each control below. It must be visible on touch (not tooltip-only) and must not shift the layout between states; use a collapsed `<details>`/"?" disclosure only where a line would be too long, and decide inline vs disclosure yourself based on how dense it looks at 1920 and 390.

**The wording below is Claude's understanding and is UNVERIFIED.** Read the code behind each control and correct any sentence that is not exactly true. If you cannot confirm a behaviour, leave that description out and list it as "unverified" in the report.

Review & Tái Tạo — one line for the selected mode:
- Tự động (API): "Server gọi AI qua API key trong .env; nhanh, tính phí theo API."
- Claude CLI (máy này): "Chạy Claude Code cài trên máy này bằng phiên đăng nhập CLI; mỗi chương thường mất khoảng 1,5–3 phút." (use the app's own measured estimate numbers if they exist rather than this range)
- Thủ công (JSON): "Lấy prompt, dán vào AI bất kỳ, rồi dán JSON kết quả vào; không tốn API."

Studio (drafts to verify):
- Loại asset (All images / All videos): "Đặt loại asset (ảnh hoặc video) cho mọi scene chưa có asset."
- % scene video + Xem trước: "Chia tỷ lệ scene dùng video; xem trước trước khi áp dụng, scene đã có asset được giữ nguyên." (the existing hint about 'Tạo visual prompt' stays)
- Tách nhỏ scene: "AI tách scene dài thành các scene ngắn hơn."
- Tạo visual prompt: "AI điền prompt hình ảnh/chuyển động cho scene còn trống."
- Tạo voiceover: "Tạo giọng đọc cho từng scene."
- Căn thời gian từ: "Xác định thời điểm từng từ trong giọng đọc để popup tên/địa danh hiện đúng lúc từ đó được đọc. Lỗi căn không làm hỏng voiceover."
- Tính lại thời lượng theo voiceover: "Đặt lại thời lượng mỗi scene bằng độ dài voiceover cộng khoảng nghỉ cuối scene."
- Âm lượng SFX so với voiceover and Khoảng nghỉ cuối scene: keep existing hints; make spacing consistent.
- Tạo tất cả SFX / BGM: "SFX lấy từ Freesound theo từ khoá từng scene; BGM theo mood bạn nhập."
- Engine FFmpeg / Remotion: "FFmpeg: render nhanh, đơn giản. Remotion: có chuyển cảnh, pop-up chữ, hiệu ứng phim cũ, chiều sâu."
- Chữ pop-up / Chuyển cảnh / Hiệu ứng phim cũ / Hiệu ứng chiều sâu / Tạo depth map: one line each saying what it changes in the output; depth map is probably a prerequisite for the depth effect (verify).
- Phân tích tên popup: "AI chọn tên người/địa danh để hiện lower-third cho từng scene; cần voiceover đã căn thời gian từ." (verify)
- Render video / Render nháp (nhanh): describe how the draft differs (engine, quality, whether it replaces the main render) only after reading the code.
- Copy JSON / Export JSON / Import ZIP in the header: one line each if space allows.

## Verification (real, saved to disk)
- Before/after screenshots under `data/files/.verification/task-95-1/` at **1920×1080** (primary), 1280×900 and 390×844 for: Review config box in all three modes (plus the CLI-unavailable state if reachable), New project form "Cấu hình kịch bản", Studio control area (all four cards; FFmpeg and Remotion engine states). Every screenshot must be saved as a file; list the file names in the report. (Tasks 93 and 94 both lost screenshots by not saving them.)
- Mode switching on the Review page does not change the box height or the position of the mode buttons (check by measuring bounding boxes in the browser and report the numbers). No horizontal page overflow at 390 px. Keyboard focus order and visible focus preserved; grep that the set of `aria-label`/`id` values is unchanged before vs after.
- Tests: extend the existing source/helper tests (`review-script-page.test.ts`, `StudioPage.test.ts`, and the new-project form tests if present) to pin the preserved literals/ARIA labels and the new description texts. Run `npm run typecheck`, `lint`, `test`, `build` and report real counts; name any pre-existing failure (for example Task 87's `remotion.test.ts:688` if present in your tree).
- Update `AGENTS.md` Status and any touched module docs in the same commit(s). Report what was verified for real vs "unverified". Suggested commits: (1) Review config box + new-project form alignment, (2) Studio alignment, (3) descriptions + tests + docs.
