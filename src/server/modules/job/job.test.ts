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
import {
  cancelJob,
  claimAndRun,
  computeBackoffMs,
  enqueueJob,
  getJob,
  recoverStaleJobs as recoverStaleJobService,
} from './service';
import { Conflict, NotFound } from '../../shared/errors';
import { getCollection } from '../../db/client';

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

describe('job service', () => {
  beforeAll(async () => startTestMongo());
  beforeEach(async () => resetTestMongo());
  afterAll(async () => closeTestMongo());

  it('enqueues a queued job and maps it to a public summary', async () => {
    const summary = await enqueueJob({ type: 'example', projectId: 'project-1', payload: { value: 1 } });
    expect(summary).toMatchObject({ type: 'example', projectId: 'project-1', status: 'queued', progress: 0, attempts: 0, maxAttempts: 3 });
    expect((await getJob(summary.id)).id).toBe(summary.id);
  });

  it('computes bounded exponential retry delays', () => {
    expect(computeBackoffMs(0)).toBe(1_000);
    expect(computeBackoffMs(4)).toBe(16_000);
    expect(computeBackoffMs(8)).toBe(30_000);
  });

  it('reports missing and terminal cancellation as typed errors', async () => {
    await expect(cancelJob('missing')).rejects.toBeInstanceOf(NotFound);
    const job = await enqueueJob({ type: 'example', projectId: 'project-1', payload: {} });
    await cancelJob(job.id);
    await expect(cancelJob(job.id)).rejects.toBeInstanceOf(Conflict);
  });

  it('runs a handler, clamps progress, and persists its result', async () => {
    const job = await enqueueJob({ type: 'example', projectId: 'project-1', payload: {} });
    const seen: number[] = [];
    const handled = await claimAndRun(
      { example: async (_doc, ctx) => { await ctx.reportProgress(150); seen.push((await ctx.isCancelled()) ? 1 : 0); return { ok: true }; } },
      'worker-a',
    );
    expect(handled).toBe(true);
    expect(seen).toEqual([0]);
    expect(await getJob(job.id)).toMatchObject({ status: 'done', progress: 100 });
  });

  it('marks unknown handlers failed without retrying', async () => {
    const job = await enqueueJob({ type: 'unknown', projectId: 'project-1', payload: {} });
    expect(await claimAndRun({}, 'worker-a')).toBe(true);
    expect(await getJob(job.id)).toMatchObject({ status: 'failed', error: 'Unknown job type: unknown' });
  });

  it('requeues thrown handlers with backoff and eventually fails at max attempts', async () => {
    const job = await enqueueJob({ type: 'example', projectId: 'project-1', payload: {}, maxAttempts: 2 });
    const handler = async () => { throw new Error('boom'); };
    await claimAndRun({ example: handler }, 'worker-a');
    expect(await getJob(job.id)).toMatchObject({ status: 'queued', attempts: 1, error: 'boom' });
    const retryDoc = await findJobById(job.id);
    expect(retryDoc?.runAt.getTime()).toBeGreaterThan(Date.now());
    await getCollection('jobs').updateOne({ _id: job.id }, { $set: { runAt: new Date(0) } });
    await claimAndRun({ example: handler }, 'worker-a');
    expect(await getJob(job.id)).toMatchObject({ status: 'failed', attempts: 2, error: 'boom' });
  });

  it('observes a running cancellation request in handler context', async () => {
    const job = await enqueueJob({ type: 'example', projectId: 'project-1', payload: {} });
    let cancelled = false;
    const running = claimAndRun({
      example: async (_doc, ctx) => {
        await cancelJob(job.id);
        cancelled = await ctx.isCancelled();
        return { cancelled };
      },
    }, 'worker-a');
    await running;
    expect(cancelled).toBe(true);
    expect(await getJob(job.id)).toMatchObject({ status: 'cancelled' });
  });

  it('uses the service stale-job threshold', async () => {
    const stale = makeJob({ status: 'running', lockedBy: 'dead', lockedAt: new Date(Date.now() - 600_000), attempts: 1 });
    await insertJob(stale);
    expect(await recoverStaleJobService()).toBe(1);
  });
});
