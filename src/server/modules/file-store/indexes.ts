import { getCollection } from '../../db/client';
import type { FileDoc } from './docs';

export async function ensureFileStoreIndexes(): Promise<void> {
  const col = getCollection<FileDoc>('files');
  await col.createIndex({ projectId: 1, createdAt: -1 });
  await col.createIndex({ purpose: 1 });
}
