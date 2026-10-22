import { describe, expect, it } from 'vitest';
import { YoutubeVideoStatsSchema, type YoutubeVideoStats } from '../../../contracts/youtube';
import {
  buildChannelHealth,
  buildChannelTrend,
  buildVideoCohorts,
  compareVideoToChannelMedian,
  getRetentionDropSegments,
  getVideoRanking,
  getViewsPerDay,
  YOUTUBE_PARTNER_PROGRAM_THRESHOLDS,
} from './analysis';

function video(input: Partial<YoutubeVideoStats> & Pick<YoutubeVideoStats, 'videoId'>): YoutubeVideoStats {
  return YoutubeVideoStatsSchema.parse({
    title: 'Vì sao thành cổ biến mất?',
    publishedAt: '2026-10-01T12:00:00.000Z',
    durationSec: 480,
    isShort: false,
    privacy: 'public',
    viewCount: 100,
    likeCount: null,
    commentCount: null,
    fetchedAt: '2026-10-21T00:00:00.000Z',
    analytics: { lifetime: { views: 100, averageViewPercentage: 50, subscribersGained: 2 }, '28d': { views: 100 } },
    ...input,
  });
}

describe('YouTube analytics calculations', () => {
  it('normalizes video age to at least one day and ranks only available values', () => {
    expect(getViewsPerDay(video({ videoId: 'today', publishedAt: '2026-10-21T20:00:00.000Z', viewCount: 40 }), new Date('2026-10-21T21:00:00.000Z'))).toBe(40);
    const rows = getVideoRanking([video({ videoId: 'a', viewCount: 100 }), video({ videoId: 'b', viewCount: 200 })], new Date('2026-10-21T00:00:00.000Z'));
    expect(rows.viewsPerDay.map((row) => row.videoId)).toEqual(['b', 'a']);
    expect(rows.averageViewPercentage.map((row) => row.videoId)).toEqual(['a', 'b']);
    expect(rows.clickThroughRate).toEqual([]);
  });

  it('compares each video to the same channel median without fabricating unavailable measurements', () => {
    const today = new Date('2026-10-21T00:00:00.000Z');
    const selected = video({ videoId: 'selected', publishedAt: '2026-10-21T00:00:00.000Z', viewCount: 40, analytics: { '28d': { averageViewPercentage: 35 } } });
    const comparison = compareVideoToChannelMedian(selected, [
      selected,
      video({ videoId: 'middle', publishedAt: '2026-10-19T00:00:00.000Z', viewCount: 100, analytics: { '28d': { averageViewPercentage: 50 } } }),
      video({ videoId: 'top', publishedAt: '2026-10-19T00:00:00.000Z', viewCount: 200, analytics: { '28d': { averageViewPercentage: 70 } } }),
    ], today);
    expect(comparison).toMatchObject({ videoViewsPerDay: 40, medianViewsPerDay: 50, viewsSampleSize: 3, videoAverageViewPercentage: 35, medianAverageViewPercentage: 50, averageViewSampleSize: 3 });
    expect(compareVideoToChannelMedian(video({ videoId: 'no-data', analytics: {} }), [], today)).toMatchObject({ medianViewsPerDay: null, medianAverageViewPercentage: null, viewsSampleSize: 0, averageViewSampleSize: 0 });
  });

  it('measures the steepest retention segments and early drops from actual ratios', () => {
    const result = getRetentionDropSegments([
      { ratio: 0, watchRatio: 1 },
      { ratio: 0.1, watchRatio: 0.8 },
      { ratio: 0.2, watchRatio: 0.5 },
      { ratio: 0.8, watchRatio: 0.4 },
    ], 100);
    expect(result.earlyDrop).toBe(true);
    expect(result.segments[0]).toMatchObject({ startSec: 10, endSec: 20 });
    expect(result.segments[0]?.dropRatio).toBeCloseTo(0.375);
    expect(result.segments).toHaveLength(3);
  });

  it('creates duration, Vietnamese title, publish-time, preset, and visual-style cohorts with small-sample labels', () => {
    const cohortRows = [
      { video: video({ videoId: 'one', title: '5 lý do: Việt Nam?' }), project: { scriptPresetId: 'documentary', visualStylePresetId: 'cinematic' } },
      { video: video({ videoId: 'two', title: 'Chuyện khác (phần 2)', durationSec: 480 }), project: null },
    ];
    const groups = buildVideoCohorts(cohortRows, 'Asia/Ho_Chi_Minh');
    expect(groups.find((group) => group.key === 'duration:8-12')?.sampleWarning).toBe('mẫu nhỏ — chưa kết luận');
    expect(groups.some((group) => group.key === 'title:number')).toBe(true);
    expect(groups.some((group) => group.key === 'title:question')).toBe(true);
    expect(groups.some((group) => group.key === 'title:parentheses')).toBe(true);
    expect(groups.some((group) => group.key === 'preset:documentary')).toBe(true);
    expect(groups.some((group) => group.key === 'style:cinematic')).toBe(true);
    expect(buildVideoCohorts([], 'Asia/Ho_Chi_Minh')).toEqual([]);
  });

  it('returns null for zero-baseline percentage changes and flags tiny windows', () => {
    const daily = [
      { date: '2026-08-26', views: 0, estimatedMinutesWatched: 0, subscribersGained: 0, subscribersLost: 0 },
      { date: '2026-10-20', views: 50, estimatedMinutesWatched: 100, subscribersGained: 2, subscribersLost: 1 },
    ];
    const trend = buildChannelTrend(daily, new Date('2026-10-21T00:00:00.000Z'));
    expect(trend.views.changePercent).toBeNull();
    expect(trend.tooFewData).toBe(true);
    expect(trend.views.current).toBe(50);
  });

  it('computes zero and threshold-level monetization progress from public stored metrics only', () => {
    const zero = buildChannelHealth({ subscriberCount: 0, videos: [], now: new Date('2026-10-21T00:00:00.000Z') });
    expect(zero.subscribers).toBe(0);
    expect(zero.current.entryTier.eligible).toBe(false);
    expect(YOUTUBE_PARTNER_PROGRAM_THRESHOLDS.checkedOn).toBe('2026-10-22');
    expect(YOUTUBE_PARTNER_PROGRAM_THRESHOLDS.current.ads.longWatchHours).toBe(4000);
    expect(YOUTUBE_PARTNER_PROGRAM_THRESHOLDS.from2027_02_01.ads.shortViews).toBe(20_000_000);

    const atThreshold = buildChannelHealth({
      subscriberCount: 1000,
      videos: [video({ videoId: 'long', analytics: { '365d': { estimatedMinutesWatched: 240_000 } } }), video({ videoId: 'short', isShort: true, durationSec: 45, analytics: { '90d': { views: 10_000_000 } } })],
      now: new Date('2026-10-21T00:00:00.000Z'),
    });
    expect(atThreshold.current.ads.eligible).toBe(true);
    expect(atThreshold.current.ads.publicLongWatchHours).toBe(4000);
    expect('revenue' in atThreshold).toBe(false);

    const unavailable = buildChannelHealth({ subscriberCount: null, videos: [video({ videoId: 'unknown', analytics: {} })], dataSynced: true, now: new Date('2026-10-21T00:00:00.000Z') });
    expect(unavailable.publicLongWatchHours365d).toBeNull();
    expect(unavailable.current.ads.watchHoursProgress).toBeNull();
    expect(unavailable.current.ads.subscribersProgress).toBeNull();
  });
});
