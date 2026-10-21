import { YoutubeChannelDailyDocSchema, YoutubeRetentionDocSchema, type YoutubeChannelDailyDoc } from './docs';
import type { YoutubeChannelDaily, YoutubeRetentionCurve, YoutubeVideoStats } from '../../../contracts/youtube';
import { findRetention, listChannelDaily, patchVideoAnalytics, replaceChannelDaily, upsertRetention } from './repo';

export const YOUTUBE_ANALYTICS_RETENTION_VIDEO_COUNT = 15;

const REPORT_URL = 'https://youtubeanalytics.googleapis.com/v2/reports';
const ANALYTICS_VIDEO_BATCH_SIZE = 200;
const RETENTION_CACHE_MS = 24 * 60 * 60_000;
const REPORT_METRICS = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'subscribersGained', 'subscribersLost'] as const;

type ReportPayload = { columnHeaders?: { name?: string }[]; rows?: (string | number | null)[][] };
type AnalyticsGroupStatus = { status: 'ok' | 'unavailable' | 'error'; message?: string };
export type YoutubeAnalyticsSyncReport = Record<string, AnalyticsGroupStatus>;

class AnalyticsQueryError extends Error {
  constructor(readonly status: number) { super('YouTube Analytics report unavailable.'); }
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDate(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

async function queryReport(params: Record<string, string>, accessToken: string, fetcher: typeof fetch): Promise<ReportPayload> {
  const url = new URL(REPORT_URL);
  for (const [key, value] of Object.entries({ ids: 'channel==MINE', ...params })) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetcher(url, { headers: { authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new AnalyticsQueryError(0);
  }
  if (!response.ok) throw new AnalyticsQueryError(response.status);
  return response.json() as Promise<ReportPayload>;
}

function queryStatus(error: unknown): AnalyticsGroupStatus {
  if (error instanceof AnalyticsQueryError && [400, 403].includes(error.status)) return { status: 'unavailable', message: 'YouTube did not return this report for the connected channel or scope.' };
  return { status: 'error', message: 'YouTube Analytics could not be reached.' };
}

function numberAt(row: (string | number | null)[], index: number | undefined): number | null {
  if (index === undefined) return null;
  const value = row[index];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function columnIndex(payload: ReportPayload, name: string): number | undefined {
  return payload.columnHeaders?.findIndex((column) => column.name?.toLowerCase() === name.toLowerCase());
}

function toDailyRows(payload: ReportPayload, profileId: string): YoutubeChannelDailyDoc[] {
  return (payload.rows ?? []).flatMap((row) => {
    const date = row[0];
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    return [YoutubeChannelDailyDocSchema.parse({
      _id: `${profileId}:${date}`,
      channelProfileId: profileId,
      date,
      views: numberAt(row, columnIndex(payload, 'views')) ?? 0,
      estimatedMinutesWatched: numberAt(row, columnIndex(payload, 'estimatedMinutesWatched')) ?? 0,
      subscribersGained: numberAt(row, columnIndex(payload, 'subscribersGained')) ?? 0,
      subscribersLost: numberAt(row, columnIndex(payload, 'subscribersLost')) ?? 0,
    })];
  });
}

function asYoutubeDaily(rows: readonly YoutubeChannelDailyDoc[]): YoutubeChannelDaily[] {
  return rows.map(({ date, views, estimatedMinutesWatched, subscribersGained, subscribersLost }) => ({ date, views, estimatedMinutesWatched, subscribersGained, subscribersLost }));
}

function windowDates(window: '28d' | '90d' | '365d' | 'lifetime', now: Date, firstPublished?: string | null): { startDate: string; endDate: string } {
  const end = shiftDate(now, -2);
  const days = window === '28d' ? 28 : window === '90d' ? 90 : 365;
  const start = window === 'lifetime' && firstPublished ? new Date(firstPublished) : shiftDate(end, -days + 1);
  return { startDate: dateString(start), endDate: dateString(end) };
}

async function fetchVideoWindow(profileId: string, videos: readonly YoutubeVideoStats[], window: '28d' | '90d' | '365d' | 'lifetime', now: Date, accessToken: string, fetcher: typeof fetch): Promise<void> {
  const ids = videos.map((video) => video.videoId);
  if (!ids.length) return;
  const dates = windowDates(window, now, videos.flatMap((video) => video.publishedAt ? [video.publishedAt] : []).sort()[0]);
  for (let offset = 0; offset < ids.length; offset += ANALYTICS_VIDEO_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + ANALYTICS_VIDEO_BATCH_SIZE);
    const payload = await queryReport({
      ...dates,
      metrics: REPORT_METRICS.join(','),
      dimensions: 'video',
      filters: `video==${batch.join(',')}`,
      sort: '-views',
      maxResults: '200',
    }, accessToken, fetcher);
    for (const row of payload.rows ?? []) {
      const videoId = row[0];
      if (typeof videoId !== 'string') continue;
      const values: Record<string, number | null> = {
        views: numberAt(row, columnIndex(payload, 'views')),
        estimatedMinutesWatched: numberAt(row, columnIndex(payload, 'estimatedMinutesWatched')),
        averageViewDurationSec: numberAt(row, columnIndex(payload, 'averageViewDuration')),
        averageViewPercentage: numberAt(row, columnIndex(payload, 'averageViewPercentage')),
        subscribersGained: numberAt(row, columnIndex(payload, 'subscribersGained')),
        subscribersLost: numberAt(row, columnIndex(payload, 'subscribersLost')),
      };
      await patchVideoAnalytics(profileId, videoId, { [window]: values });
    }
  }
}

async function queryRetention(video: YoutubeVideoStats, accessToken: string, fetcher: typeof fetch, now: Date): Promise<YoutubeRetentionCurve> {
  const dates = windowDates('lifetime', now, video.publishedAt);
  const payload = await queryReport({
    ...dates,
    metrics: 'audienceWatchRatio',
    dimensions: 'elapsedVideoTimeRatio',
    filters: `video==${video.videoId}`,
    sort: 'elapsedVideoTimeRatio',
    maxResults: '200',
  }, accessToken, fetcher);
  const ratioColumn = columnIndex(payload, 'elapsedVideoTimeRatio') ?? 0;
  const watchColumn = columnIndex(payload, 'audienceWatchRatio') ?? 1;
  return (payload.rows ?? []).flatMap((row) => {
    const ratio = numberAt(row, ratioColumn);
    const watchRatio = numberAt(row, watchColumn);
    return ratio === null || watchRatio === null || ratio < 0 || ratio > 1 || watchRatio < 0 ? [] : [{ ratio, watchRatio }];
  }).sort((a, b) => a.ratio - b.ratio);
}

export async function getYoutubeRetention(profileId: string, video: YoutubeVideoStats, accessToken: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<{ curve: YoutubeRetentionCurve | null; reason?: string }> {
  const cached = await findRetention(profileId, video.videoId);
  if (cached && now.getTime() - cached.fetchedAt.getTime() < RETENTION_CACHE_MS) return cached.curve.length ? { curve: cached.curve } : { curve: null, reason: 'YouTube Analytics không trả đường giữ chân cho video này.' };
  try {
    const curve = await queryRetention(video, accessToken, fetcher, now);
    await upsertRetention(YoutubeRetentionDocSchema.parse({ _id: `${profileId}:${video.videoId}`, channelProfileId: profileId, videoId: video.videoId, fetchedAt: now, curve }));
    return curve.length ? { curve } : { curve: null, reason: 'YouTube Analytics không trả đường giữ chân cho video này.' };
  } catch (error) {
    const status = queryStatus(error);
    return { curve: null, reason: status.status === 'unavailable' ? 'Dữ liệu giữ chân chưa có hoặc không được API cung cấp cho video này.' : status.message };
  }
}

export async function syncYoutubeAnalytics(profileId: string, videos: readonly YoutubeVideoStats[], accessToken: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<YoutubeAnalyticsSyncReport> {
  const report: YoutubeAnalyticsSyncReport = {};
  const endDate = dateString(shiftDate(now, -2));
  const startDate = dateString(shiftDate(new Date(`${endDate}T00:00:00.000Z`), -89));
  try {
    const payload = await queryReport({ startDate, endDate, metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost', dimensions: 'day', sort: 'day', maxResults: '100' }, accessToken, fetcher);
    const rows = toDailyRows(payload, profileId);
    await replaceChannelDaily(profileId, rows);
    report.channelDaily90d = { status: 'ok' };
  } catch (error) {
    report.channelDaily90d = queryStatus(error);
  }

  const availableVideos = videos.filter((video) => video.privacy !== 'removed');
  for (const window of ['28d', '90d', '365d', 'lifetime'] as const) {
    try {
      await fetchVideoWindow(profileId, availableVideos, window, now, accessToken, fetcher);
      report[`videos_${window}`] = { status: 'ok' };
    } catch (error) {
      report[`videos_${window}`] = queryStatus(error);
    }
  }

  const topLong = [...availableVideos].filter((video) => !video.isShort).sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? ''))).slice(0, YOUTUBE_ANALYTICS_RETENTION_VIDEO_COUNT);
  let retentionFailures = 0;
  for (const video of topLong) {
    const result = await getYoutubeRetention(profileId, video, accessToken, fetcher, now);
    if (!result.curve) retentionFailures += 1;
  }
  report.retentionTopVideos = retentionFailures === 0 ? { status: 'ok' } : { status: 'unavailable', message: `Retention data unavailable for ${retentionFailures} of ${topLong.length} selected videos.` };
  return report;
}

export async function getStoredChannelDaily(profileId: string): Promise<YoutubeChannelDaily[]> {
  return asYoutubeDaily(await listChannelDaily(profileId));
}

export { RETENTION_CACHE_MS };
