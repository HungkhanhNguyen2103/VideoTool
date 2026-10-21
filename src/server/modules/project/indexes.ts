import { getCollection } from '../../db/client';
import type { ProjectDoc } from './docs';

/** Called once at startup from db/ensure-indexes.ts. createIndex is idempotent. */
export async function ensureProjectIndexes(): Promise<void> {
  const col = getCollection<ProjectDoc>('projects');
  await col.createIndex({ updatedAt: -1 });
  await col.createIndex({ status: 1, updatedAt: -1 });
  await col.createIndex({ channelId: 1 });
}
