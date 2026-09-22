import { useEffect, useState } from 'react';

export type JobProgressEvent = {
  status: string;
  progress: number;
  error: string | null;
};

export type JobProgressState = JobProgressEvent & { logs: string[] };

export function applyJobEvent(previous: JobProgressState | null, event: JobProgressEvent): JobProgressState {
  return { ...event, logs: previous?.logs ?? [] };
}

export function useJobProgress(jobId: string | null): JobProgressState | null {
  const [state, setState] = useState<JobProgressState | null>(null);

  useEffect(() => {
    if (!jobId) {
      setState(null);
      return undefined;
    }
    const source = new EventSource(`/api/job/${encodeURIComponent(jobId)}/events`);
    const onMessage = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as JobProgressEvent;
        setState((previous) => applyJobEvent(previous, parsed));
      } catch {
        // Ignore malformed server events; the next valid event can still update state.
      }
    };
    source.onmessage = onMessage;
    const onLog = (event: Event) => {
      try {
        const line = JSON.parse((event as MessageEvent<string>).data) as string;
        setState((previous) => previous ? { ...previous, logs: [...previous.logs, line] } : previous);
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
