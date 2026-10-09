import { useEffect, useState } from 'react';

export type JobProgressEvent = {
  status: string;
  progress: number;
  error: string | null;
  result: unknown;
};

export type JobProgressState = JobProgressEvent & { logs: string[]; lastEventAt: number };

export function applyJobEvent(previous: JobProgressState | null, event: JobProgressEvent, receivedAt = Date.now()): JobProgressState {
  return { ...event, logs: previous?.logs ?? [], lastEventAt: receivedAt };
}

export function touchJobHeartbeat(previous: JobProgressState | null, receivedAt = Date.now()): JobProgressState | null {
  return previous ? { ...previous, lastEventAt: receivedAt } : null;
}

export function useJobProgress(jobId: string | null, reconnectKey = 0): JobProgressState | null {
  const [state, setState] = useState<JobProgressState | null>(null);

  useEffect(() => {
    setState(null);
    if (!jobId) {
      return undefined;
    }
    const source = new EventSource(`/api/job/${encodeURIComponent(jobId)}/events`);
    let terminal = false;
    const onMessage = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as JobProgressEvent;
        setState((previous) => applyJobEvent(previous, parsed));
        if (['done', 'failed', 'cancelled'].includes(parsed.status)) {
          terminal = true;
          setTimeout(() => { if (terminal) source.close(); }, 0);
        }
      } catch {
        // Ignore malformed server events; the next valid event can still update state.
      }
    };
    source.onmessage = onMessage;
    const onLog = (event: Event) => {
      try {
        const line = JSON.parse((event as MessageEvent<string>).data) as string;
        setState((previous) => previous
          ? { ...previous, logs: [...previous.logs, line], lastEventAt: Date.now() }
          : { status: 'queued', progress: 0, error: null, result: null, logs: [line], lastEventAt: Date.now() });
      } catch {
        // Ignore malformed log events.
      }
    };
    const onHeartbeat = () => setState((previous) => touchJobHeartbeat(previous));
    source.addEventListener('log', onLog);
    source.addEventListener('heartbeat', onHeartbeat);
    return () => {
      source.removeEventListener('log', onLog);
      source.removeEventListener('heartbeat', onHeartbeat);
      source.close();
    };
  }, [jobId, reconnectKey]);

  return state;
}
