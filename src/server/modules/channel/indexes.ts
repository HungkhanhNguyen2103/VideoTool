import { getCollection } from '../../db/client';
import type { ChannelDoc } from './docs';

/** Called once at startup from db/ensure-indexes.ts. */
export async function ensureChannelIndexes(): Promise<void> {
  const channels = getCollection<ChannelDoc>('channels');
  await channels.createIndex({ nameSearch: 1 }, { unique: true, name: 'channel_name_search_unique' });
  await channels.createIndex({ updatedAt: -1 });
}
