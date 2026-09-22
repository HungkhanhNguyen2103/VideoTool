import path from 'node:path';
import { ConfigError, loadConfig } from './config';
import { createApp } from './app';
import { closeDb, connectDb } from './db/client';
import { ensureIndexes } from './db/ensure-indexes';
import { logger } from './shared/logger';

async function main(): Promise<void> {
  const config = loadConfig();
  await connectDb(config.MONGODB_URI, config.MONGODB_DB);
  await ensureIndexes();

  const app = createApp({
    filesDir: path.resolve(config.FILES_DIR),
    remotionPublicDir: path.resolve(config.REMOTION_PUBLIC_DIR),
    clientDir: config.NODE_ENV === 'production' ? path.resolve('dist/client') : null,
  });
  const server = app.listen(config.PORT, () => {
    logger.info(`web listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
  });

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info(`${signal} received, shutting down`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(() => {
      closeDb().finally(() => process.exit(0));
    });
    server.closeAllConnections();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) logger.error(err.message);
  else logger.error('web failed to start', err);
  process.exit(1);
});
