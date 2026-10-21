import { describe, expect, it, vi } from 'vitest';
import { invalidateYoutubeChannelQueries, invalidateYoutubeLinkQueries, youtubeOverviewKey, youtubeVideoKey, youtubeVideosKey } from './hooks';

describe('YouTube analytics query keys', () => {
  it('keeps channel and filter-specific query keys stable', () => {
    expect(youtubeOverviewKey('channel-1')).toEqual(['youtube', 'overview', 'channel-1']);
    expect(youtubeVideosKey('channel-1', { window: '90d', sort: 'viewsPerDay' })).toEqual(['youtube', 'videos', 'channel-1', { window: '90d', sort: 'viewsPerDay' }]);
    expect(youtubeVideoKey('channel-1', 'video-1')).toEqual(['youtube', 'video', 'channel-1', 'video-1']);
  });

  it('refreshes analytics and active-job state after a sync or connection change', async () => {
    const invalidateQueries = vi.fn(async () => undefined);
    await invalidateYoutubeChannelQueries({ invalidateQueries }, 'channel-1');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['youtube', 'connection', 'channel-1'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['youtube', 'overview', 'channel-1'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['youtube', 'active-sync', 'channel-1'] });
  });

  it('refreshes project and video link views after a confirmed link change', async () => {
    const invalidateQueries = vi.fn(async () => undefined);
    await invalidateYoutubeLinkQueries({ invalidateQueries }, 'channel-1', 'video-1');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['youtube', 'videos', 'channel-1'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['youtube', 'video', 'channel-1', 'video-1'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['youtube', 'suggested-links', 'channel-1'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['projects'] });
  });
});
