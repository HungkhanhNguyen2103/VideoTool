# Phase 1, step 7/7 (final step): polish, docs, acceptance checklist

Bạn tiếp tục công việc trên repo `video-tool` (Node.js + Express 5 + MongoDB + React/Vite) mà một AI khác (Claude) đã làm từ đầu Phase 1. Đây là **bước cuối cùng** của Phase 1. Nói chuyện với tôi bằng **tiếng Việt**. Code, comment, commit message, docs viết bằng **tiếng Anh**. Chuỗi hiển thị trên UI giữ **tiếng Việt** (copy từ prototype).

## 1. Đọc trước, theo đúng thứ tự này

1. `AGENTS.md` ở gốc `video-tool` — đọc kỹ mục `## Status` (ngay sau mục 1) trước tiên, nó là nguồn thật về việc gì đã xong/chưa xong/chưa verify.
2. `src/server/modules/*/MODULE.md`.
3. `docs/prototypes/khoi-tao-du-an/` và `docs/prototypes/duyet-tai-tao/` — nguồn chân lý cho layout, copy tiếng Việt, token CSS, hành vi.
4. `git log --oneline` để xem 5 commit đã có (`dba7d9e` scaffold gốc, rồi 4 commit của Phase 1 step 0-6, mới nhất là `f1cc75c feat(client): add client foundation and the Khởi Tạo Dự Án page`).

## 2. Bối cảnh quan trọng — đừng làm lại hoặc phá vỡ

- `video-tool` là git repo **riêng của chính nó** (`.git` nằm ngay tại gốc `video-tool`). Đây là chủ ý. Chỉ commit ở đây, **không bao giờ push**.
- **Không sửa boundary rules trong `eslint.config.js`.** Nếu một rule chặn bạn, giải thích lý do và hỏi trước, đừng tự ý sửa.
- Module `project` (server + client) đã implement đầy đủ nhưng **cố ý không có test tự động** (`test-utils`, `project.test.ts`) — đây là quyết định của người dùng (Hung), đã ghi trong `AGENTS.md` → Status → Decisions log. Đừng tự thêm test trừ khi được yêu cầu.
- Toàn bộ code trước giờ được viết và verify (`typecheck`/`lint`/`test`/`build`) trong một **sandbox Linux không có MongoDB thật và không có màn hình**, nên:
  - Chưa ai từng mở UI thật trong trình duyệt.
  - Chưa API nào (kể cả `GET /api/health`) từng chạy với MongoDB thật.
  - Đây chính là việc bạn cần làm ở bước này — bạn có Windows + MongoDB thật + trình duyệt thật, việc mà AI trước không có.
- Luật số 11 trong `AGENTS.md` (mục 6): sau mỗi bước, **cùng commit với code**, phải cập nhật mục `## Status` cho khớp thực tế, chỉ ghi "done"/"verified" khi đã thật sự chạy lệnh xác nhận.
- Máy dev là **Windows với Git Bash**. Giữ npm scripts/paths cross-platform như hiện tại.
- Một vài quyết định đã tự đưa ra và ghi log — đọc mục Decisions log trong Status để biết, đáng chú ý:
  - Tab "2. Duyệt & Tái Tạo", "3. Studio...", "4. SEO..." đều bị khoá (disabled) khi chưa có dự án nào đang mở — prompt gốc chỉ nói rõ điều này cho tab 2, AI trước đã mở rộng ra cả tab 3/4 vì route của chúng cần `:projectId`. Nếu bạn (hoặc Hung) thấy không đúng ý, sửa lại và ghi log quyết định mới.
  - Ô tìm kiếm debounce 300ms trước khi gọi API (prototype gốc search tức thời trên mảng local, ở đây search chạy server-side nên cần debounce).
  - CSS: tokens/resets/utility class dùng chung nằm ở `src/client/styles/tokens.css`; style riêng từng component nằm ở CSS Module cạnh nó; `.btn`/`.badge` là component dùng chung (`shared/ui/Button`, `shared/ui/Badge`) thay vì class global.

## 3. Việc cần làm ở bước này

### 3.1. Chạy thật và sửa lỗi phát sinh (ưu tiên cao nhất)

1. Cài MongoDB standalone chạy ở `mongodb://127.0.0.1:27017` (không cần replica set).
2. `npm run dev` (chạy Vite + web + worker cùng lúc), mở `http://localhost:5173`.
3. So sánh `/production/init` với `docs/prototypes/khoi-tao-du-an/index.html` mở trực tiếp bằng trình duyệt, ở độ rộng khung nhìn **1440px**. Liệt kê mọi khác biệt về layout/màu sắc/spacing/copy và sửa cho khớp — **trừ** khi khác biệt đó là một quyết định đã ghi log có chủ ý (ví dụ danh sách ở mục 2 trên), thì giữ nguyên và giải thích.
4. Thử tay toàn bộ luồng:
   - Submit form không hợp lệ → không gọi API, hiện đúng thông báo tiếng Việt, focus vào field lỗi đầu tiên.
   - "Chỉ lưu nháp" → tạo dự án, ở lại trang, dự án xuất hiện trong "Dự án gần đây" không cần reload.
   - "Tạo dàn ý" → tạo dự án rồi chuyển sang `/production/:id/review` (trang placeholder).
   - Reload trang → dự án vẫn còn (đọc từ MongoDB thật), `currentProjectId` vẫn nhớ (localStorage).
   - Mở dự án khác, nhân bản, xoá (có dialog xác nhận) — xoá đúng dự án đang mở thì phải tự chuyển sang dự án khác hoặc về trạng thái "chưa mở dự án nào" một cách hợp lý.
   - Tìm kiếm theo tên có dấu/không dấu, lọc theo trạng thái — chạy đúng phía server.
   - `GET /api/health` trả về `{ ok: true, db: true }`.
