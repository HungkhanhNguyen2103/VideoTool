import { describe, expect, it } from 'vitest';
import { applyJobEvent } from './use-job-progress';

describe('job progress state transition', () => {
  it('returns null before a job id is selected by the hook contract', () => {
    expect(applyJobEvent(null, { status: 'queued', progress: 0, error: null })).toEqual({
      status: 'queued',
      progress: 0,
      error: null,
    });
  });

  it('replaces progress with the latest valid event', () => {
    const previous = { status: 'running', progress: 10, error: null };
    expect(applyJobEvent(previous, { status: 'done', progress: 100, error: null })).toEqual({
      status: 'done',
      progress: 100,
      error: null,
    });
  });
});
