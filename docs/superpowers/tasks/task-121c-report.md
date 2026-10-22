# Task 121c — Idea yield and validator review

## Status

The implementation and final offline replay are complete. The live CLI acceptance for the final validator is pending the user's requested 00:40 session reset. The two four-run CLI batches below ran before the new acceptance limit arrived; they are historical, pre-final-validator evidence, not final acceptance. They made 17 and 18 Claude CLI calls (35 total) across eight runs. No `session limit` was observed. No Claude call has been made under the new 20-call cap.

Commits: `7c847ca` (`fix(youtube): fill idea shortlist across expand batches and report partial runs`) and `414f1c4` (`fix(youtube): idea eval harness prints diagnostics below the survivor floor`). This report, plans, prompts, and replay data remain untracked as required. No push was made.

## Diagnosis from the four captured Task 121b runs

The replay reads the four saved provider outputs and invokes `validateYoutubeIdeaV2Complete` for v2 ideas. It does not route v2 rows through the legacy validator or its eight-`unverifiedFacts` limit. The helper is offline: no Claude, network, or database calls.

| Captured run | Seeds | Action pass, old → final | Deterministic shortlist, old → final | Expanded | Repair-invalid | Repair-rescued and retained | Final survivors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Vietnam 1 | 18 | 9 → 17 | 3 → 6 | 3 | 3 | 0 | 1 |
| Vietnam 2 | 18 | 7 → 18 | 4 → 6 | 4 | 4 | 2 | 2 |
| World 1 | 18 | 8 → 17 | 5 → 7 | 5 | 4 | 1 | 2 |
| World 2 | 12 | 12 → 12 | 4 → 4 | 4 | 4 | 2 | 3 |
| **Total** | **66** | **36 → 64** | **16 → 23** | **16** | **15** | **5** | **8** |

The old stored outputs had four survivors across the same four runs (0, 2, 0, 2). The final v2 replay keeps eight (1, 2, 2, 3). The action detector now rejects only the two required action-filter controls in this capture: the Swiss watch-industry trend and the Nguyễn dynasty fortress belief. The former 12/14 rejected-seed sample had at least ten false positives.

### Highest-frequency expanded-candidate rejection classes

These counts are first-validation reason occurrences among 16 expanded ideas; an idea can have more than one reason.

| Rule class | Occurrences | Samples and classification |
| --- | ---: | --- |
| Claims name coverage | 10 | **True drops:** unsupported `Đại Việt`, `Nhật Bản`, and `Trung Hoa` remain actual names requiring evidence. **False positives fixed:** sentence-initial `Vậy`, `Biến số`, and `Vấn đề` are ordinary words and no longer become name claims. Regression tests verify both sides. |
| Trap/motif consistency | 7 | **False positives fixed:** `VOC` is accepted as the short form of `Công ty Đông Ấn Hà Lan`; `Hải quân Nga` matches its parent form `Hải quân Đế quốc Nga`. **True drop retained:** in the Hạm đội Bắc Dương case, the hunter belief still does not name the subject used by the hunter motif. |
| Hubris structure and judgment | 2 | **True drops:** one idea says the hunter's advantage did not backfire; one uses “phản bội” as its moral headline. Those judgment rules and thresholds remain. |

### Decision/action filter: false positives and controls

The detector now uses grouped action vocabularies for decision, military, diplomatic, governance, economic/technical, and English actions. It accepts an action in an event clause while excluding an intended action only when it appears inside the `tin vào … để` purpose clause.

| Sample | Classification |
| --- | --- |
| Hầu Nhân Bảo “tiến quân” theo đường bộ | False positive fixed: a concrete march was present. |
| Giản Định Đế “giết” hai tướng | False positive fixed: a concrete decision/event was present. |
| Tôn Thất Thuyết “tập kích” quân Pháp | False positive fixed: a concrete attack was present. |
| Hoàng Hoa Thám “hòa hoãn” với người Pháp | False positive fixed: a concrete diplomatic action was present. |
| “Triều Nguyễn tin vào thành lũy và pháo cố định để chặn tàu chiến hơi nước phương Tây” | True drop retained: `chặn` only describes the belief's intended purpose; no separate event decision is named. |
| “Ngành đồng hồ Thụy Sĩ giữ vững niềm tin vào cơ khí chính xác khi đồng hồ thạch anh xuất hiện” | True drop retained: this describes an industry belief/trend and gives no concrete decision event. |

