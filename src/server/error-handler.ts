import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '../contracts/common';
import { AppError } from './shared/errors';
import multer from 'multer';
import { logger } from './shared/logger';

function body(code: string, message: string, fields?: { path: string; message: string }[]): ApiErrorBody {
  return { error: fields ? { code, message, fields } : { code, message } };
}

/** 4xx errors raised by Express itself (malformed JSON, payload too large). */
function clientErrorStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null;
}

// Express identifies error middleware by its 4 parameters, so the unused `_next` must stay.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const fields = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    res.status(400).json(body('validation_error', 'Dữ liệu không hợp lệ.', fields));
    return;
  }
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json(body('FILE_TOO_LARGE', 'File exceeds the size limit.'));
    return;
  }
  if (err instanceof AppError) {
    const fields = 'fields' in err ? (err as { fields: { path: string; message: string }[] }).fields : undefined;
    res.status(err.status).json(body(err.code, err.message, fields));
    return;
  }
  const clientStatus = clientErrorStatus(err);
  if (clientStatus !== null) {
    const message = clientStatus === 413 ? 'Dữ liệu gửi lên quá lớn.' : 'Yêu cầu không hợp lệ.';
    res.status(clientStatus).json(body('bad_request', message));
    return;
  }
  logger.error('Unhandled error', err);
  res.status(500).json(body('internal_error', 'Đã xảy ra lỗi máy chủ.'));
};
