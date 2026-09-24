import { Router } from 'express';
import { cancelJob, getJobWithLogs } from './service';

type ProgressState = { status: string; progress: number; error: string | null; result: unknown };

function stateOf(summary: Awaited<ReturnType<typeof getJobWithLogs>>['summary']): ProgressState {
  const isTerminal = terminal(summary.status);
  return { status: summary.status, progress: summary.progress, error: summary.error, result: isTerminal ? summary.result : null };
}

function terminal(status: string): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled';
}

export function createJobRouter(): Router {
  const router = Router();

  router.post('/:id/cancel', async (req, res) => {
    res.json(await cancelJob(req.params.id));
  });

  router.get('/:id/events', async (req, res) => {
    await getJobWithLogs(req.params.id);
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();

    let lastState: string | undefined;
    let lastLogIndex = 0;
    let closed = false;
    let pollTimer: NodeJS.Timeout | null = null;
    let heartbeatTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    };
    const sendCurrent = async () => {
      if (closed) return;
      const current = await getJobWithLogs(req.params.id);
      const state = stateOf(current.summary);
      const encoded = JSON.stringify(state);
      if (lastState !== encoded) {
        res.write(`data: ${encoded}\n\n`);
        lastState = encoded;
      }
      for (const message of current.logs.slice(lastLogIndex)) {
        res.write(`event: log\ndata: ${JSON.stringify(message)}\n\n`);
        lastLogIndex += 1;
      }
      if (terminal(state.status)) {
        cleanup();
        res.end();
      }
    };

    req.on('close', cleanup);
    await sendCurrent();
    if (closed) return;
    pollTimer = setInterval(() => { void sendCurrent(); }, 1_000);
    heartbeatTimer = setInterval(() => { if (!closed) res.write(': heartbeat\n\n'); }, 15_000);
  });

  return router;
}

export const jobRouter = createJobRouter();