### Other demonstrated corrections

- Evidence-backed detail can refine `thời Pháp thuộc` to `năm 1930`, `cuối thế kỷ trước` to `1998`, and `đầu thế kỷ 20` to `1904–1905`. Tests keep unsupported-year and wrong-century negatives. Claim or packet years can support a same-century label.
- Both claim-coverage directions are tested: ordinary capitalized sentence openers are ignored, while unsupported `Đại Việt` is still reported.
- Short acronym and parent/child actor matches are tested, while the Bắc Dương hunter-subject mismatch still fails.
- Additional action phrases came from replay examples including `củng cố`, `mở tuyến`, `chuẩn bị khởi nghĩa`, `ký hòa ước`, `nhận khai thác`, `thu thuế`, `nhận gánh nợ`, `đổi lấy`, and `tập trung`. The two true-drop controls bound the broader vocabulary.

## Implementation

- Selects at most `min(12, ceil(count × 2))` seeds; expands in batches of 3–4, up to three batches, until the requested count survives or the 240-second soft budget is reached. Later expansion prompts receive the remaining archetype/century gaps.
- Expand repairs require at least two mechanical, repairable failures, run at most once per batch, and do not repair judgment failures. Partial results with one or more survivors are saved with a status and dropped reasons; zero survivors fail with leading reasons.
- Revision 2 of the expand prompt adds a short self-check and abstract format-only example while preserving untrusted-data instructions.
- Reruns include prior saved and rejected episode seeds in the capped avoid list.
- The panel shows a Vietnamese partial-result notice, reason disclosure, and the existing generate action as “Chạy lại để lấy thêm”.
- The evaluation harness prints diagnostics on failed/under-floor runs. It now allows one run per steering per measurement and persists a 20-call counter in the ignored verification folder, including across a prompt remeasurement. It stops before a call that would exceed the cap and prints PowerShell commands for remaining steerings if the CLI reports a session limit or the call cap is reached.

## Historical live evaluations (pre-final validator)

Both batches used `--model claude-sonnet-5-5 --effort medium` against the isolated local `youtube_demo_task121c_eval_20261022` database and the 2-video demo channel. Those calls predate the final action-vocabulary and intent-clause corrections. They do not establish final-validator acceptance.

| Batch | Vietnam survivors | World survivors | Runs meeting ≥4 | Wall time range | Calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Earlier four-run batch | 0, 2 | 1, 4 | 1/4 | 187.2–266.9s | 17 |
| Later four-run batch | 0, 1 | 4, 0 | 1/4 | 247.1–300.0s | 18 |

The two batches stayed below five minutes per run (one reported exactly 300.0s). Among accepted historical ideas, reports showed zero `famous` rows under the obscure Vietnamese steering and no unbacked names or numbers. Neither batch met the original 3-of-4 survivor target. Since the later batch also predates the final validator, final acceptance must be measured after the requested reset; the latest instruction limits that measurement to one run per steering and at most one prompt edit followed by one remeasurement, with 20 CLI calls total.

### Historical generated titles and critical read

These are the titles and trap sketches from the two pre-final batches. The notes assess packaging and scope only. No historical claim has been independently verified.

