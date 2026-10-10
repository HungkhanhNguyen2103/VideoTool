import { JobSummarySchema, type JobSummary } from '../../../contracts/job';
import { Conflict, NotFound } from '../../shared/errors';
import { newId } from '../../shared/ids';
import type { JobDoc } from './docs';
import {
  claimNextJob,
  appendJobLog,
  findJobById,
  findActiveJobByType,
  insertJob,
  markCancelled,
  markDone,
  markFailed,
  recoverStaleJobs as recoverStaleJobDocs,
  requestCancel,
  updateProgress,
} from './repo';

export type JobContext = {
  reportProgress: (pct: number, result?: unknown) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
};

export type JobHandler = (job: JobDoc, ctx: JobContext) => Promise<unknown>;

export type EnqueueJobInput = {
  type: string;
  projectId: string;
  payload: unknown;
  maxAttempts?: number;
};

function toSummary(job: JobDoc): JobSummary {
  return JobSummarySchema.parse({
    id: job._id,
    type: job.type,
    projectId: job.projectId,
    status: job.status,
    progress: job.progress,
    error: job.error,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    result: job.result,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  });
}

export async function enqueueJob(input: EnqueueJobInput): Promise<JobSummary> {
  const now = new Date();
  const doc: JobDoc = {
    _id: newId(),
    schemaVersion: 1,
    type: input.type,
    projectId: input.projectId,
    payload: input.payload,
    status: 'queued',
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    runAt: now,
    lockedBy: null,
    lockedAt: null,
    progress: 0,
    result: null,
    error: null,
    cancelRequested: false,
    logs: [],
    createdAt: now,
    updatedAt: now,
  };
  await insertJob(doc);
  return toSummary(doc);
}

export async function getJob(id: string): Promise<JobSummary> {
  const job = await findJobById(id);
  if (!job) throw new NotFound('Không tìm thấy job.');
  return toSummary(job);
}

export async function getActiveJobByType(projectId: string, type: string, sceneId?: string): Promise<JobSummary | null> {
  const job = await findActiveJobByType(projectId, type, sceneId);
  return job ? toSummary(job) : null;
}

/** Internal route support for deduplication decisions that depend on the queued request payload. */
export async function getActiveJobDetailsByType(projectId: string, type: string): Promise<{ id: string; payload: unknown } | null> {
  const job = await findActiveJobByType(projectId, type);
  return job ? { id: job._id, payload: job.payload } : null;
}

export async function getJobWithLogs(id: string): Promise<{ summary: JobSummary; logs: string[] }> {
  const job = await findJobById(id);
  if (!job) throw new NotFound('Không tìm thấy job.');
  return { summary: toSummary(job), logs: job.logs };
}

export async function cancelJob(id: string): Promise<JobSummary> {
  const existing = await findJobById(id);
  if (!existing) throw new NotFound('Không tìm thấy job.');
  if (!['queued', 'running'].includes(existing.status)) throw new Conflict('Job đã kết thúc.');
  const updated = await requestCancel(id);
  if (!updated) throw new Conflict('Job đã thay đổi, hãy thử lại.');
  return toSummary(updated);
}

export function computeBackoffMs(attempts: number): number {
  return Math.min(2 ** attempts * 1_000, 30_000);
}

export async function recoverStaleJobs(): Promise<number> {
  return recoverStaleJobDocs(Date.now() - 5 * 60 * 1_000);
}

export async function claimAndRun(handlers: Record<string, JobHandler>, lockedBy: string): Promise<boolean> {
  const job = await claimNextJob(lockedBy);
  if (!job) return false;
  if (job.cancelRequested) {
    await markCancelled(job._id);
    return true;
  }

  const handler = handlers[job.type];
  if (!handler) {
    await markFailed(job._id, `Unknown job type: ${job.type}`, { willRetry: false, nextRunAt: null });
    return true;
  }

  const context: JobContext = {
    reportProgress: async (pct, result) => updateProgress(job._id, pct, result),
    isCancelled: async () => (await findJobById(job._id))?.cancelRequested ?? false,
    appendLog: async (message) => appendJobLog(job._id, message),
  };
  try {
    const result = await handler(job, context);
    if (await context.isCancelled()) await markCancelled(job._id);
    else await markDone(job._id, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const willRetry = job.attempts < job.maxAttempts;
    await markFailed(job._id, message, { willRetry, nextRunAt: new Date(Date.now() + computeBackoffMs(job.attempts)) });
  }
  return true;
}
