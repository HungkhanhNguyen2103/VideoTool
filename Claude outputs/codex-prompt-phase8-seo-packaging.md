# Phase 8 — Tab 4 "SEO & Đóng Gói Kênh" (YouTube packaging per video)

Bạn tiếp tục repo `video-tool`. Script (tab 2) và Studio/render (tab 3) đã xong; tab 4 hiện chỉ là `ComingSoonPage` ở `src/client/app/router.tsx` (route `production/:projectId/seo`, tab đã có sẵn trong `Layout.tsx`). Phase này dựng tab 4: sau khi video render xong, Hung vào đây để có **một gói đăng YouTube hoàn chỉnh cho video đó** — tiêu đề, mô tả (có mốc chương), tags/hashtag, bình luận ghim, thumbnail — rồi sao chép/tải đi đăng.

Nói chuyện bằng **tiếng Việt**. Code/comment/commit/docs bằng **tiếng Anh**. Chuỗi hiển thị UI giữ tiếng Việt.

**Phase có một cổng duyệt.** Làm **Task 1 (prototype) rồi DỪNG**, báo cáo và chờ Hung nói "go" (Hung duyệt giao diện cùng Claude). Chỉ khi có "go" mới làm Task 2–8. Không tự làm tiếp.

## Phạm vi đã chốt với Hung
- CÓ: tiêu đề (nhiều phương án để chọn) + mô tả; tags + hashtag + bình luận ghim; thumbnail (ý tưởng chữ + concept + prompt ảnh + upload thumbnail cuối cùng).
- KHÔNG (để sau, đừng làm): cấp kênh (tên/mô tả kênh, banner/avatar, quy ước series), tự upload lên YouTube, tạo ảnh thumbnail bằng AI trong app (ảnh do Hung tạo ngoài rồi upload — giống cách asset/Flow đang chạy).
- Tạo nội dung: **tự động qua provider của project (`aiProvider`: DeepSeek/Claude) + chế độ JSON thủ công** (lấy prompt → dán vào AI bất kỳ → dán JSON kết quả), đúng mô hình của final QA và manual script.
- Kênh làm video lịch sử/tài liệu tiếng Việt (project có `language`, `coreQuestion`, `openingHook`, `motif`). Giọng SEO: hấp dẫn nhưng **trung thực** — không hứa điều video không có.

## Đọc trước
1. `AGENTS.md`: mục 5 (module + dependency), 6 (hard rules), 8 (data model), 9 (AI convention), 10 (jobs), 12 (client conventions), `## Status` và Decisions log.
2. Mẫu gần nhất cần bám: `src/server/modules/script/qa.ts` + `qa-handler.ts` + `ai/qa-schema.ts` + routes `/:id/qa`, `/:id/qa/manual-prompt`, `/:id/qa/manual-import` trong `script/routes.ts` (job + manual mode + `translateManualParseError`); `video/logo-service.ts` + routes `PUT/DELETE /:id/logo` (upload 1 ảnh theo project, thứ tự lưu-rồi-xoá-cũ); `ReviewScriptPage.tsx` (UI chọn tự động/thủ công, hộp prompt thủ công); `docs/prototypes/studio-phan-canh/` (kiểu prototype).
3. `src/remotion/frame-math.ts` (mốc thời gian thật của video — xem Task 3) và `src/contracts/script.ts` (`ChapterDoc`), `src/contracts/project.ts` (`ProjectDetail`, `chapters`, `scenes`).