1. **Nguyễn Hữu Chỉnh và canh bạc liên minh ở Bắc Hà cuối thời Lê–Trịnh** — “Chỉnh tin liên minh luân phiên giúp điều phối Bắc Hà; lực lượng mạnh hơn gắn với Tây Sơn nằm ngoài tính toán; đối thủ lợi dụng sự nghi kỵ do thói đổi phe để cô lập ông; sở trường mưu lược liên minh quay lại hại ông.” Critical read: useful political mechanism, but broad and reliant on a sourced account of Chỉnh's belief.
2. **Mạc Thiên Tứ, thương cảng Hà Tiên và sức ép từ quân Xiêm** — “Mạc Thiên Tứ tin Hà Tiên thịnh vượng nhờ thương cảng sẽ tự bảo vệ được mình; sức ép quân sự từ Xiêm nằm ngoài khung nhìn; đối phương nhắm vào nơi giàu có ấy; sở trường kinh doanh thương cảng biến Hà Tiên thành mục tiêu.” Critical read: narrower economic/military angle; the cause may be overstated unless the packet supports his belief.
3. **Napoleon cấm châu Âu buôn bán với Anh: khi phong tỏa cần thêm quân đội để giữ** — “Napoleon tin cấm lục địa buôn bán với Anh sẽ làm suy yếu Anh. Ngoài khung: các nước châu Âu cũng cần buôn bán với Anh. Thương nhân buôn lậu tìm kẽ hở; sở trường cưỡng chế kéo ông vào thêm xung đột.” Critical read: clear mechanism but too familiar for an obscure-history promise; scope likely needs one episode.
4. **Habsburg Tây Ban Nha trả nợ chiến tranh bằng bạc Tân Thế giới** — “Habsburg tin dòng bạc Tân Thế giới đủ trả nợ chiến tranh nên không cần nền sản xuất nội địa; biến số ngoài khung là nguồn bạc bất định và nợ chồng chất; chủ nợ khai thác sự lệ thuộc đó; chính thế mạnh tài nguyên làm kinh tế trong nước yếu đi.” Critical read: strong economic frame, but spans a long period and may overstate a single causal chain.
5. **Bắc Tống bắt tay Nữ Chân diệt Liêu: ván cờ liên minh quay đầu** — “Bắc Tống tin Nữ Chân chỉ là công cụ diệt Liêu; biến số ngoài khung là sức mạnh và tham vọng riêng của họ; Nữ Chân khai thác liên minh để lớn mạnh rồi quay sang đe dọa Tống; tài dùng liên minh của Tống tiếp sức cho chính họ.” Critical read: understandable but familiar and broad; needs a bounded decision and less hindsight language.
6. **Athens gửi hạm đội tới Syracuse: khi biển không quyết định được trận** — “Athens tin hải quân áp đảo được Syracuse xa xôi; biến số ngoài khung là sức phòng thủ và nguồn trợ giúp như Sparta; Syracuse khai thác để làm viễn chinh sa lầy; thế mạnh hải quân không giải quyết được trận trên đất liền.” Critical read: coherent hook, but the event is famous and the title promises a larger story than one decision.
7. **Crassus ở Carrhae: bộ binh nặng đuổi theo kỵ binh Parthia** — “Crassus tin bộ binh nặng sẽ áp đảo người Parthia; biến số ngoài khung là chiến thuật cơ động và địa hình mở; Parthia khai thác điều đó để tiêu hao quân La Mã; thế mạnh bộ binh nặng thành gánh nặng ở Carrhae.” Critical read: compact contrast, yet very familiar and vulnerable to a simplistic tactical explanation.
8. **Nguyễn Hữu Chỉnh tự lập thế riêng ở Bắc Hà: khi tài mưu lược hết chỗ xoay** — “Chỉnh tin tài mưu lược đủ để cân bằng các thế lực mà tự lập; ông chưa tính tới phản ứng của Tây Sơn, Nguyễn Huệ phái Vũ Văn Nhậm ra đánh, và chính sự khôn khéo từng đưa ông lên cao thành điểm yếu.” Critical read: overlaps the earlier Chỉnh idea and reads generic; needs a more specific episode.
9. **Otrar: đoàn thương nhân và cái giá của sự cứng rắn** — “Giới cầm quyền Khwarazm tin đế quốc đủ vững để bắt giữ đoàn thương nhân Mông Cổ mà không bị trả đũa; họ không lường được năng lực đối phương, và chính quyền uy cứng rắn lại châm ngòi cuộc xâm lược.” Critical read: gripping but broadly known and risks reducing a complex conflict to one trigger.
10. **Valens mở cổng sông Danube cho người Goth** — “Valens tin bộ máy hành chính La Mã đủ sức kiểm soát người Goth tị nạn qua sông Danube; nhưng việc tiếp nhận thực tế vượt khả năng bộ máy, và chính niềm tin vào hệ thống quan liêu che khuất chỗ nó không với tới.” Critical read: promising institutional angle; the belief and administrative failure need direct evidence and a tightly scoped episode.
11. **Bắc Tống mượn tay Nữ Chân diệt Liêu** — “Bắc Tống tin liên minh với người Nữ Chân sẽ diệt Liêu mà vẫn kiểm soát được đồng minh; nhưng chiến dịch chung phơi bày sự yếu kém của Tống, và chính ngoại giao liên minh nuôi lớn kẻ quay sang tấn công.” Critical read: duplicate mechanism with title 5 and still broad; a more specific decision would help.
12. **Nicopolis: cú xung phong không chờ ai** — “Kỵ sĩ Pháp tin một cú xung phong tiên phong sẽ phá tan quân Ottoman; họ không thấy đội hình và địa thế đối phương bố trí, nên đà xung phong dũng mãnh nhất lại kéo họ vào thế bị bao vây.” Critical read: easy to picture but well-known, with a generic “overconfidence” frame.

