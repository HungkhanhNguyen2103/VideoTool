import path from 'node:path';
import express, { type Express } from 'express';
import { getDb } from './db/client';
import { errorHandler } from './error-handler';
import { NotFound } from './shared/errors';

export type AppOptions = {
  /** Absolute directory served under /files. */
  filesDir: string;
  /** Absolute path of the built SPA (dist/client). null = do not serve it (development). */
  clientDir: string | null;
};

export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (_req, res) => {
    await getDb().command({ ping: 1 });
    res.json({ ok: true, db: true });
  });

  // Business routes are mounted explicitly here, one line per module.

  app.use('/api', (_req, _res, next) => next(new NotFound('Không tìm thấy đường dẫn.')));

  app.use('/files', express.static(options.filesDir));
  app.use('/files', (_req, _res, next) => next(new NotFound('Không tìm thấy tệp.')));

  if (options.clientDir) {
    const indexHtml = path.join(options.clientDir, 'index.html');
    app.use(express.static(options.clientDir));
    // SPA fallback: must stay after every API/static route and before the error handler.
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.sendFile(indexHtml, (err) => err && next(err));
    });
  }

  app.use(errorHandler);
  return app;
}
