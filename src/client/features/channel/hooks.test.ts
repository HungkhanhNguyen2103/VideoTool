import { describe, expect, it, vi } from 'vitest';
import { channelQueryKey, invalidateChannelMutationQueries } from './hooks';

describe('channel query invalidation', () => {
  it('uses a stable key for a single channel query', () => {
    expect(channelQueryKey('channel-1')).toEqual(['channels', 'detail', 'channel-1']);
  });

  it('refreshes channels, project detail, and project lists after assignment', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await invalidateChannelMutationQueries({ invalidateQueries }, 'project-1');
    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(invalidateQueries.mock.calls.map(([query]) => query.queryKey)).toEqual([
      ['channels'],
      ['projects', 'detail', 'project-1'],
      ['projects'],
    ]);
  });
});
