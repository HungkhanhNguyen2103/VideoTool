# Phase 2, Prompt 1/2: `job` module + worker loop thật + SSE progress

Bạn tiếp tục repo `video-tool` (Node.js + Express 5 + MongoDB + React/Vite). Phase 1 đã xong và được xác nhận (build/typecheck/lint/test pass, đã chạy tay trên Windows với MongoDB thật và trình duyệt thật). Đây là **prompt đầu tiên trong 2 prompt của Phase 2**. Prompt này chỉ làm nền tảng job/worker — **chưa** làm file-store, upload file tham khảo hay import ZIP (đó là prompt 2, sẽ gửi sau khi prompt này xong và được duyệt).

Nói chuyện bằng **tiếng Việt**. Code/comment/commit message/docs bằng **tiếng Anh**. Chuỗi hiển thị UI (nếu có) giữ tiếng Việt.

## 1. Đọc trước, theo thứ tự

1. `AGENTS.md` — đọc kỹ mục `## Status` (đang ghi Phase 1 done, "Next step: Phase 2..."), mục 5 (bảng module, module `job` "Owns collection: jobs", "May import: none"), mục 8 (Data model — đặc biệt dòng `jobs` và phần "Job claim (atomic)"/"Recovery" trong Concurrency patterns), mục 10 ("Jobs" — types, handler signature, retry, SSE).
2. `src/server/modules/job/MODULE.md` (đang là stub, bạn sẽ điền).
3. `src/worker/main.ts` và `src/worker/registry.ts` (đang là khung/stub — `main.ts` hiện chỉ giữ tiến trình sống bằng `setInterval` rỗng, `registry.ts` là `export {}`).
4. `src/client/shared/hooks/use-job-progress.ts` (đang là stub `export {}`).
5. Các module khác (`project`, `server/shared/*`, `server/db/*`) để biết convention: cách viết `docs.ts`/`repo.ts`/`service.ts`/`routes.ts`/`index.ts`, cách dùng `AppError`/`NotFound`/`Conflict`, `newId()`, `logger`, `getCollection<T>()`.

## 2. Bối cảnh và ràng buộc quan trọng

- `video-tool` là git repo riêng (`.git` ở gốc `video-tool`). Chỉ commit ở đây, **không push**.
- **Không sửa boundary rules trong `eslint.config.js`.** Bảng `ALLOWED` hiện tại: `project: []`, `job: []`, `script: ['project']`, `asset: ['project','job']`, `video: ['project','asset','job']`. Module `job` **không được import bất cứ module nào khác** (kể cả `project`) — đúng như đã định nghĩa.
- **Chưa có module nào dùng `job` thật cả** (asset/script/video chưa được implement — đó là Phase 3-5). Vì vậy `worker/registry.ts` ở prompt này **sẽ là một map rỗng** (`{}` với comment giải thích Phase 4/5 sẽ thêm `asset.generate-image`, `asset.generate-voice`, `video.render`). Đây là chủ ý, không phải thiếu sót — đừng tự chế ra một job type "demo" để lấp chỗ trống.
- Vì không có handler thật, việc verify "worker chạy đúng" sẽ dựa vào: (a) test tự động cho các thao tác của `job` module (enqueue, claim atomic, progress, cancel, recover) chạy trực tiếp qua `service`/`repo`, không cần qua tiến trình worker thật; (b) chạy tay `worker/main.ts` để xác nhận nó khởi động, poll đều đặn, không crash khi hàng đợi rỗng, và tắt sạch khi nhận `SIGINT`/`SIGTERM`.
- **Lần này CÓ viết test tự động** (khác với module `project` ở Phase 1, nơi Hung yêu cầu bỏ test). Lý do: logic claim atomic/backoff/recovery của `job` là phần dễ sai và khó test bằng tay (đòi hỏi race condition), còn `project` chỉ là CRUD đơn giản. Dùng `mongodb-memory-server` (đã có sẵn trong `devDependencies` từ đầu, chưa từng được dùng) — trên máy Windows của bạn có mạng thật nên tải binary sẽ không bị chặn như trong sandbox Linux trước đây. Nếu vì lý do nào đó `mongodb-memory-server` không tải được, dùng tạm một database Mongo thật riêng cho test (`MONGODB_DB=video_tool_test` hoặc tương tự) với dọn dẹp giữa các test, và ghi rõ quyết định này vào `AGENTS.md`.
- Luật số 11: mỗi bước có ý nghĩa, cùng commit đó phải cập nhật `## Status`. Chỉ ghi "done"/"verified" khi đã thật sự chạy lệnh xác nhận.
- Không dùng `git add -A`/`git add .`. Có ~80+ file scaffold chỉ khác line-ending CRLF/LF so với commit gốc — đừng đụng vào những file bạn không thật sự sửa nội dung (kiểm tra bằng `git diff --ignore-cr-at-eol --stat -- <file>`, rỗng thì bỏ qua).
- Không thêm dependency ngoài những gì đã có trong `package.json`, trừ khi thật sự cần và phải hỏi trước. `mongodb-memory-server` đã có sẵn, không cần thêm.

