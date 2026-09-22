import { useEffect, useState } from 'react';

export type JobProgressState = {
  status: string;
  progress: number;
  error: string | null;
};

export function applyJobEvent(_previous: JobProgressState | null, event: JobProgressState): JobProgressState {
  return event;
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
        const parsed = JSON.parse(event.data) as JobProgressState;
        setState((previous) => applyJobEvent(previous, parsed));
      } catch {
        // Ignore malformed server events; the next valid event can still update state.
      }
    };
    source.onmessage = onMessage;
    return () => source.close();
  }, [jobId]);

  return state;
}
