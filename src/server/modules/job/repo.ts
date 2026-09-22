import { getCollection } from '../../db/client';
import type { JobDoc } from './docs';

const jobs = () => getCollection<JobDoc>('jobs');

export async function insertJob(doc: JobDoc): Promise<void> {
  await jobs().insertOne(doc);
}

export async function findJobById(id: string): Promise<JobDoc | null> {
  return jobs().findOne({ _id: id });
}

export async function claimNextJob(lockedBy: string): Promise<JobDoc | null> {
  const now = new Date();
  return jobs().findOneAndUpdate(
    { status: 'queued', runAt: { $lte: now } },
    {
      $set: { status: 'running', lockedBy, lockedAt: now, updatedAt: now },
      $inc: { attempts: 1 },
    },
    { sort: { runAt: 1, createdAt: 1 }, returnDocument: 'after' },
  );
}

export async function updateProgress(id: string, progress: number, result?: unknown): Promise<void> {
  const $set: { progress: number; updatedAt: Date; result?: unknown } = {
    progress: Math.max(0, Math.min(100, progress)),
    updatedAt: new Date(),
  };
  if (result !== undefined) $set.result = result;
  await jobs().updateOne({ _id: id, status: 'running' }, { $set });
}

export async function markDone(id: string, result: unknown): Promise<void> {
  await jobs().updateOne(
    { _id: id, status: 'running' },
    { $set: { status: 'done', progress: 100, result, error: null, lockedBy: null, lockedAt: null, updatedAt: new Date() } },
  );
}

export async function markCancelled(id: string): Promise<void> {
  await jobs().updateOne(
    { _id: id, status: 'running' },
    { $set: { status: 'cancelled', lockedBy: null, lockedAt: null, updatedAt: new Date() } },
  );
}

export async function markFailed(
  id: string,
  error: string,
  options: { willRetry: boolean; nextRunAt: Date | null },
): Promise<void> {
  const now = new Date();
  await jobs().updateOne(
    { _id: id, status: 'running' },
    options.willRetry
      ? { $set: { status: 'queued', runAt: options.nextRunAt ?? now, error, lockedBy: null, lockedAt: null, updatedAt: now } }
      : { $set: { status: 'failed', error, lockedBy: null, lockedAt: null, updatedAt: now } },
  );
}

export async function requestCancel(id: string): Promise<JobDoc | null> {
  const now = new Date();
  const queued = await jobs().findOneAndUpdate(
    { _id: id, status: 'queued' },
    { $set: { status: 'cancelled', cancelRequested: true, updatedAt: now } },
    { returnDocument: 'after' },
  );
  if (queued) return queued;
  return jobs().findOneAndUpdate(
    { _id: id, status: 'running' },
    { $set: { cancelRequested: true, updatedAt: now } },
    { returnDocument: 'after' },
  );
}

export async function recoverStaleJobs(staleBeforeMs: number): Promise<number> {
  const result = await jobs().updateMany(
    { status: 'running', lockedAt: { $lt: new Date(staleBeforeMs) } },
    { $set: { status: 'queued', lockedBy: null, lockedAt: null, updatedAt: new Date() } },
  );
  return result.modifiedCount;
}