## Quyết định thiết kế (Claude đã chốt — nếu thấy sai thì dừng và hỏi, đừng tự đổi)
- **Lưu trong project doc**, field `seo` (embedded như `chapters`), `.default(...)` để project cũ đọc được, không migration. Chỉ `project` module ghi collection `projects` (rule 3).
- **Module mới `seo`** (như `script`): `ai/` + service + routes + job handler. `seo` chỉ được import `project` (và `file-store` qua `index.ts`, như `video` làm). Phải thêm `seo` vào `MODULES` và `ALLOWED = { seo: ['project'] }` trong `eslint.config.js`, bảng mục 5 `AGENTS.md`, và `seo/MODULE.md`. Đây là việc *được phép* duy nhất ở eslint config; không sửa luật nào khác.
- **Logic thuần dùng chung client+server đặt trong `contracts/`** (client chỉ import `contracts/`): `contracts/seo.ts` (zod + hằng số giới hạn) và `contracts/seo-format.ts` (hàm thuần). Không import server/remotion trong contracts.
- **Mốc chương trong mô tả do code tính, không do AI**, và **không lưu** (tránh lỗi thời khi sửa chương): lưu `descriptionIntro`; mô tả đầy đủ = `intro + khối mốc chương + dòng hashtag` được ghép lúc hiển thị/sao chép.
- **Sinh theo section**: `sections` ⊆ `['titles','description','tags','pinnedComment','thumbnail']`. Mặc định tất cả. Regenerate một phần không được đụng phần khác và không đụng thumbnail đã upload.
- **Sinh bằng job `generate-seo`** (tiến độ/huỷ như các job khác, đăng ký tường minh trong `worker/registry.ts`); manual prompt/import là route đồng bộ.
- Tên/chuẩn giới hạn YouTube để thành **hằng số có tên** trong `contracts/seo.ts` với comment nguồn + ngày kiểm tra (2026-10-02): tiêu đề tối đa 100 ký tự (gợi ý hiển thị tốt ≤ 70); mô tả tối đa 5000 ký tự, ~150 ký tự đầu là phần hiện trước khi bấm "xem thêm"; tổng tags ≤ 500 ký tự; hashtag: 3 cái đầu hiện trên tiêu đề, quá 15 hashtag thì YouTube bỏ hết; thumbnail 1280×720 (16:9, tối thiểu rộng 640), **≤ 2 MB** (giữ mức bảo thủ), JPG/PNG. Chữ trên thumbnail ≤ 5 từ.

## Data shape (`contracts/seo.ts`)
```ts
SEO_SECTIONS = ['titles','description','tags','pinnedComment','thumbnail'] as const
TitleOption   { id: string; text: string; angle: 'curiosity'|'stakes'|'number'|'question'|'contrarian' }
ThumbnailIdea { id: string; overlayText: string; concept: string; imagePrompt: string }
SeoPackage {
  titles: TitleOption[]; chosenTitleId: string | null;
  descriptionIntro: string;
  tags: string[]; hashtags: string[];
  pinnedComment: string;
  thumbnail: { ideas: ThumbnailIdea[]; chosenIdeaId: string | null; fileId: string | null };
  generatedBy: { provider: 'deepseek'|'claude'|'manual'; model: string; promptVersion: string; generatedAt: string } | null;
}
```
`ProjectDetailSchema.seo` (và `ProjectDoc`) default = package rỗng (mảng rỗng, chuỗi rỗng, `null`). `FILE_PURPOSES` thêm `'thumbnail'`.

