import { describe, expect, it } from 'vitest';
import { JOB_STATUSES, JobSummarySchema } from '../../../contracts/job';
import { JobDocSchema } from './docs';
import { JOB_INDEXES } from './indexes';

describe('job contracts and indexes', () => {
  it('exposes the five persisted statuses', () => {
    expect(JOB_STATUSES).toEqual(['queued', 'running', 'done', 'failed', 'cancelled']);
  });

  it('requires cancelRequested on a job document', () => {
    const result = JobDocSchema.safeParse({
      _id: 'job-1',
      schemaVersion: 1,
      type: 'example',
      projectId: 'project-1',
      payload: {},
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      runAt: new Date(),
      lockedBy: null,
      lockedAt: null,
      progress: 0,
      result: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(result.success).toBe(false);
  });

  it('defines the claim index and validates public summaries', () => {
    expect(JOB_INDEXES).toEqual([{ key: { status: 1, runAt: 1 } }]);
    expect(
      JobSummarySchema.parse({
        id: 'job-1',
        type: 'example',
        projectId: 'project-1',
        status: 'queued',
        progress: 0,
        error: null,
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).status,
    ).toBe('queued');
  });
});
