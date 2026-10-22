import { describe, expect, it } from 'vitest';
import { YoutubeChannelsOverviewSchema, YoutubeSyncAllResultSchema } from './youtube-overview';

describe('YouTube channel overview contracts', () => {
  it('accepts empty stored overview totals and keeps the response strict', () => {
    const result = {
      channels: [],
      totals: {
        subscriberCount: null,
        views28: null,
        watchHours28: null,
        subscribersGained28: null,
        channelsConnected: 0,
        channelsNeedReconnect: 0,
      },
    };

    expect(YoutubeChannelsOverviewSchema.parse(result)).toEqual(result);
    expect(YoutubeChannelsOverviewSchema.safeParse({ ...result, refreshToken: 'secret' }).success).toBe(false);
  });

  it('accepts the documented sync-all skip reasons and rejects credential fields', () => {
    const result = {
      results: [
        { channelId: 'one', jobId: 'job-1' },
        { channelId: 'two', jobId: null, skipped: 'needs-reconnect', message: 'Cần kết nối lại YouTube.' },
        { channelId: 'three', jobId: null, skipped: 'quota' },
      ],
    };

    expect(YoutubeSyncAllResultSchema.parse(result)).toEqual(result);
    expect(YoutubeSyncAllResultSchema.safeParse({ results: [{ channelId: 'one', jobId: null, refreshToken: 'secret' }] }).success).toBe(false);
  });
});