## Task 1 — Prototype HTML (rồi DỪNG chờ duyệt)
Tạo `docs/prototypes/seo-dong-goi-kenh/{index.html,styles.css,app.js}` cùng phong cách 3 prototype có sẵn (Be Vietnam Pro, icon sprite, sidebar 232px, tab 4 đang active, cùng token màu/dark theme; đo ở 1440px). Dữ liệu mẫu: video Điện Biên Phủ 1954 (dùng motif "kẻ đi săn kiêu ngạo tự sập bẫy"). Phải có và bấm được (JS thuần, không build):
- Thanh trên: chọn chế độ **Tự động (DeepSeek/Claude) | Thủ công (dán JSON)**, nút `Tạo toàn bộ gói`, và mỗi panel có nút `Tạo lại` riêng.
- **Tiêu đề**: 5 phương án (mỗi cái có nhãn angle + bộ đếm ký tự/100, cảnh báo >70), chọn 1 làm tiêu đề chính, sửa tay được.
- **Mô tả**: ô sửa `intro` với bộ đếm và vạch đánh dấu "~150 ký tự đầu"; bên dưới **xem trước mô tả đầy đủ** (intro + mốc chương `0:00 …` + hashtag) và nút `Sao chép`; ghi chú khi thiếu điều kiện mốc chương (xem Task 3).
- **Tags & hashtag**: chip sửa/xoá/thêm, thanh ngân sách `x/500 ký tự`, 3 hashtag đầu được đánh dấu "hiện trên tiêu đề".
- **Bình luận ghim**: textarea + `Sao chép`.
- **Thumbnail**: 3 ý tưởng (chữ ≤5 từ, concept, prompt ảnh có nút sao chép), chọn 1, khu upload 16:9 có xem trước, cảnh báo sai tỉ lệ/quá 2 MB.
- **Cảnh báo "con số không có trong kịch bản"** (fact guard, xem Task 3) hiển thị dạng danh sách vàng ở trên cùng.
- **Panel "Sẵn sàng đăng"**: checklist (đã chọn tiêu đề, mô tả, tags trong ngân sách, thumbnail, video đã render + link tải), nút `Sao chép tất cả` và `Tải gói đăng (.md)`.
- Trạng thái mô phỏng bấm để xem: rỗng (chưa tạo), đang tạo (progress), có kết quả, chế độ thủ công (hộp prompt + ô dán JSON + lỗi), lỗi.
Báo cáo Task 1: đường dẫn file, ảnh chụp 1440px mỗi trạng thái chính (và ~900px một ảnh), danh sách điều bạn đã tự quyết khi prototype. **Rồi dừng.**

## Task 2 — Contracts + lưu trữ trong `project`
- `contracts/seo.ts` như trên; `contracts/file.ts` thêm `'thumbnail'`.
- `project/docs.ts` + `service.ts` (`toDetail`, `createProject`, `duplicateProject`): thêm `seo`. **Duplicate giữ chữ, xoá `thumbnail.fileId`** (file không được copy — giống `bgmFileId`/`logoFileId`).
- API của `project` (export qua `index.ts`): `patchProjectSeo(id, partial)` — validate rồi `$set` từng key `seo.<key>` nguyên tử, `$inc: {version: 1}` đúng một lần; `applyGeneratedSeoSections(id, sections, generated)` — chỉ ghi các section được yêu cầu (titles → xoá `chosenTitleId` nếu không còn id; thumbnail → xoá `chosenIdeaId` nếu không còn id, **giữ `fileId`**; tags → cả `tags` + `hashtags`), kèm `generatedBy`; `setSeoThumbnailFile(id, fileId|null)`.
- Test: project cũ không có `seo` đọc ra package rỗng; duplicate; patch một phần không đụng phần khác; apply từng section; `version` tăng 1 lần.

