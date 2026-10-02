import path from 'node:path';
import express, { type Express } from 'express';
import { getDb } from './db/client';
import { errorHandler } from './error-handler';
import { createProjectRouter } from './modules/project';
import { jobRouter } from './modules/job';
import { enqueueJob, getActiveJobByType } from './modules/job';
import { configureFileStore, configureVisualStyleSamples, createFileStoreService, fileStoreRouter, visualStyleSamplesRouter } from './modules/file-store';
import { createScriptRouter } from './modules/script';
import { assetRouter, configureAssetModule } from './modules/asset';
import { configureVideoModule, createVideoRouter } from './modules/video';
import { NotFound } from './shared/errors';

export type AppOptions = {
  /** Absolute directory served under /files. */
  filesDir: string;
  /** Stable output directory used by the Remotion bundle. */
  remotionPublicDir?: string;
  /** Optional Remotion concurrency override; undefined keeps Remotion's default. */
  remotionConcurrency?: number;
  /** Absolute path of the built SPA (dist/client). null = do not serve it (development). */
  clientDir: string | null;
};

export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  configureFileStore(options.filesDir);
  configureVisualStyleSamples(options.filesDir);
  configureAssetModule(options.filesDir, async (projectId, sceneId) => {
    if (await getActiveJobByType(projectId, 'generate-depth-map', sceneId)) return;
    await enqueueJob({ type: 'generate-depth-map', projectId, payload: { projectId, sceneId } });
  });
  configureVideoModule(options.filesDir, options.remotionPublicDir, options.remotionConcurrency);

  app.get('/api/health', async (_req, res) => {
    await getDb().command({ ping: 1 });
    res.json({ ok: true, db: true });
  });

  const fileStore = createFileStoreService(options.filesDir);
  app.use('/api/project', createProjectRouter({
    beforeDelete: async (project) => fileStore.deleteProjectFiles(project.id, [project.renderFileId, project.draftRenderFileId, project.logoFileId]),
  }));
  app.use('/api/project', createScriptRouter({ enqueueJob, getActiveJob: getActiveJobByType }));
  app.use('/api/project', fileStoreRouter);
  app.use('/api/project', assetRouter);
  app.use('/api/project', createVideoRouter({ enqueueJob }));
  app.use('/api/visual-style-samples', visualStyleSamplesRouter);
  app.use('/api/job', jobRouter);

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
