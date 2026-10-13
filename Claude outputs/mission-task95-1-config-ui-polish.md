# Mission — Task 95.1: align and explain the config areas (UI polish, no behaviour change)

Crew: video-tool-pair (lead @planner, worker @coder). Working directory: `E:\ToolV2\ProjectHK\video-tool`. Follow the crew's Team conventions and Definition of done exactly. Branch name: `task/95-1-config-ui-polish`.

## Base and safety
- The new "Claude CLI" mode controls exist only on `codex/task-94-claude-cli-script-gen` (tip `036f892`; it also contains Task 93). Branch from that tip, not from `main`. Do not merge or push anything.
- The main checkout has unrelated uncommitted work (Task 87 `remotion.test.ts`, untracked plan files). Prefer `git worktree add` for this task so that work is never touched. Never `git add -A`.
- UI only. No API, schema, contract, worker or behaviour changes. No new dependencies. Keep every existing Vietnamese literal, `aria-label`, `id`, `htmlFor` and test hook exactly as it is (only add new text/elements). CSS Modules + existing tokens. Do not touch the "Tiến độ pipeline" block itself; this task is about the config areas ABOVE it and the other listed screens.
- Real browser checks must use a `[verify-task-95-1]` duplicate of a project, never the original.

## What Hung reported (screenshots from Hung, described here)
1. **Review & Tái Tạo → "Kịch bản theo chương" config box**, three modes (Tự động (API) / Claude CLI (máy này) / Thủ công (JSON)). The layout is not consistent: the AI + Model selects, the mode buttons, the status pill ("Claude CLI trên máy này", "Tự động bằng DeepSeek", "Thủ công: tự dán JSON") and the helper line below all sit differently in each mode, so the box jumps when switching modes; the pill floats at the right edge not aligned with the buttons row; in CLI mode the Model label ("Model Claude CLI") and the helper line ("Claude Code 2.1.294 (Claude Code) · phiên đăng nhập CLI") read awkwardly; the helper under Model ("Chi phí xem trên dashboard của Claude/DeepSeek.") makes the selects row uneven; manual mode puts the AI select and the buttons on one row, unlike the other two.
2. **New project form → "CẤU HÌNH KỊCH BẢN"**: the field "Số chương dự kiến (tùy chọn)" has a label that wraps to two lines, so its input sits lower than the neighbouring "Thời lượng mục tiêu (giây)" input (which also has a hint "≈ 3 phút"). The row looks misaligned and the right column has dead space. Do NOT shorten or reword the label (literals are protected); fix the grid so inputs align regardless of label wrapping (for example shared baseline/bottom alignment or a reserved hint row) at 1280, 900 and 390 widths.
3. **Studio Phân Cảnh & Xuất Video → control area** (the four cards "Scene & hình ảnh", "Âm thanh", "Giao diện video", "Render & xuất" above "Tiến độ pipeline"): review it the same way. Hung gave no screenshot, so FIRST capture the current state at 1280×900, 900×800 and 390×844 on a duplicate with scenes, list every misalignment you find (label/control rows, uneven card heights, wrapping buttons, inconsistent spacing, the nested hint paragraphs under inputs, the Remotion-effects fieldset), and put that list in the task file for @planner before fixing.

## Explanations Hung asked for
Hung does not always remember what each control does. Add a short muted one-line description (max ~2 lines) under or next to each control below; use a collapsed `<details>`/"?" disclosure only if a line would be too long. It must work on touch (not tooltip-only) and must not shift layout between states. The drafts below are Claude's understanding, **not verified**: @coder must read the code behind each control and correct any sentence that is not exactly true before using it. If a behaviour cannot be confirmed, say "unverified" in the report and leave that description out.

Review & Tái Tạo (mode explanations, one line each, shown for the selected mode):
- Tự động (API): "Server gọi AI qua API key trong .env; nhanh, tính phí theo API."
- Claude CLI (máy này): "Chạy Claude Code cài trên máy này bằng phiên đăng nhập CLI; mỗi chương thường mất khoảng 1,5–3 phút." (use the measured numbers already in the app's estimate if they exist)
- Thủ công (JSON): "Lấy prompt, dán vào AI bất kỳ, rồi dán JSON kết quả vào; không tốn API."

Studio (drafts to verify):
- Loại asset: All images / All videos — "Đặt loại asset (ảnh hoặc video) cho mọi scene chưa có asset."
- % scene video + Xem trước — "Chia tỷ lệ scene dùng video; xem trước trước khi áp dụng, scene đã có asset được giữ nguyên." (the existing hint about 'Tạo visual prompt' stays)
- Tách nhỏ scene — "AI tách scene dài thành các scene ngắn hơn."
- Tạo visual prompt — "AI điền prompt hình ảnh/chuyển động cho scene còn trống."
- Tạo voiceover — "Tạo giọng đọc cho từng scene."
- Căn thời gian từ — "Xác định thời điểm từng từ trong giọng đọc để popup tên/địa danh hiện đúng lúc từ đó được đọc. Lỗi căn không làm hỏng voiceover."
- Tính lại thời lượng theo voiceover — "Đặt lại thời lượng mỗi scene bằng độ dài voiceover cộng khoảng nghỉ cuối scene."
- Âm lượng SFX so với voiceover and Khoảng nghỉ cuối scene — keep the existing hints; make their spacing consistent.
- Tạo tất cả SFX / BGM — "SFX lấy từ Freesound theo từ khoá từng scene; BGM theo mood bạn nhập."
- Engine FFmpeg / Remotion — "FFmpeg: render nhanh, đơn giản. Remotion: có chuyển cảnh, pop-up chữ, hiệu ứng phim cũ, chiều sâu."
- Chữ pop-up / Chuyển cảnh / Hiệu ứng phim cũ / Hiệu ứng chiều sâu / Tạo depth map — one line each saying what it changes in the output; depth map = prerequisite for the depth effect (verify).
- Phân tích tên popup — "AI chọn tên người/địa danh để hiện lower-third cho từng scene; cần voiceover đã căn thời gian từ." (verify)
- Render video / Render nháp (nhanh) — say how the draft differs (engine, quality, whether it replaces the main render) only after reading the code.
- Copy JSON / Export JSON / Import ZIP in the header — one line each if space allows.

## Process (per crew conventions)
1. @planner writes the task file from this mission (include the defect list from step 3 above once @coder reports it). 2. @coder posts a short plan including the proposed layout approach and where each explanation lives. 3. @planner replies ACCEPTED or asks Hung for design decisions (for example inline text vs "?" disclosure if inline looks too dense). 4. Implement, commit on the branch, report.

## Verification (real, saved)
- Before/after screenshots under `data/files/.verification/task-95-1/` at 1280×900, 900×800 and 390×844 for: Review config box in all three modes (including CLI unavailable state if reachable), New project form "Cấu hình kịch bản", Studio control area (all four cards, FFmpeg and Remotion engine states). Every screenshot must be saved to disk; list the file names in the report.
- No horizontal page overflow at 390 px; mode switching does not move the box height or the buttons; keyboard focus order and visible focus preserved; existing ARIA labels unchanged (grep before/after).
- Focused tests: extend the existing source/helper tests (`review-script-page.test.ts`, `StudioPage.test.ts`, new-project form tests if present) to pin literals/ARIA labels and the new description texts. Then typecheck, lint, full test, build with real counts. Name any pre-existing failure (e.g. Task 87's `remotion.test.ts:688` if present in the tree).
- Update AGENTS.md Status and any touched module docs in the same commit. Report what was verified vs "unverified".
