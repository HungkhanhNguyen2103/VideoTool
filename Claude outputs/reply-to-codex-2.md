Xác nhận: thiết kế này khớp tốt với prompt đã gửi, không có điểm nào lệch cần chỉnh. Cứ tiếp tục viết code, chạy test, và commit.

Hai lưu ý nhỏ, không phải yêu cầu đổi thiết kế, chỉ để cân nhắc khi cài đặt:

1. **Drain hàng đợi trong 1 tick** — hợp lý để giảm latency. Chỉ cần đảm bảo giữa mỗi lần claim liên tiếp trong cùng một tick, worker vẫn kiểm tra cờ `closing`/tín hiệu shutdown, để Ctrl+C không phải đợi drain hết một đợt job dồn dập mới thoát. Rủi ro này bằng 0 ở Phase 2 (chưa ai enqueue job thật), nhưng viết đúng ngay từ đầu để Phase 4/5 không phải sửa lại.
2. **Tần suất gọi `recoverStaleJobs`** — gọi mỗi tick (2s) hay định kỳ thưa hơn đều chấp nhận được, vì đây chỉ là một `updateMany` rẻ dựa trên index `{status, runAt}`. Không cần ép về "mỗi N tick" như gợi ý ban đầu trong prompt nếu gọi mỗi tick đơn giản hơn.

Tiến hành theo đúng luật đã thống nhất:
- Test bằng `mongodb-memory-server` (nếu không tải được thì dùng phương án dự phòng và ghi rõ lý do).
- Cập nhật `AGENTS.md` / `modules/job/MODULE.md` / mục `## Status` trong cùng commit với mỗi thay đổi có ý nghĩa (luật số 11).
- Không sửa boundary rules trong `eslint.config.js`.
- Không dùng `git add -A`/`git add .` — chỉ add đúng file có nội dung thay đổi thật (bỏ qua ~80+ file chỉ khác CRLF/LF).
- Không tạo `POST /api/job`/`GET /api/job` công khai, không implement handler thật (asset/video), không đụng file-store/upload/ZIP — những phần đó nằm ở Prompt 2, chưa gửi.
- Không push.

Xong thì báo cáo lại theo đúng format ở mục 6 của prompt: việc đã làm theo checklist, file đã đổi, lệnh để chạy thử, quyết định tự đưa ra ngoài prompt, việc còn thiếu/câu hỏi, và xác nhận đã sẵn sàng nhận Prompt 2 hay chưa.