## Verification and limits

- Offline replay after the final validator edits: 66 seeds, 64 action passes, 23 deterministic shortlists, 16 expansions, 15 repair-invalid rows, 5 retained repair rescues, 8 survivors. Both required action controls remain rejected, and the Beiyang hunter-subject failure remains.
- Focused plus requested related suites, with the local MongoDB 8.0.6 binary: **68 files, 379 tests passed**. Loopback required elevated test execution because the sandbox denied MongoMemoryServer's local connection.
- `npm run typecheck`, `npm run lint`, the eval harness TypeScript check, `npm run build`, and `git diff --check` passed. Build retains the existing Vite large-chunk warning.
- Visual acceptance at 1920×1080, 1366×768, and about 900px was not captured because Hung needed computer access. Manual steps: open the channel ideas panel at each width; check the partial banner, expanded drop reasons, retry action, and no horizontal overflow.
- Live acceptance on the final validator remains outstanding until after 00:40. The cap file is `data/files/.verification/task-121c/acceptance-cli-call-budget.json`; initialize it once for the new acceptance window with `YOUTUBE_IDEA_EVAL_RESET_CALL_BUDGET=1`, then omit that variable for any one allowed prompt remeasurement. Each measurement uses `YOUTUBE_IDEA_EVAL_RUNS=1` and target `both`. Do not reset the counter between measurements. If a `session limit` appears, stop; the harness prints the pending PowerShell commands and leaves the counter intact.
- First post-reset PowerShell measurement command (the database remains isolated and the harness prints the selected model/effort):

  ```powershell
  $env:YOUTUBE_SEED_MONGODB_URI = 'mongodb://127.0.0.1:27018'
  $env:YOUTUBE_SEED_MONGODB_DB = 'youtube_demo_task121c_eval_20261022'
  $env:YOUTUBE_IDEA_EVAL_TARGET = 'both'
  $env:YOUTUBE_IDEA_EVAL_RUNS = '1'
  $env:YOUTUBE_IDEA_EVAL_RESET_CALL_BUDGET = '1'
  npx tsx scripts/eval-video-ideas.ts
  ```

  For one allowed prompt remeasurement, keep the same database and target, unset `YOUTUBE_IDEA_EVAL_RESET_CALL_BUDGET`, and run the command again. The persisted counter prevents a call beyond 20.
- No push was made. No database outside the isolated `youtube_demo_` local target was used by these evals. No historical claim was fact-checked.
