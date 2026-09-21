import { ConfigError, loadConfig } from '../server/config';
import { closeDb, connectDb } from '../server/db/client';
import { logger } from '../server/shared/logger';

async function main(): Promise<void> {
  const config = loadConfig();
  await connectDb(config.MONGODB_URI, config.MONGODB_DB);
  logger.info('worker started');

  // Placeholder for the job claim loop (Phase 2). Keeps the process alive at the poll interval.
  const timer = setInterval(() => undefined, config.WORKER_POLL_MS);

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info(`${signal} received, worker shutting down`);
    clearInterval(timer);
    closeDb().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) logger.error(err.message);
  else logger.error('worker failed to start', err);
  process.exit(1);
});