## Task 3 — Logic thuần trong `contracts/seo-format.ts` (+ test kỹ, đây là phần dễ sai)
- `formatTimestamp(sec)`: `m:ss`, và `h:mm:ss` khi ≥ 1 giờ (YouTube).
- `chapterTimestamps(project)`: chương i bắt đầu tại tổng thời lượng các scene trước nó; chương → scene theo **lát cắt `chapter.scenesCount`** trên `project.scenes` (đúng cách module script đang chia). **Mốc phải khớp video render thật**: đọc `src/remotion/frame-math.ts` (`sceneFrameTimings`/`totalDurationInFrames`, fps từ `renderSettings`, ảnh hưởng của chuyển cảnh nếu có). Nếu mốc thật là cộng dồn khung hình đã làm tròn thì cài lại hàm thuần y hệt trong contracts và thêm **test tương đương** import cả hai để chứng minh trùng nhau trên vài bộ scene/fps; nếu có chồng lấp do chuyển cảnh thì phải tính đúng và ghi quyết định vào Decisions log. Không được import `src/remotion` từ contracts.
- Điều kiện YouTube: mốc đầu phải `0:00`, tối thiểu 3 mốc, mỗi chương ≥ 10 giây. Không đủ điều kiện hoặc scene chưa chốt (`scenes.length === 0`, hoặc tổng `scenesCount` ≠ số scene) → trả `{ ok: false, reason }` (UI hiện ghi chú, mô tả vẫn dùng được không có khối mốc).
- `assembleDescription(seo, project)`: `descriptionIntro` + khối mốc (nếu ok) + dòng hashtag (tối đa 15, không trùng).
- Đếm/giới hạn: `titleStatus(text)`, `tagBudget(tags)` (tổng ký tự gồm dấu phẩy ngăn cách theo cách YouTube tính — ghi rõ cách tính trong comment), `hashtagStatus`, `thumbnailTextStatus` (≤5 từ), kiểm tra tỉ lệ/dung lượng thumbnail ở client.
- **Fact guard** `findUnsupportedFacts(texts, sourceText)`: rút các con số/năm (số ≥ 2 chữ số, năm 4 chữ số, chấp nhận dạng `1.954`/`1,954`) trong tiêu đề, `descriptionIntro`, chữ thumbnail, rồi so với văn bản nguồn (brief + tiêu đề chương + toàn bộ narration + `referencesText`). Trả danh sách con số **không xuất hiện** trong nguồn. Chỉ cảnh báo, **không chặn**.
- Test: mốc 0:00/phút/giờ, <3 chương, chương <10s, scene chưa chốt, lát cắt `scenesCount`, ngân sách tags biên 500, hashtag quá 15, fact guard (đúng/sai/định dạng số/tiếng Việt có dấu).

## Task 4 — Module `seo`: AI generation (theo mục 9 AGENTS.md)
- `seo/ai/presets/seo-documentary.md` (id + version; copy được vào `dist/presets/` — **kiểm tra `scripts/copy-script-presets.mjs`**: nó đang chỉ copy preset của `script`; thêm bước copy cho `seo` mà không đổi hành vi cũ, và có test/kiểm tra chứng minh file tới `dist`). Nội dung: giọng kênh lịch sử Việt Nam, hấp dẫn nhưng trung thực; **chỉ dùng sự kiện/con số có trong dữ liệu đầu vào**; tiêu đề đa góc (5 phương án, mỗi angle ít nhất một lần khi đủ chỗ), keyword chính ở đầu, không ALL-CAPS tràn lan, không "SỐC/BẠN SẼ KHÔNG TIN"; intro: câu đầu ≤150 ký tự chứa từ khoá chính; tags: từ cụ thể → rộng, không nhồi; hashtag ≤5 gợi ý; bình luận ghim: một câu hỏi mở gắn với `coreQuestion`; thumbnail: chữ ≤5 từ tương phản mạnh với tiêu đề (không lặp tiêu đề), concept + prompt ảnh bằng tiếng Anh tả bố cục để người dùng đưa vào công cụ tạo ảnh.
- `ai/output-schema.ts` (zod, shape cho AI, snake_case được), `ai/build-prompt.ts` (hàm thuần `(project, sections) => { system, user, jsonSchema, promptVersion }`), `ai/parse-output.ts` (nơi duy nhất biết shape AI ↔ `SeoPackage`: sinh id, cắt/chuẩn hoá, bỏ trùng tags, loại hashtag thiếu `#`/có khoảng trắng), `ai/fixtures/` (JSON mẫu thật cho vài section).
- **Đầu vào cho AI** (đừng đưa cả kịch bản — tốn token): `title`, `brief`, `language`, `coreQuestion`, `openingHook`, `motif`, danh sách chương `{no, title, role, chapterSummary}`, đoạn mở của chương 1, thời lượng; nếu đã có tiêu đề được chọn thì đưa tiêu đề đó làm ngữ cảnh cho description/tags/thumbnail để chúng nhất quán.
- Luồng: validate zod → lỗi thì retry **một lần** kèm lỗi zod → vẫn lỗi thì `AiOutputError` (502) và **không ghi gì**. Lưu `generatedBy {provider, model, promptVersion}`.
- Boundary: thêm `seo` vào eslint như đã nêu; nếu `translateManualParseError` đang private trong `script/routes.ts`, **tách ra `server/shared/` không đổi hành vi** (test script giữ nguyên xanh) — không import chéo từ `script`.
- Test (dùng fixtures, không gọi AI): build-prompt chỉ chứa dữ liệu cho phép (không lộ toàn bộ narration), parse-output (id, trùng tags, hashtag), retry-một-lần, nhiều section, selected-sections không sinh phần thừa.

