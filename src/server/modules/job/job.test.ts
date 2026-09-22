import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JOB_STATUSES, JobSummarySchema } from '../../../contracts/job';
import { JobDocSchema } from './docs';
import { JOB_INDEXES } from './indexes';
import {
  claimNextJob,
  findJobById,
  insertJob,
  markDone,
  markFailed,
  recoverStaleJobs,
  requestCancel,
  updateProgress,
} from './repo';
import { closeTestMongo, resetTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { makeJob } from '../../../test-utils/factories';

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

describe('job repository', () => {
  beforeAll(async () => startTestMongo());
  beforeEach(async () => resetTestMongo());
  afterAll(async () => closeTestMongo());

  it('inserts and finds a job', async () => {
    const job = makeJob({ type: 'example' });
    await insertJob(job);
    expect(await findJobById(job._id)).toMatchObject({ _id: job._id, type: 'example' });
  });

  it('claims the oldest eligible queued job and returns null when empty', async () => {
    const older = makeJob({ runAt: new Date(Date.now() - 2_000) });
    const newer = makeJob({ runAt: new Date(Date.now() - 1_000) });
    await insertJob(newer);
    await insertJob(older);
    const claimed = await claimNextJob('worker-a');
    expect(claimed?._id).toBe(older._id);
    expect(claimed).toMatchObject({ status: 'running', lockedBy: 'worker-a', attempts: 1 });
    expect(await claimNextJob('worker-a')).toMatchObject({ _id: newer._id });
    expect(await claimNextJob('worker-a')).toBeNull();
  });

  it('updates progress and terminal success while preserving result', async () => {
    const job = makeJob({ status: 'running', lockedBy: 'worker-a', lockedAt: new Date(), attempts: 1 });
    await insertJob(job);
    await updateProgress(job._id, 42, { partial: true });
    expect(await findJobById(job._id)).toMatchObject({ progress: 42, result: { partial: true } });
    await markDone(job._id, { ok: true });
    expect(await findJobById(job._id)).toMatchObject({ status: 'done', progress: 100, result: { ok: true }, lockedBy: null });
  });

  it('requeues retryable failures and marks terminal failures', async () => {
    const retry = makeJob({ status: 'running', lockedBy: 'worker-a', lockedAt: new Date(), attempts: 1 });
    await insertJob(retry);
    const nextRunAt = new Date(Date.now() + 5_000);
    await markFailed(retry._id, 'temporary', { willRetry: true, nextRunAt });
    expect(await findJobById(retry._id)).toMatchObject({ status: 'queued', error: 'temporary', lockedBy: null, runAt: nextRunAt });

    const terminal = makeJob({ status: 'running', lockedBy: 'worker-a', lockedAt: new Date(), attempts: 3 });
    await insertJob(terminal);
    await markFailed(terminal._id, 'permanent', { willRetry: false, nextRunAt: null });
    expect(await findJobById(terminal._id)).toMatchObject({ status: 'failed', error: 'permanent', lockedBy: null });
  });

  it('cancels queued jobs and requests cancellation for running jobs', async () => {
    const queued = makeJob();
    await insertJob(queued);
    expect(await requestCancel(queued._id)).toMatchObject({ status: 'cancelled', cancelRequested: true });

    const running = makeJob({ status: 'running', lockedBy: 'worker-a', lockedAt: new Date(), attempts: 1 });
    await insertJob(running);
    expect(await requestCancel(running._id)).toMatchObject({ status: 'running', cancelRequested: true, lockedBy: 'worker-a' });
  });

  it('recovers stale running jobs and leaves fresh locks alone', async () => {
    const stale = makeJob({ status: 'running', lockedBy: 'dead-worker', lockedAt: new Date(Date.now() - 600_000), attempts: 1 });
    const fresh = makeJob({ status: 'running', lockedBy: 'live-worker', lockedAt: new Date(), attempts: 1 });
    await insertJob(stale);
    await insertJob(fresh);
    expect(await recoverStaleJobs(Date.now() - 300_000)).toBe(1);
    expect(await findJobById(stale._id)).toMatchObject({ status: 'queued', lockedBy: null, lockedAt: null });
    expect(await findJobById(fresh._id)).toMatchObject({ status: 'running', lockedBy: 'live-worker' });
  });

  it('allows only one winner in a concurrent claim race', async () => {
    const job = makeJob();
    await insertJob(job);
    const claims = await Promise.all([claimNextJob('worker-a'), claimNextJob('worker-b')]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await findJobById(job._id))?.status).toBe('running');
  });
});
