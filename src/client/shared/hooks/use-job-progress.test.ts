import { describe, expect, it } from 'vitest';
import { applyJobEvent, touchJobHeartbeat } from './use-job-progress';

describe('job progress state transition', () => {
  it('returns null before a job id is selected by the hook contract', () => {
    expect(applyJobEvent(null, { status: 'queued', progress: 0, error: null, result: null }, 100)).toEqual({
      status: 'queued',
      progress: 0,
      error: null,
      result: null,
      logs: [],
      lastEventAt: 100,
    });
  });

  it('replaces progress with the latest valid event', () => {
    const previous = { status: 'running', progress: 10, error: null, result: null, logs: ['working'], lastEventAt: 1 };
    expect(applyJobEvent(previous, { status: 'done', progress: 100, error: null, result: { issues: [] } }, 200)).toEqual({
      status: 'done',
      progress: 100,
      error: null,
      result: { issues: [] },
      logs: ['working'],
      lastEventAt: 200,
    });
  });

  it('refreshes the connection timestamp on an SSE heartbeat without changing progress', () => {
    const previous = { status: 'running', progress: 40, error: null, result: null, logs: ['working'], lastEventAt: 100 };
    expect(touchJobHeartbeat(previous, 250)).toEqual({ ...previous, lastEventAt: 250 });
    expect(touchJobHeartbeat(null, 250)).toBeNull();
  });
});
