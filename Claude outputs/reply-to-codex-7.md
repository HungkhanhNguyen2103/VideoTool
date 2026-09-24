# Phase 2 Prompt 2 plan — approved

Plan matches spec and the SSE log addendum exactly. One implementation note before starting:

**Task 5 — Multer size error must be caught explicitly in `error-handler.ts`:**

Multer throws `MulterError` (not `AppError`) on `LIMIT_FILE_SIZE`. The existing error handler won't catch it as a client error, so it will leak as 500 without an explicit case:

```ts
import multer from 'multer';
// inside errorHandler, before the AppError branch:
if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
  return res.status(400).json({ error: { code: 'FILE_TOO_LARGE', message: 'File exceeds the size limit.' } });
}
```

Add a route test that POSTs a buffer exceeding the limit and asserts 400 `FILE_TOO_LARGE`.

Everything else in the plan is correct. Proceed with native implementation task by task.