## 3. Việc cần làm

### 3.1 Contracts (`src/contracts/job.ts`)

- `JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const`.
- `JobSummary`: `{ id, type: string, projectId: string, status, progress: number, error: string | null, attempts: number, maxAttempts: number, createdAt: string, updatedAt: string }` (ISO date strings, giống pattern `ProjectSummary`).
- **Không có contract "CreateJobRequest" public** — job không được tạo qua HTTP trực tiếp từ client. Việc enqueue job là một lời gọi hàm nội bộ (`enqueueJob(...)`) do module khác gọi (ví dụ `asset`/`video` ở các phase sau), không phải một endpoint `POST /api/job`.

### 3.2 `modules/job/docs.ts`

Zod schema `JobDoc` theo đúng bảng ở mục 8 AGENTS.md, cộng thêm một field bạn cần bổ sung có lý do:

- `_id`, `schemaVersion: 1`, `type: string`, `projectId: string`, `payload: unknown` (mỗi loại job tự biết cách parse payload của mình, `job` module không biết trước shape), `status` (5 giá trị trên), `attempts: number`, `maxAttempts: number`, `runAt: Date` (khi nào job đủ điều kiện được claim — dùng cho backoff), `lockedBy: string | null`, `lockedAt: Date | null`, `progress: number` (0-100), `result: unknown`, `error: string | null`, `cancelRequested: boolean`, `createdAt`, `updatedAt` (Date).
- `cancelRequested` **không có trong bảng data model gốc ở mục 8** — bạn thêm để hỗ trợ huỷ một job đang `running` một cách hợp tác (cooperative cancellation, đúng tinh thần mục 10 "ctx can ... observe cancellation"). Đây là một quyết định kỹ thuật của bạn: cập nhật lại bảng ở mục 8 AGENTS.md cho khớp, và ghi vào Decisions log.

### 3.3 `modules/job/indexes.ts`

`{ status: 1, runAt: 1 }` đúng như mục 8 AGENTS.md ghi (`Index {status, runAt}`).

### 3.4 `modules/job/repo.ts` (chỉ query, không có business logic)

- `insertJob(doc)`.
- `claimNextJob(lockedBy: string)`: atomic bằng `findOneAndUpdate` đúng công thức ở mục 8: `{status:'queued', runAt:{$lte: now}}` -> `$set:{status:'running', lockedBy, lockedAt: now}, $inc:{attempts:1}`, `sort:{runAt:1}`, `returnDocument:'after'`. Trả `JobDoc | null`.
- `updateProgress(id, progress, result?)`.
- `markDone(id, result)`.
- `markFailed(id, error, opts: { willRetry: boolean; nextRunAt?: Date })`: nếu còn lượt retry thì set lại `status:'queued'`, `runAt: nextRunAt`; nếu hết lượt thì `status:'failed'`.
- `requestCancel(id)`: set `cancelRequested: true` (không đổi status nếu đang running; nếu đang `queued` thì chuyển thẳng sang `cancelled` — làm rõ trong `service.ts`, `repo.ts` chỉ cung cấp thao tác nguyên tử).
- `findJobById(id)`.
- `recoverStaleJobs(staleBeforeMs: number)`: `updateMany({status:'running', lockedAt:{$lt: new Date(Date.now()-staleBeforeMs)}}, {$set:{status:'queued', lockedBy:null, lockedAt:null}})`. Trả số lượng đã phục hồi.

### 3.5 `modules/job/service.ts`

- `enqueueJob({ type, projectId, payload, maxAttempts = 3 }): Promise<string>` — hàm này là API chính mà các module khác (Phase 3+) sẽ gọi qua `index.ts`. Validate `type`/`projectId` không rỗng, tạo `JobDoc` với `status:'queued'`, `runAt: new Date()`, `attempts:0`, `progress:0`, `result:null`, `error:null`, `cancelRequested:false`.
- `getJob(id): Promise<JobSummary>` -> `NotFound` nếu không có.
- `cancelJob(id)`: nếu job đang `queued` -> chuyển thẳng `cancelled`; nếu đang `running` -> set `cancelRequested`; nếu đã `done`/`failed`/`cancelled` -> `Conflict` ("Job đã kết thúc, không thể huỷ.").
- Backoff cho `markFailed`: ví dụ `nextRunAt = now + min(2^attempts * 1000ms, 30000ms)`. Viết thành một hàm thuần `computeBackoffMs(attempts: number): number` dễ test riêng.
- `recoverStaleJobs()`: gọi với ngưỡng hợp lý (ví dụ 5 phút, hoặc `WORKER_POLL_MS * 10` — bạn quyết định và ghi lý do vào Decisions log).

