import { describe, expect, it, vi } from 'vitest';
import { invalidateYoutubeChannelQueries, invalidateYoutubeChannelsOverviewQueries, invalidateYoutubeLinkQueries, invalidateYoutubeProfileQueries, youtubeChannelsOverviewKey, youtubeGrowthPlanKey, youtubeGrowthPlanStatusKey, youtubeOverviewKey, youtubeSetupStatusKey, youtubeVideoKey, youtubeVideosKey } from './hooks';

describe('YouTube analytics query keys', () => {
  it('keeps channel and filter-specific query keys stable', () => {
    expect(youtubeOverviewKey('channel-1')).toEqual(['youtube', 'overview', 'channel-1']);
    expect(youtubeVideosKey('channel-1', { window: '90d', sort: 'viewsPerDay' })).toEqual(['youtube', 'videos', 'channel-1', { window: '90d', sort: 'viewsPerDay' }]);
    expect(youtubeVideoKey('channel-1', 'video-1')).toEqual(['youtube', 'video', 'channel-1', 'video-1']);
    expect(youtubeGrowthPlanKey('channel-1')).toEqual(['youtube', 'growth-plan', 'channel-1']);
    expect(youtubeGrowthPlanStatusKey('channel-1')).toEqual(['youtube', 'growth-plan-status', 'channel-1']);
  });

  it('refreshes analytics and active-job state after a sync or connection change', async () => {
    const invalidateQueries = vi.fn(async () => undefined);
    await invalidateYoutubeChannelQueries({ invalidateQueries }, 'channel-1');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['youtube', 'connection', 'channel-1'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['youtube', 'overview', 'channel-1'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['youtube', 'active-sync', 'channel-1'] });
  });

  it('invalidates the all-channel overview and each affected channel after bulk operations', async () => {
    const invalidateQueries = vi.fn(async () => undefined);
    await invalidateYoutubeChannelsOverviewQueries({ invalidateQueries }, ['channel-1', 'channel-2']);
    expect(youtubeChannelsOverviewKey).toEqual(['youtube', 'channels-overview']);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: youtubeChannelsOverviewKey });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['channels'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['youtube', 'overview', 'channel-1'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['youtube', 'active-sync', 'channel-2'] });
  });

  it('refreshes project and video link views after a confirmed link change', async () => {
    const invalidateQueries = vi.fn(async () => undefined);
    await invalidateYoutubeLinkQueries({ invalidateQueries }, 'channel-1', 'video-1');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['youtube', 'videos', 'channel-1'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['youtube', 'video', 'channel-1', 'video-1'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['youtube', 'suggested-links', 'channel-1'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['projects'] });
  });

  it('invalidates the channel list, channel detail, and connection summary after profile refresh', async () => {
    const calls: Array<readonly unknown[] | undefined> = [];
    const invalidateQueries = vi.fn(async (filters?: { queryKey?: readonly unknown[] }) => { calls.push(filters?.queryKey); });
    await invalidateYoutubeProfileQueries({ invalidateQueries } as never, 'channel-1');
    expect(calls).toEqual([
      ['channels'],
      ['channels', 'detail', 'channel-1'],
      ['youtube', 'connection', 'channel-1'],
    ]);
    expect(youtubeSetupStatusKey).toEqual(['youtube', 'setup']);
  });
});