5. Sửa mọi bug phát sinh. Sau mỗi lần sửa có ý nghĩa, chạy `npm run typecheck && npm run lint && npm test && npm run build`, rồi mới commit.

### 3.2. Hoàn thiện tài liệu còn thiếu

- `AGENTS.md` mục 15 "Open decisions": thêm dòng **"chapters model (Phase 3)"** (yêu cầu này có trong đặc tả gốc của Phase 1, mục 5.5, nhưng bị bỏ sót — kiểm tra lại toàn bộ mục 5.5 gốc bên dưới xem còn thiếu gì khác không).
- Rà lại `.env.example` khớp với `server/config.ts` (đã có `PORT`, `NODE_ENV`, `MONGODB_URI`, `MONGODB_DB`, `FILES_DIR`, `WORKER_POLL_MS`, `AI_*_API_KEY` — xác nhận lại, không cần thêm nếu đã đủ).
- Cập nhật `## Status` trong `AGENTS.md` lần cuối cho Phase 1: đánh dấu module `project` là `done` (không phải `partial`) **chỉ khi** bạn đã thật sự verify bằng MongoDB thật + trình duyệt thật; nếu vẫn còn phần chưa verify được, ghi rõ.

### 3.3. Checklist chấp nhận Phase 1 (chạy lại toàn bộ, báo cáo trung thực từng dòng)

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` đều pass.
- [ ] Với MongoDB chạy thật, `npm run dev` khởi động Vite + API + worker; `http://localhost:5173` hiện đúng layout.
- [ ] `GET /api/health` trả `{ ok: true, db: true }`.
- [ ] Form tạo dự án: submit sai không gọi API, hiện đúng thông báo tiếng Việt như prototype; submit đúng trả 201, dự án hiện trong danh sách không cần reload, còn nguyên sau khi reload trang.
- [ ] Mở, nhân bản, xoá (có xác nhận) hoạt động; header cập nhật đúng; xoá dự án đang mở thì fallback hợp lý.
- [ ] Tìm kiếm và lọc trạng thái chạy phía server, không phân biệt dấu tiếng Việt.
- [ ] Không có secret/API key nào lọt vào client bundle.
- [ ] Boundary rules của ESLint không bị sửa và vẫn pass; không có import xuyên module kiểu "deep import".
- [ ] `AGENTS.md` và `modules/project/MODULE.md` khớp với code thật.
- [ ] `AGENTS.md` có mục `## Status` sống, phản ánh đúng trạng thái thật: ngày, bảng module, endpoint, màn hình, lệnh chạy, gap còn lại, bước tiếp theo.

### 3.4 Nguyên tắc commit

- Mỗi thay đổi có ý nghĩa là một commit riêng (`fix(...)`, `docs(...)`, `chore(...)`...), kèm cập nhật `## Status` trong cùng commit đó (luật số 11).
- Không bao giờ commit `.env`.
- Không dùng `git add -A`/`git add .` — chỉ add đúng file đã đổi (kiểm tra `git status` trước, vì có ~100 file scaffold chỉ khác line-ending CRLF/LF so với commit gốc — đừng đụng vào những file đó nếu bạn không thật sự sửa nội dung của chúng; kiểm tra bằng `git diff --ignore-cr-at-eol --stat -- <file>`, nếu rỗng thì đó là file bạn chưa đụng tới).

## 4. Báo cáo cuối cùng (tiếng Việt), theo đúng format

1. Việc đã làm, theo từng dòng checklist ở mục 3.3.
2. File đã thêm/sửa (nhóm theo khu vực).
3. Lệnh tôi cần chạy để xem kết quả.
4. Quyết định bạn tự đưa ra mà không có trong prompt này.
5. Việc còn thiếu/chưa xong, và câu hỏi còn vướng.
6. Đề xuất bước tiếp theo (Phase 2: `job` module + worker loop + SSE progress + `file-store` + upload file tham khảo + import ZIP backend).

## 5. Không được làm

- Không đụng vào file ngoài phạm vi trên.
- Không thêm dependency ngoài danh sách đã có trong `package.json` (đã đủ cho Phase 1: express, mongodb, zod, ulid, react, react-dom, react-router-dom, @tanstack/react-query, zustand, react-hook-form, @hookform/resolvers + dev deps sẵn có).
- Không bắt đầu code cho Phase 2 trở đi trong bước này.
