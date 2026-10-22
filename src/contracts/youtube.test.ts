import { describe, expect, it } from 'vitest';
import { YoutubeConnectionSummarySchema, YoutubeManualReachInputSchema, YoutubeVideoStatsSchema } from './youtube';

describe('YouTube client connection contract', () => {
  it('does not accept token-shaped fields', () => {
    expect(() => YoutubeConnectionSummarySchema.parse({
      connected: true,
      youtubeChannelId: 'UC123',
      title: 'Channel',
      connectedAt: '2026-10-21T00:00:00.000Z',
      refreshToken: 'must-not-escape',
    })).toThrow();
  });
});

describe('YouTube growth-plan video inputs', () => {
  it('defaults legacy videos safely and rejects malformed manual reach values', () => {
    const video = YoutubeVideoStatsSchema.parse({
      videoId: 'video-1', title: 'Video', publishedAt: null, durationSec: 600, isShort: false, privacy: 'public',
      viewCount: null, likeCount: null, commentCount: null, fetchedAt: '2026-10-22T00:00:00.000Z',
    });
    expect(video).toMatchObject({ first28d: null, manualReach: null, excludedFromPlan: false, trafficSources: {} });
    expect(YoutubeManualReachInputSchema.parse({ impressions: 0, ctrPercent: 0 })).toEqual({ impressions: 0, ctrPercent: 0 });
    expect(() => YoutubeManualReachInputSchema.parse({ impressions: 1.5, ctrPercent: 101 })).toThrow();
    expect(() => YoutubeManualReachInputSchema.parse({ impressions: 10, ctrPercent: 2, enteredAt: '2026-10-22T00:00:00.000Z' })).toThrow();
  });
});
