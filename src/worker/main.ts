import { ConfigError, loadConfig } from '../server/config';
import { closeDb, connectDb } from '../server/db/client';
import { claimAndRun, recoverStaleJobs, type JobHandler } from '../server/modules/job';
import { configureVideoModule } from '../server/modules/video';
import { logger } from '../server/shared/logger';

export type WorkerLoopOptions = {
  workerId: string;
  handlers: Record<string, JobHandler>;
  pollMs?: number;
  recover?: () => Promise<unknown>;
  claimAndRun?: (handlers: Record<string, JobHandler>, workerId: string) => Promise<boolean>;
};

export function createWorkerLoop(options: WorkerLoopOptions) {
  let closing = false;
  let timer: NodeJS.Timeout | null = null;
  let currentTick: Promise<void> | null = null;
  const recover = options.recover ?? recoverStaleJobs;
  const runClaim = options.claimAndRun ?? claimAndRun;

  const tick = async (): Promise<void> => {
    if (currentTick) return currentTick;
    currentTick = (async () => {
      await recover();
      while (!closing) {
        const ran = await runClaim(options.handlers, options.workerId);
        if (!ran) break;
      }
    })().finally(() => { currentTick = null; });
    return currentTick;
  };

  const start = (): void => {
    void tick();
    if (options.pollMs !== undefined) timer = setInterval(() => { void tick(); }, options.pollMs);
  };

  const stop = async (): Promise<void> => {
    closing = true;
    if (timer) clearInterval(timer);
    const running = currentTick;
    if (running) await running;
  };

  return { tick, start, stop, isClosing: () => closing };
}

async function main(): Promise<void> {
  const config = loadConfig();
  await connectDb(config.MONGODB_URI, config.MONGODB_DB);
  configureVideoModule(config.FILES_DIR, config.REMOTION_PUBLIC_DIR);
  logger.info('worker started');

  const { jobHandlers } = await import('./registry');
  const loop = createWorkerLoop({ workerId: `worker-${process.pid}`, handlers: jobHandlers, pollMs: config.WORKER_POLL_MS });
  loop.start();

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, worker shutting down`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    void loop.stop().then(() => closeDb()).finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((err: unknown) => {
    if (err instanceof ConfigError) logger.error(err.message);
    else logger.error('worker failed to start', err);
    process.exit(1);
  });
}
