import { describe, expect, it } from 'vitest';
import { YoutubePartnerThresholdsSchema, YoutubeReviewSchema, YoutubeVideoListItemSchema } from './youtube-analytics';

describe('YouTube analytics client contracts', () => {
  it('validates the single dated two-period Partner Program reference table', () => {
    const thresholds = {
      checkedOn: '2026-10-21',
      sourceUrls: ['https://support.google.com/youtube/answer/72851', 'https://support.google.com/youtube/answer/12843009'],
      current: { entryTier: { subscribers: 500, longWatchHours: 3000, shortViews: 3_000_000 }, ads: { subscribers: 1000, longWatchHours: 4000, shortViews: 10_000_000 } },
      from2027_02_01: { entryTier: { subscribers: 500, longWatchHours: 3000, shortViews: 3_000_000 }, ads: { subscribers: 1000, longWatchHours: 8000, shortViews: 20_000_000 } },
    };
    expect(YoutubePartnerThresholdsSchema.parse(thresholds)).toEqual(thresholds);
  });

  it('keeps review and missing CTR data explicit in strict responses', () => {
    expect(YoutubeReviewSchema.parse({ target: 'video', targetId: 'video-1', promptVersion: 'youtube-review-v1', dataWindow: '28d', result: { observations: [], hypotheses: [], experiments: [] }, generatedAt: '2026-10-21T00:00:00.000Z' }).target).toBe('video');
    const video = YoutubeVideoListItemSchema.parse({
      videoId: 'video-1', title: 'Video', publishedAt: '2026-10-20T00:00:00.000Z', durationSec: 120, isShort: true, privacy: 'public',
      viewCount: 30, likeCount: null, commentCount: null, fetchedAt: '2026-10-21T00:00:00.000Z', analytics: {},
      ranking: { viewsPerDay: 2, averageViewPercentage: null, clickThroughRate: null, subscribersPerThousandViews: null }, linkedProject: null,
    });
    expect(video.ranking.clickThroughRate).toBeNull();
    expect(() => YoutubeReviewSchema.parse({ target: 'video', targetId: 'video-1', promptVersion: 'youtube-review-v1', dataWindow: '28d', secret: 'token', result: { observations: [], hypotheses: [], experiments: [] }, generatedAt: '2026-10-21T00:00:00.000Z' })).toThrow();
  });
});