## Task 5 — Routes, job, thumbnail
Mount tường minh dưới `/api/project` trong `app.ts`; job đăng ký trong `worker/registry.ts`.
- `POST /:id/seo/generate` body `{ sections?: Section[] }` → 201 `{ jobId }`; nếu đang có job `generate-seo` active của project thì trả 200 với job đó (theo mẫu `generate-depth-maps`). `422 SCRIPT_NOT_READY` (tiếng Việt) khi project chưa có chương nào.
- Handler `generate-seo`: kiểm tra huỷ trước khi ghi; ghi qua `applyGeneratedSeoSections` (không bao giờ ghi đè section không được yêu cầu).
- `GET /:id/seo/manual-prompt?sections=titles,tags` → `{ prompt, promptVersion }` (cùng định dạng `SYSTEM…/USER…` như QA/script). `POST /:id/seo/manual-import` `{ raw, sections }` → `ProjectDetail`, lỗi parse dịch sang thông báo tiếng Việt như script, **giữ nguyên chữ người dùng dán** ở client khi lỗi, `generatedBy.provider = 'manual'`.
- `PATCH /:id/seo` (sửa một phần, zod `.strict()`), trả `ProjectDetail`.
- `PUT /:id/seo/thumbnail` (multer 2 MB, chỉ PNG/JPEG; file purpose `thumbnail`; **lưu mới → trỏ project → rồi mới xoá file cũ**, lỗi con trỏ thì dọn file mới) và `DELETE` (xoá con trỏ trước rồi xoá file; idempotent). Chuẩn hoá phần mở rộng theo MIME khi lưu (đừng tin đuôi tên file người dùng). `POST /:id/files` với purpose `thumbnail` cũng phải chặn không-phải-ảnh như `logo`/`style-reference`.
- `app.ts` `beforeDelete`: xoá luôn file thumbnail của project.
- Test route: generate (enqueue + active-job + 422), manual prompt/import (hợp lệ, JSON hỏng, section lạ), PATCH (một phần, field lạ bị từ chối), thumbnail (upload/thay/xoá/sai loại/quá 2 MB/đuôi lạ), xoá project dọn file, worker handler (huỷ, ghi đúng section).

## Task 6 — Client: `SeoPage` (thay `ComingSoonPage`)
- `src/client/features/seo/`: `api.ts`, `hooks.ts`, `SeoPage.tsx` + `components/` (Toolbar, TitlesPanel, DescriptionPanel, TagsPanel, PinnedCommentPanel, ThumbnailPanel, ManualSeoPanel). **Bám sát prototype đã được duyệt ở Task 1.** Mỗi file một trách nhiệm (rule 10); đừng nhồi vào một file dài.
- Tái dùng: hook theo dõi job hiện có (đúng pattern Studio dùng), chọn provider (`setAiProvider` API đã có), toast, Button, `fileUrlForSummary`.
- Lưu: sửa tay → `PATCH /seo` debounce ~600 ms, flush khi blur/rời trang, hiển thị `Đang lưu… / Đã lưu / Lỗi lưu (thử lại)`; không để mất chữ khi lỗi mạng.
- Tạo lại section đã có nội dung → hỏi xác nhận (dialog native như `ConfirmDeleteDialog`); chế độ thủ công giữ chữ đã dán khi lỗi.
- Cổng trạng thái: project chưa có chương → trang hiện hướng dẫn quay lại tab 2, không phải màn lỗi. Project cũ chưa có `seo` mở ra bình thường.
- Test các hàm thuần của client (xây dữ liệu hiển thị, trạng thái lưu); không thêm jsdom/testing-library (không thêm dependency).

