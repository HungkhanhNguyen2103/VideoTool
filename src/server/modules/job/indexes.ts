import { getCollection } from '../../db/client';
import type { JobDoc } from './docs';

export const JOB_INDEXES = [{ key: { status: 1, runAt: 1 } }] as const;

/** Called once at startup from db/ensure-indexes.ts. createIndex is idempotent. */
export async function ensureJobIndexes(): Promise<void> {
  const col = getCollection<JobDoc>('jobs');
  await col.createIndex({ status: 1, runAt: 1 });
}
