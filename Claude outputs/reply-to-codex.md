Xác nhận: thiết kế thực thi của bạn ổn, cứ bắt đầu chạy dịch vụ, kiểm thử, sửa lỗi và commit theo đúng 7 bước đã liệt kê.

Vài lưu ý trước khi bạn chạy:

## MongoDB "Running" nhưng chưa thấy listener ở 27017

Trước khi kết luận cần "khôi phục listener", kiểm tra theo thứ tự:

1. `netstat -ano | findstr 27017` — xác nhận có tiến trình nào đang lắng nghe cổng này không, map PID sang tên tiến trình (`tasklist /FI "PID eq <pid>"`).
2. Mở file cấu hình service, thường ở `C:\Program Files\MongoDB\Server\<version>\bin\mongod.cfg`, kiểm tra `net.bindIp` (có thể đang bind vào IP khác `127.0.0.1`, hoặc chỉ `::1`) và `net.port`.
3. Xem log thật của mongod (`systemLog.path` trong cùng file cfg, hoặc Event Viewer) — dịch vụ Windows có thể báo "Running" ở mức Service Manager trong khi tiến trình con đã crash và tự restart loop (ví dụ sai `dbpath`, thiếu quyền ghi).
4. Nếu muốn loại trừ nhanh vấn đề do Windows Service: dừng service, chạy tay `mongod --dbpath <path> --port 27017` trong một terminal riêng, xác nhận app kết nối được qua `GET /api/health`, rồi quay lại sửa cấu hình service sau.

Đừng đổi `MONGODB_URI` trong `.env`/`.env.example` để né vấn đề (ví dụ đổi sang cổng khác) trừ khi đó thực sự là cấu hình đúng của máy này — ưu tiên sửa cho MongoDB lắng nghe đúng `127.0.0.1:27017` như mặc định đã định nghĩa trong `config.ts`.

## Nhắc lại các ràng buộc đã chốt, đừng tự đảo ngược

- Nếu một bug chỉ sửa được bằng cách đụng vào một quyết định đã ghi log trong `AGENTS.md` → Status → Decisions log (khoá tab 2/3/4 khi chưa có dự án, debounce tìm kiếm 300ms, cấu trúc CSS Modules, v.v.) thì dừng lại hỏi trước, đừng tự đảo ngược quyết định đó.
- Không thêm test tự động cho module `project` dù phát hiện bug ở đó — chỉ sửa bug, việc không viết test là quyết định đã chốt.
- Mỗi commit phải cập nhật `## Status` trong `AGENTS.md` ngay trong cùng commit đó (luật số 11) — không dồn lại cập nhật Status một lần ở cuối.
- Thư mục `Claude outputs/` đang untracked, giữ nguyên, đừng lỡ tay `git add` vào.
- Không dùng `git add -A`/`git add .`; chỉ add đúng file đã sửa nội dung thật (không phải chỉ khác line-ending CRLF/LF so với commit gốc).
- Không push, không sửa boundary rules trong `eslint.config.js`.

Xong bước 7 thì báo cáo lại đúng theo format đã đưa (mục 4 trong prompt): việc đã làm theo từng dòng checklist, file đã đổi, lệnh để xem kết quả, quyết định tự đưa ra ngoài prompt, việc còn thiếu/câu hỏi, và đề xuất bước tiếp theo.
