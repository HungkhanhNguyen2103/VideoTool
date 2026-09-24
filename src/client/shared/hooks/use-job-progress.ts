import { useEffect, useState } from 'react';

export type JobProgressEvent = {
  status: string;
  progress: number;
  error: string | null;
  result: unknown;
};

export type JobProgressState = JobProgressEvent & { logs: string[] };

export function applyJobEvent(previous: JobProgressState | null, event: JobProgressEvent): JobProgressState {
  return { ...event, logs: previous?.logs ?? [] };
}

export function useJobProgress(jobId: string | null): JobProgressState | null {
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
        setState((previous) => previous ? { ...previous, logs: [...previous.logs, line] } : { status: 'queued', progress: 0, error: null, result: null, logs: [line] });
      } catch {
        // Ignore malformed log events.
      }
    };
    source.addEventListener('log', onLog);
    return () => {
      source.removeEventListener('log', onLog);
      source.close();
    };
  }, [jobId]);

  return state;
}
