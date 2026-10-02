# Task 65 — Clear Vietnamese errors when pasted (manual) JSON is rejected

Problem: all parsers in `src/server/modules/script/ai/parse-output.ts` throw `AppError('AI returned invalid script structure: …', 422, 'SCRIPT_PARSE_ERROR')` (lines 13 and 79). That wording is right for an automatic AI call but wrong for the three manual-paste routes, where the user pasted the JSON: it says "AI returned", says "script structure" even when the user pasted a QA result or a single chapter, and is in English. Example seen by the user in manual QA: `AI returned invalid script structure: root: invalid JSON`.

Manual routes in `src/server/modules/script/routes.ts`:
- `POST /:id/generate-script/manual-import` (whole script),
- `POST /:id/chapters/:chapterId/regenerate/manual-import` (one chapter),
- `POST /:id/qa/manual-import` (QA result).

## Change (manual routes only; automatic behavior must stay byte-identical)
1. Do NOT change the thrown messages inside `parseJson` / `validateValue`. `service.ts` line ~100 strips the prefix `AI returned invalid script structure:` with a regex and existing tests assert these strings; the automatic paths keep working unchanged.
2. Add a small helper (e.g. `translateManualParseError(error, kind)` in `parse-output.ts` or the routes file) used ONLY by the three manual routes. It catches an `AppError` with code `SCRIPT_PARSE_ERROR` and rethrows an `AppError` with the SAME status (422) and the SAME code (`SCRIPT_PARSE_ERROR`, so client handling stays the same) and a Vietnamese message:
   - `kind`: `script` → `bản thảo kịch bản`, `chapter` → `chương`, `qa` → `kết quả QA`.
   - Invalid JSON (detail is `root: invalid JSON`): `JSON của <kind> không hợp lệ. Hãy dán nguyên văn JSON do AI trả về, không kèm chữ giải thích bên ngoài; kiểm tra dấu ngoặc và dấu phẩy.`
   - Schema failure (detail is `path: message; …`): `JSON của <kind> thiếu hoặc sai trường: <the same first-three issues string as today>.` Keep the field paths and zod messages as they are (they name real fields); only the sentence around them is Vietnamese.
   - Other `AppError`s (for example `AI returned an invalid chapter count.` from `validateScriptOutlineChapterCount`) → map to `Số chương trong bản thảo không khớp với số chương đã chọn cho dự án.` for kind `script` only; leave all other errors untouched.
3. Do not change error codes, HTTP statuses, or response shape. The QA out-of-range chapter error (`QA_CHAPTER_OUT_OF_RANGE`) is already Vietnamese; leave it.
4. Do not change any client code. The client already shows the server message as is (verified: pasted text is preserved on error).

## Tests (server, in `script.test.ts` or a new `manual-import-errors.test.ts`)
- For each of the three routes: broken JSON → 422, code `SCRIPT_PARSE_ERROR`, message starts with the Vietnamese wording for the right `kind` and contains no `AI returned`.
- For each route: valid JSON with a wrong field (e.g. `issues` missing for QA, `paragraphs` not an array for chapter) → 422, Vietnamese sentence, field path still present in the message.
- Fenced ```json block with trailing text still follows the existing parse behavior (no regression).
- Automatic paths: existing tests that assert `AI returned invalid script structure` stay green and unchanged.
- Chapter/QA state unchanged after a rejected import (existing assertions).

## Verification
Typecheck, lint, full tests pass. One commit: `fix(script): Vietnamese errors for rejected manual JSON`. In the report paste the exact three new messages produced for broken JSON (one per route). No `.env` changes, no deletions, no secrets in the report.