## Task 7 — Gói đăng: checklist + xuất
- Hàm thuần `buildPublishChecklist(project)` và `buildPackageMarkdown(project)` (trong `contracts/seo-format.ts` hoặc client, nơi hợp lý): checklist gồm đã chọn tiêu đề (≤100), mô tả có `intro`, tags ≤500, ≥1 hashtag, bình luận ghim, thumbnail đã upload (đúng tỉ lệ/dung lượng), video đã render. Markdown xuất: tiêu đề, mô tả đầy đủ, tags (dạng chuỗi phân tách bằng dấu phẩy), hashtag, bình luận ghim, prompt/ý tưởng thumbnail đã chọn, kèm ngày giờ tạo.
- UI: panel "Sẵn sàng đăng", `Sao chép tất cả`, `Tải gói đăng (.md)` (tên file có slug tiêu đề, bỏ dấu), link tải video render và thumbnail.
- Test hai hàm thuần (đủ/thiếu từng mục, slug tiếng Việt có dấu).

## Task 8 — Nghiệm thu
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` đều xanh; báo số test trước/sau.
- Kiểm tra `dist` có preset `seo` và không có mã server lọt vào client bundle.
- **Chạy thật trên trình duyệt** (1440px và ~900px) với một project thật có chương + scene đã chốt: (1) chế độ thủ công: lấy prompt, dán một JSON mẫu hợp lệ, rồi dán JSON hỏng để xem lỗi tiếng Việt và chữ còn nguyên; (2) tự động qua provider nếu có API key (nếu không có, nói rõ là chưa chạy, **đừng giả vờ**); (3) tạo lại một section, xác nhận các section khác và thumbnail không đổi; (4) upload/thay/xoá thumbnail, thử file sai loại và >2 MB; (5) sao chép mô tả đầy đủ và xác nhận **mốc chương khớp video render thật** (mở video, nhảy tới từng mốc); (6) tải `.md`; (7) mở một project cũ chưa từng có `seo`; (8) project chưa có chương. Đính kèm ảnh chụp.
- Cập nhật `AGENTS.md` `## Status`, bảng route/screen (SEO không còn là placeholder), mục 5/8, Decisions log, Known gaps (cấp kênh để sau; chưa upload YouTube), và `project/MODULE.md`, `seo/MODULE.md`.

## Ràng buộc chung
- Mỗi Task một commit riêng, cập nhật `## Status` trong **cùng commit** (rule 11), chỉ ghi "done/verified" khi đã chạy lệnh xác nhận. Commit message dạng `feat(seo): …` / `test(seo): …` / `docs(seo): …`. Không push.
- Không thêm dependency, không đụng `.env`, không xoá file có sẵn, không sửa luật eslint ngoài việc thêm module `seo`.
- Không `git add -A`; chỉ add file bạn đã sửa. Repo có nhiều file scaffold chỉ khác CRLF/LF: kiểm tra bằng `git diff --ignore-cr-at-eol --stat -- <file>`, rỗng thì không đụng.
- Rule 7: validate hết rồi mới ghi Mongo; AI lỗi thì không ghi gì. Rule 5: route mỏng, logic ở service/hàm thuần. File ~100–300 dòng.
- Gặp mâu thuẫn giữa brief này và code thật (ví dụ mốc chương không khớp frame-math, tên hàm khác) thì **báo rõ và hỏi**, đừng tự chế.

## Báo cáo cuối mỗi Task (Hung mang sang cho Claude review kiểu senior)
Commit hash; file đổi/thêm; test thêm (số trước/sau); những chỗ bạn làm khác brief và lý do; với Task 3 gồm bằng chứng test tương đương với `frame-math`; với Task 8 gồm ảnh chụp và danh sách thứ **chưa** kiểm chứng được.