### 3.6 `modules/job/routes.ts` (thin — chỉ 2 route công khai)

- `GET /api/job/:id/events` — SSE (`Content-Type: text/event-stream`). Poll DB mỗi ~1s (độc lập với `WORKER_POLL_MS`), gửi event khi `status`/`progress`/`error` đổi so với lần trước; gửi comment heartbeat (`: heartbeat\n\n`) mỗi ~15s để giữ kết nối qua proxy. Đóng stream ngay sau khi gửi state cuối cùng khi job đạt trạng thái kết thúc (`done`/`failed`/`cancelled`). 404 nếu job không tồn tại.
- `POST /api/job/:id/cancel` -> gọi `service.cancelJob`, trả về `JobSummary` mới nhất.
- **Không có `GET /api/job` (list) hay `POST /api/job` (create)** — job không phải thứ người dùng duyệt trực tiếp qua danh sách ở Phase này.

### 3.7 `modules/job/index.ts` (public API)

Export: `jobRouter`, `ensureJobIndexes`, `enqueueJob`, `getJob`, `cancelJob`, `recoverStaleJobs`, và các type cần cho worker: `JobHandler` (type cho hàm xử lý: `(job: JobDoc, ctx: JobContext) => Promise<unknown>`, với `JobContext = { reportProgress: (pct: number) => Promise<void>; isCancelled: () => Promise<boolean> }`), `claimAndRun(handlers: Record<string, JobHandler>, lockedBy: string): Promise<boolean>` (trả `true` nếu có job được claim và xử lý, `false` nếu hàng đợi rỗng — đây là hàm mà `worker/main.ts` gọi mỗi tick, nó tự lo claim, gọi handler tương ứng theo `job.type`, bắt lỗi từ handler và gọi `markFailed`/`markDone`, cập nhật progress qua `ctx.reportProgress`).
Export types: `JobDoc`, `JobStatus` (nếu cần dùng lại ở nơi khác).

### 3.8 `worker/registry.ts`

```ts
import type { JobHandler } from '../server/modules/job';

// Explicit job-type -> handler map. Empty until a module registers a real handler:
// Phase 4 adds 'asset.generate-image' / 'asset.generate-voice' (asset module).
// Phase 5 adds 'video.render' (video module).
export const jobHandlers: Record<string, JobHandler> = {};
```

### 3.9 `worker/main.ts` (viết lại thành vòng lặp thật)

Thay `setInterval` rỗng hiện tại bằng vòng lặp poll thật: mỗi `WORKER_POLL_MS`, gọi `claimAndRun(jobHandlers, workerId)` (một `while` claim liên tục cho tới khi hàng đợi rỗng trong một tick cũng được, hoặc đơn giản 1 claim/tick — bạn chọn, ghi lý do). Gọi `recoverStaleJobs()` định kỳ (ví dụ mỗi N tick, không cần mỗi tick). Giữ nguyên kiểu tắt sạch (SIGINT/SIGTERM) đã có, đảm bảo không tắt giữa chừng khi đang xử lý một job (đợi job hiện tại xong hoặc dùng cờ `closing` để dừng nhận job mới rồi mới đóng DB — tái dùng pattern timeout ép thoát đã có ở `server/main.ts`).
`workerId` có thể là `` `worker-${process.pid}` `` hoặc tương tự, dùng làm `lockedBy`.

### 3.10 Test tự động (viết mới lần này)

- `src/test-utils/mongo.ts`: dùng `mongodb-memory-server` — start một instance, `connectDb` trỏ vào đó, hàm dọn collections giữa các test, hàm stop.
- `src/test-utils/factories.ts`: `makeEnqueueJobInput()` hoặc tương tự, tối thiểu cho job.
- `src/server/modules/job/job.test.ts`: test qua `service`/`repo` trực tiếp (không cần khởi động HTTP server hay worker process thật):
  - `enqueueJob` tạo job `status:'queued'`.
  - `claimNextJob` hai lần liên tiếp với 2 job đang chờ: lần 1 lấy đúng job cũ nhất theo `runAt`, `attempts` tăng lên 1, `status` chuyển `running`.
  - Claim khi hàng đợi rỗng trả `null`.
  - `updateProgress` cập nhật đúng field `progress`.
  - `markFailed` với `attempts < maxAttempts` -> quay lại `queued` với `runAt` trong tương lai (theo `computeBackoffMs`); với `attempts >= maxAttempts` -> `failed` vĩnh viễn.
  - `cancelJob` trên job `queued` -> `cancelled` ngay; trên job `running` -> `cancelRequested:true`, status không đổi; trên job đã `done` -> ném `Conflict`.
  - `recoverStaleJobs` đưa job `running` có `lockedAt` cũ về `queued`, không đụng job `running` mới.
  - (Tuỳ chọn nhưng khuyến khích) một test race condition đơn giản: gọi `claimNextJob` đồng thời (`Promise.all`) hai lần trên cùng một job `queued` duy nhất, xác nhận chỉ một lần thành công (`findOneAndUpdate` atomic).
