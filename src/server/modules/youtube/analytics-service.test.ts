import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Document } from 'mongodb';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import type { YoutubeVideoStats } from '../../../contracts/youtube';
import { findRetention } from './repo';
import { getStoredChannelDaily, getYoutubeRetention, syncYoutubeAnalytics } from './analytics-service';

type TestDoc = Document & { _id: string; [key: string]: unknown };
const sampleVideo: YoutubeVideoStats = {
  videoId: 'video-1', title: 'Kênh của Hung', publishedAt: '2026-09-01T00:00:00.000Z', durationSec: 600, isShort: false,
  privacy: 'public', viewCount: 100, likeCount: 2, commentCount: 0, fetchedAt: '2026-10-21T00:00:00.000Z', analytics: {},
};

beforeAll(async () => startTestMongo());
beforeEach(async () => {
  await getCollection<TestDoc>('youtubeVideos').deleteMany({});
  await getCollection<TestDoc>('youtubeChannelDaily').deleteMany({});
  await getCollection<TestDoc>('youtubeRetention').deleteMany({});
  await getCollection<TestDoc>('youtubeVideos').insertOne({ ...sampleVideo, _id: 'profile-1:video-1', channelProfileId: 'profile-1', removed: false });
});
afterAll(async () => closeTestMongo());

describe('YouTube Analytics REST sync', () => {
  it('stores daily and per-video metrics while isolating unavailable groups and never requests CTR', async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      urls.push(url.toString());
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access-only-in-header');
      if (url.searchParams.get('dimensions') === 'day') {
        return new Response(JSON.stringify({ columnHeaders: [{ name: 'day' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }, { name: 'subscribersGained' }, { name: 'subscribersLost' }], rows: [['2026-10-20', 25, 50, 2, 1]] }), { status: 200 });
      }
      if (url.searchParams.get('metrics') === 'audienceWatchRatio') {
        return new Response(JSON.stringify({ columnHeaders: [{ name: 'elapsedVideoTimeRatio' }, { name: 'audienceWatchRatio' }], rows: [[0, 1], [0.25, 0.5]] }), { status: 200 });
      }
      if (url.searchParams.get('startDate')?.startsWith('2026-07')) return new Response(JSON.stringify({ error: { message: 'unavailable' } }), { status: 403 });
      return new Response(JSON.stringify({
        columnHeaders: [{ name: 'video' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }, { name: 'averageViewDuration' }, { name: 'averageViewPercentage' }, { name: 'subscribersGained' }, { name: 'subscribersLost' }],
        rows: [['video-1', 80, 120, 90, 42, 3, 1]],
      }), { status: 200 });
    };

    const report = await syncYoutubeAnalytics('profile-1', [sampleVideo], 'access-only-in-header', fetcher, new Date('2026-10-21T00:00:00.000Z'));
    expect(report.channelDaily90d?.status).toBe('ok');
    expect(report.videos_28d?.status).toBe('ok');
    expect(report.videos_90d?.status).toBe('unavailable');
    expect(report.videos_365d?.status).toBe('ok');
    expect(report.retentionTopVideos?.status).toBe('ok');
    const videoReportDates = new Map(urls.flatMap((value) => {
      const url = new URL(value);
      return url.searchParams.get('dimensions') === 'video' ? [[url.searchParams.get('startDate')!, url.searchParams.get('endDate')!] as const] : [];
    }));
    expect(videoReportDates.get('2026-09-22')).toBe('2026-10-19');
    expect(videoReportDates.get('2026-07-22')).toBe('2026-10-19');
    expect(videoReportDates.get('2025-10-20')).toBe('2026-10-19');
    expect(videoReportDates.get('2026-09-01')).toBe('2026-10-19');
    expect(await getStoredChannelDaily('profile-1')).toMatchObject([{ date: '2026-10-20', views: 25, subscribersGained: 2, subscribersLost: 1 }]);
    const video = await getCollection<TestDoc>('youtubeVideos').findOne({ _id: 'profile-1:video-1' });
    expect(video?.analytics).toMatchObject({ '28d': { views: 80, averageViewPercentage: 42, averageViewDurationSec: 90 } });
    expect((await findRetention('profile-1', 'video-1'))?.curve).toEqual([{ ratio: 0, watchRatio: 1 }, { ratio: 0.25, watchRatio: 0.5 }]);
    const cachedRetention = await getYoutubeRetention('profile-1', sampleVideo, async () => { throw new Error('Cached retention should not need a token.'); }, fetcher, new Date('2026-10-21T00:00:00.000Z'));
    expect(cachedRetention.curve).toEqual([{ ratio: 0, watchRatio: 1 }, { ratio: 0.25, watchRatio: 0.5 }]);
    expect(urls.every((url) => !/impressions|ClickThroughRate|estimatedRevenue/i.test(url))).toBe(true);
  });
});
