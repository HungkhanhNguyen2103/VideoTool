import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Document } from 'mongodb';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import type { YoutubeVideoStats } from '../../../contracts/youtube';
import { findChannelTrafficSources, findRetention, replaceYoutubeGrowthPlan, upsertVideoDocs } from './repo';
import { YoutubeVideoDocSchema } from './docs';
import { getStoredChannelDaily, getYoutubeRetention, syncYoutubeAnalytics } from './analytics-service';

type TestDoc = Document & { _id: string; [key: string]: unknown };
const sampleVideo: YoutubeVideoStats = {
  videoId: 'video-1', title: 'Kênh của Hung', publishedAt: '2026-09-01T00:00:00.000Z', durationSec: 600, isShort: false,
  privacy: 'public', viewCount: 100, likeCount: 2, commentCount: 0, fetchedAt: '2026-10-21T00:00:00.000Z', analytics: {},
  first28d: null, manualReach: null, excludedFromPlan: false, trafficSources: {}, searchTerms: {},
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
  it('captures an immutable publish-relative first-28-day snapshot for mature public videos', async () => {
    const urls: URL[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.searchParams.get('metrics') === 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost') {
        return new Response(JSON.stringify({
          columnHeaders: [{ name: 'views' }, { name: 'estimatedMinutesWatched' }, { name: 'averageViewDuration' }, { name: 'averageViewPercentage' }, { name: 'subscribersGained' }, { name: 'subscribersLost' }],
          rows: [[525, 2_100, 240, 40, 8, 1]],
        }), { status: 200 });
      }
      if (url.searchParams.get('dimensions') === 'day') return new Response(JSON.stringify({ columnHeaders: [{ name: 'day' }], rows: [] }), { status: 200 });
      if (url.searchParams.get('dimensions') === 'insightTrafficSourceType') return new Response(JSON.stringify({ columnHeaders: [{ name: 'insightTrafficSourceType' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }], rows: [] }), { status: 200 });
      if (url.searchParams.get('metrics') === 'audienceWatchRatio') return new Response(JSON.stringify({ columnHeaders: [{ name: 'elapsedVideoTimeRatio' }, { name: 'audienceWatchRatio' }], rows: [] }), { status: 200 });
      return new Response(JSON.stringify({ columnHeaders: [{ name: 'video' }], rows: [] }), { status: 200 });
    };
    const now = new Date('2026-10-21T00:00:00.000Z');
    const report = await syncYoutubeAnalytics('profile-1', [sampleVideo], 'token', fetcher, now);
    const first28Request = urls.find((url) => url.searchParams.get('filters') === 'video==video-1' && url.searchParams.get('dimensions') === null && url.searchParams.get('startDate') === '2026-09-01');
    expect(first28Request?.searchParams.get('endDate')).toBe('2026-09-28');
    expect(report['first28d_video-1']?.status).toBe('ok');
    expect(await getCollection<TestDoc>('youtubeVideos').findOne({ _id: 'profile-1:video-1' })).toMatchObject({
      first28d: { views: 525, estimatedMinutesWatched: 2_100, averageViewDurationSec: 240, averageViewPercentage: 40, subscribersGained: 8, subscribersLost: 1 },
    });

    await getCollection<TestDoc>('youtubeVideos').updateOne({ _id: 'profile-1:video-1' }, { $set: { first28d: { capturedAt: now.toISOString(), views: 777, estimatedMinutesWatched: null, averageViewDurationSec: null, averageViewPercentage: null, subscribersGained: null, subscribersLost: null } } });
    await syncYoutubeAnalytics('profile-1', [sampleVideo], 'token', async () => { throw new Error('A saved snapshot must not be queried again.'); }, new Date('2026-10-22T00:00:00.000Z'));
    expect(await getCollection<TestDoc>('youtubeVideos').findOne({ _id: 'profile-1:video-1' })).toMatchObject({ first28d: { views: 777 } });
  });

  it('does not request first-28-day snapshots for private, short, or not-yet-mature videos', async () => {
    const candidates = [
      sampleVideo,
      { ...sampleVideo, videoId: 'private-video', privacy: 'private' as const },
      { ...sampleVideo, videoId: 'short-video', isShort: true },
      { ...sampleVideo, videoId: 'young-video', publishedAt: '2026-10-01T00:00:00.000Z' },
    ];
    await getCollection<TestDoc>('youtubeVideos').insertMany(candidates.filter((video) => video.videoId !== sampleVideo.videoId).map((video) => ({
      ...video, _id: `profile-1:${video.videoId}`, channelProfileId: 'profile-1', removed: false,
    })));
    const first28Requests: URL[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get('dimensions') === null && url.searchParams.get('metrics') === 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost') first28Requests.push(url);
      return new Response(JSON.stringify({ columnHeaders: [{ name: 'views' }, { name: 'estimatedMinutesWatched' }, { name: 'averageViewDuration' }, { name: 'averageViewPercentage' }, { name: 'subscribersGained' }, { name: 'subscribersLost' }], rows: [[1, 1, 60, 10, 0, 0]] }), { status: 200 });
    };
    await syncYoutubeAnalytics('profile-1', candidates, 'token', fetcher, new Date('2026-10-21T00:00:00.000Z'));
    expect(first28Requests.map((url) => url.searchParams.get('filters'))).toEqual(['video==video-1']);
  });

  it('keeps first-28-day API failures unknown and records the per-video sync reason', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get('dimensions') === null && url.searchParams.get('filters') === 'video==video-1') return new Response('{}', { status: 403 });
      return new Response(JSON.stringify({ columnHeaders: [{ name: 'video' }, { name: 'views' }], rows: [] }), { status: 200 });
    };
    const report = await syncYoutubeAnalytics('profile-1', [sampleVideo], 'token', fetcher, new Date('2026-10-21T00:00:00.000Z'));
    expect(report['first28d_video-1']).toMatchObject({ status: 'unavailable' });
    expect(await getCollection<TestDoc>('youtubeVideos').findOne({ _id: 'profile-1:video-1' })).toMatchObject({ first28d: null });
  });

  it('stores channel and per-video traffic source breakdowns for both windows', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const dimensions = url.searchParams.get('dimensions');
      if (dimensions === 'day') return new Response(JSON.stringify({ columnHeaders: [{ name: 'day' }], rows: [] }), { status: 200 });
      if (dimensions === 'insightTrafficSourceType' && url.searchParams.get('filters') === 'video==video-1') return new Response(JSON.stringify({
        columnHeaders: [{ name: 'insightTrafficSourceType' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }],
        rows: [['YOUTUBE_SEARCH', 80, 240]],
      }), { status: 200 });
      if (dimensions === 'insightTrafficSourceType') return new Response(JSON.stringify({
        columnHeaders: [{ name: 'insightTrafficSourceType' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }],
        rows: [['BROWSE_FEATURES', 300, 900]],
      }), { status: 200 });
      if (dimensions === 'elapsedVideoTimeRatio') return new Response(JSON.stringify({ columnHeaders: [{ name: 'elapsedVideoTimeRatio' }, { name: 'audienceWatchRatio' }], rows: [] }), { status: 200 });
      return new Response(JSON.stringify({ columnHeaders: [{ name: 'video' }, { name: 'views' }], rows: [] }), { status: 200 });
    };
    await syncYoutubeAnalytics('profile-1', [sampleVideo], 'token', fetcher, new Date('2026-10-21T00:00:00.000Z'));
    expect(await findChannelTrafficSources('profile-1')).toMatchObject({
      last28d: { status: 'ok', sources: [{ sourceType: 'BROWSE_FEATURES', views: 300, estimatedMinutesWatched: 900 }] },
      lifetime: { status: 'ok', sources: [{ sourceType: 'BROWSE_FEATURES', views: 300, estimatedMinutesWatched: 900 }] },
    });
    expect(await getCollection<TestDoc>('youtubeVideos').findOne({ _id: 'profile-1:video-1' })).toMatchObject({
        trafficSources: {
        last28d: { status: 'ok', sources: [{ sourceType: 'YOUTUBE_SEARCH', views: 80, estimatedMinutesWatched: 240 }] },
        lifetime: { status: 'ok', sources: [{ sourceType: 'YOUTUBE_SEARCH', views: 80, estimatedMinutesWatched: 240 }] },
      },
    });
  });

  it('marks unsupported traffic-source reports unavailable for channel and video groups', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get('dimensions')?.includes('insightTrafficSourceType')) return new Response('{}', { status: 403 });
      return new Response(JSON.stringify({ columnHeaders: [{ name: 'day' }], rows: [] }), { status: 200 });
    };
    const report = await syncYoutubeAnalytics('profile-1', [sampleVideo], 'token', fetcher, new Date('2026-10-21T00:00:00.000Z'));
    expect(report.traffic_channel_last28d?.status).toBe('unavailable');
    expect(report.traffic_video_last28d?.status).toBe('unavailable');
    expect(await findChannelTrafficSources('profile-1')).toMatchObject({ last28d: { status: 'unavailable', sources: [] } });
    expect(await getCollection<TestDoc>('youtubeVideos').findOne({ _id: 'profile-1:video-1' })).toMatchObject({ trafficSources: { last28d: { status: 'unavailable', sources: [] } } });
  });

  it('fetches bounded search-detail reports for the channel and mature plan videos in both windows', async () => {
    await replaceYoutubeGrowthPlan('profile-1', {
      nicheStartDate: '2026-01-01', cadencePerWeek: 2, viewTargets: { first: 500, strong: 1_000 },
      assumedAvgViewDurationMin: 4, toleranceMonths: 12, warnAtMatureVideos: 15, decideAtMatureVideos: 40,
      decideMinMonths: 4, hardReviewWeek: 26, minExperimentsBeforeStop: 2, submittedForReviewAt: null,
    }, new Date('2026-10-21T00:00:00.000Z'));
    await getCollection<TestDoc>('youtubeVideos').updateOne({ _id: 'profile-1:video-1' }, { $set: { first28d: { capturedAt: '2026-10-01T00:00:00.000Z', views: 100, estimatedMinutesWatched: 500, averageViewDurationSec: 300, averageViewPercentage: 50, subscribersGained: 2, subscribersLost: 0 } } });
    const urls: URL[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.searchParams.get('dimensions') === 'insightTrafficSourceDetail') return new Response(JSON.stringify({
        columnHeaders: [{ name: 'insightTrafficSourceDetail' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }],
        rows: [['cách viết kịch bản', 12, 72]],
      }), { status: 200 });
      if (url.searchParams.get('dimensions') === 'day') return new Response(JSON.stringify({ columnHeaders: [{ name: 'day' }], rows: [] }), { status: 200 });
      if (url.searchParams.get('dimensions')?.includes('insightTrafficSourceType')) return new Response(JSON.stringify({ columnHeaders: [{ name: 'insightTrafficSourceType' }, { name: 'views' }], rows: [] }), { status: 200 });
      if (url.searchParams.get('metrics') === 'audienceWatchRatio') return new Response(JSON.stringify({ columnHeaders: [{ name: 'elapsedVideoTimeRatio' }, { name: 'audienceWatchRatio' }], rows: [] }), { status: 200 });
      return new Response(JSON.stringify({ columnHeaders: [{ name: 'video' }, { name: 'views' }], rows: [] }), { status: 200 });
    };
    const report = await syncYoutubeAnalytics('profile-1', [sampleVideo], 'token', fetcher, new Date('2026-10-21T00:00:00.000Z'));
    const searchRequests = urls.filter((url) => url.searchParams.get('dimensions') === 'insightTrafficSourceDetail');
    expect(searchRequests).toHaveLength(4);
    expect(searchRequests.every((url) => url.searchParams.get('filters')?.startsWith('insightTrafficSourceType==YT_SEARCH'))).toBe(true);
    expect(searchRequests.every((url) => url.searchParams.get('sort') === '-views' && url.searchParams.get('maxResults') === '25')).toBe(true);
    expect(searchRequests.some((url) => url.searchParams.get('filters')?.includes('video==video-1'))).toBe(true);
    expect(report.search_channel_last28d?.status).toBe('ok');
    expect(await findChannelTrafficSources('profile-1')).toMatchObject({ searchTerms: { last28d: { status: 'ok', terms: [{ term: 'cách viết kịch bản', views: 12, estimatedMinutesWatched: 72 }] } } });
    expect(await getCollection<TestDoc>('youtubeVideos').findOne({ _id: 'profile-1:video-1' })).toMatchObject({ searchTerms: { lifetime: { status: 'ok', terms: [{ term: 'cách viết kịch bản', views: 12, estimatedMinutesWatched: 72 }] } } });
  });

  it('records unavailable and hidden search terms without fabricating term rows', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get('dimensions') === 'insightTrafficSourceDetail' && !url.searchParams.get('filters')?.includes('video==')) return new Response('{}', { status: 403 });
      if (url.searchParams.get('dimensions') === 'insightTrafficSourceDetail') return new Response(JSON.stringify({ columnHeaders: [{ name: 'insightTrafficSourceDetail' }, { name: 'views' }], rows: [] }), { status: 200 });
      if (url.searchParams.get('dimensions') === 'day') return new Response('{}', { status: 200 });
      if (url.searchParams.get('metrics') === 'audienceWatchRatio') return new Response('{}', { status: 200 });
      return new Response('{}', { status: 200 });
    };
    await syncYoutubeAnalytics('profile-1', [sampleVideo], 'token', fetcher, new Date('2026-10-21T00:00:00.000Z'));
    expect(await findChannelTrafficSources('profile-1')).toMatchObject({ searchTerms: { last28d: { status: 'unavailable', terms: [] }, lifetime: { status: 'unavailable', terms: [] } } });
    expect(await getCollection<TestDoc>('youtubeVideos').findOne({ _id: 'profile-1:video-1' })).toMatchObject({ searchTerms: { last28d: { status: 'ok', terms: [] } } });
  });

  it('preserves snapshots and user-entered video fields during provider upserts', async () => {
    const first28d = { capturedAt: '2026-10-01T00:00:00.000Z', views: 600, estimatedMinutesWatched: 1200, averageViewDurationSec: 120, averageViewPercentage: 30, subscribersGained: 3, subscribersLost: 0 };
    const manualReach = { impressions: 4_000, ctrPercent: 3.25, enteredAt: '2026-10-02T00:00:00.000Z' };
    const trafficSources = { last28d: { capturedAt: '2026-10-03T00:00:00.000Z', status: 'ok' as const, sources: [{ sourceType: 'BROWSE_FEATURES', views: 300, estimatedMinutesWatched: 900 }] } };
    const searchTerms = { last28d: { capturedAt: '2026-10-03T00:00:00.000Z', status: 'ok' as const, terms: [{ term: 'kịch bản', views: 10, estimatedMinutesWatched: 35 }] } };
    await getCollection<TestDoc>('youtubeVideos').updateOne({ _id: 'profile-1:video-1' }, { $set: { first28d, manualReach, excludedFromPlan: true, trafficSources, searchTerms } });
    const refreshed = YoutubeVideoDocSchema.parse({ ...sampleVideo, title: 'Refreshed title', fetchedAt: '2026-10-22T00:00:00.000Z', _id: 'profile-1:video-1', channelProfileId: 'profile-1', removed: false });
    await upsertVideoDocs('profile-1', [refreshed], new Date('2026-10-22T00:00:00.000Z'));
    expect(await getCollection<TestDoc>('youtubeVideos').findOne({ _id: 'profile-1:video-1' })).toMatchObject({ title: 'Refreshed title', first28d, manualReach, excludedFromPlan: true, trafficSources, searchTerms });
  });

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