- Route-level test (giống `app.test.ts` ở Phase 1, khởi `createApp` trên cổng ngẫu nhiên, dùng `fetch`): `POST /api/job/:id/cancel` trả đúng status/shape; 404 khi job không tồn tại; SSE endpoint ít nhất trả `Content-Type: text/event-stream` và đóng khi job đã ở trạng thái kết thúc (test đơn giản: enqueue một job, đánh dấu `done` trực tiếp qua repo, mở SSE, xác nhận nhận được đúng 1 event rồi stream đóng — không cần test heartbeat 15s trong suite tự động).

### 3.11 Client: `src/client/shared/hooks/use-job-progress.ts`

Hook generic, dùng `EventSource`:

```ts
export function useJobProgress(jobId: string | null): { status: JobStatus | null; progress: number; error: string | null }
```

Kết nối tới `/api/job/${jobId}/events` khi `jobId` khác `null`, tự đóng `EventSource` khi unmount hoặc `jobId` đổi, parse JSON từ mỗi `event.data`. **Chưa có trang nào dùng hook này ở Phase 2** (asset/video pages chưa tồn tại) — viết xong, không cần wire vào UI, ghi rõ trong `AGENTS.md` là "implemented, chưa có consumer, sẽ dùng ở Phase 4/5".

### 3.12 Docs

- Điền `src/server/modules/job/MODULE.md` (Invariants: ai claim thì có, chỉ một worker sở hữu một job tại một thời điểm nhờ `findOneAndUpdate` atomic; job không có business logic, không biết `payload` nghĩa là gì; Flow: enqueue -> claim -> chạy handler -> done/failed(+backoff)/cancelled; Known pitfalls: đừng bao giờ update một job đang `running` từ nơi khác ngoài chính worker đang giữ nó, trừ `cancelRequested` và `recoverStaleJobs`).
- `AGENTS.md`: cập nhật mục 8 (thêm `cancelRequested` vào dòng `jobs`), mục `## Status` (module `job`: `done` nếu test pass + worker chạy tay ổn; endpoint mới: `GET/POST /api/job/:id/...`; decisions log: lý do có test lần này, lý do thêm `cancelRequested`, ngưỡng stale-recovery đã chọn, cách chọn 1-claim-per-tick hay claim-liên-tục; Next step: Phase 2 Prompt 2 — file-store + upload + ZIP import).

## 4. Việc KHÔNG làm ở prompt này

- Không implement bất kỳ handler thật nào (`asset.generate-image`, `asset.generate-voice`, `video.render`) — đó là Phase 4/5.
- Không đụng vào `file-store`, upload, ZIP import — đó là Prompt 2 của Phase 2.
- Không tạo endpoint `POST /api/job` hay `GET /api/job` công khai.
- Không sửa module `project` trừ khi thật sự cần (không nên cần).

## 5. Checklist trước khi báo cáo xong

- [ ] `npm run typecheck && npm run lint && npm test && npm run build` đều pass trên Windows.
- [ ] `job.test.ts` (và route-level test) pass, dùng `mongodb-memory-server` thật (hoặc ghi rõ nếu phải dùng phương án dự phòng).
- [ ] Chạy tay `node --env-file=.env dist/worker.js` (sau `npm run build`) hoặc `npm run dev`, xác nhận log "worker started", poll đều đặn không crash khi hàng đợi rỗng, tắt sạch với Ctrl+C.
- [ ] Boundary rules ESLint không đổi, vẫn pass; `job` module không import module nào khác.
- [ ] `AGENTS.md` và `modules/job/MODULE.md` khớp code thật, mục Status cập nhật đúng.
- [ ] Không secret nào lọt vào client bundle (worker/job code chỉ chạy server-side).

## 6. Báo cáo cuối (tiếng Việt), theo format

1. Việc đã làm theo từng dòng checklist mục 5.
2. File đã thêm/sửa (nhóm theo khu vực).
3. Lệnh để xem/chạy thử.
4. Quyết định bạn tự đưa ra ngoài prompt này (đặc biệt: cách chọn ngưỡng stale-recovery, 1-claim-per-tick hay không, cơ chế SSE poll interval).
5. Việc còn thiếu/câu hỏi.
6. Xác nhận sẵn sàng nhận Prompt 2 (file-store + upload + ZIP import) hay chưa.
