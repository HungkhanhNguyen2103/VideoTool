import { getCollection } from '../../db/client';
import type { JobDoc } from './docs';

export const JOB_INDEXES = [
  { key: { status: 1, runAt: 1 } },
  { key: { projectId: 1, type: 1 }, options: { unique: true, partialFilterExpression: { type: 'video-ideas', status: { $in: ['queued', 'running'] } } } },
] as const;

/** Called once at startup from db/ensure-indexes.ts. createIndex is idempotent. */
export async function ensureJobIndexes(): Promise<void> {
  const col = getCollection<JobDoc>('jobs');
  await col.createIndex({ status: 1, runAt: 1 });
  await col.createIndex(
    { projectId: 1, type: 1 },
    {
      unique: true,
      partialFilterExpression: { type: 'video-ideas', status: { $in: ['queued', 'running'] } },
      name: 'one_active_youtube_idea_job_per_channel',
    },
  );
}
