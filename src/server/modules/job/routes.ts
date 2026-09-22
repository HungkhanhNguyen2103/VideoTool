import { Router } from 'express';
import { getJob, cancelJob } from './service';

type ProgressState = { status: string; progress: number; error: string | null };

function stateOf(summary: Awaited<ReturnType<typeof getJob>>): ProgressState {
  return { status: summary.status, progress: summary.progress, error: summary.error };
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
    const initial = await getJob(req.params.id);
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();

    let lastState: string | undefined;
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
      const summary = await getJob(req.params.id);
      const state = stateOf(summary);
      const encoded = JSON.stringify(state);
      if (lastState !== encoded) {
        res.write(`data: ${encoded}\n\n`);
        lastState = encoded;
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
    void initial;
  });

  return router;
}

export const jobRouter = createJobRouter();
