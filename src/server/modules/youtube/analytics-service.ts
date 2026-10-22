import { YoutubeChannelDailyDocSchema, YoutubeRetentionDocSchema, type YoutubeChannelDailyDoc } from './docs';
import type { YoutubeChannelDaily, YoutubeRetentionCurve, YoutubeSearchTerms, YoutubeSearchTermsBreakdown, YoutubeTrafficSource, YoutubeVideoStats } from '../../../contracts/youtube';
import { findRetention, listChannelDaily, listVideoDocs, patchVideoAnalytics, replaceChannelDaily, saveChannelSearchTerms, saveChannelTrafficSources, saveFirst28dIfMissing, saveVideoSearchTerms, saveVideoTrafficSources, upsertRetention } from './repo';
import { getYoutubeGrowthPlanStatus } from './growth-plan-service';

export const YOUTUBE_ANALYTICS_RETENTION_VIDEO_COUNT = 15;
export const YOUTUBE_FIRST28D_MINIMUM_AGE_DAYS = 31;
export const YOUTUBE_SEARCH_TERM_MAX_RESULTS = 25;
export const YOUTUBE_SEARCH_TERM_SYNC_QUERY_LIMIT = 20;

const REPORT_URL = 'https://youtubeanalytics.googleapis.com/v2/reports';
const ANALYTICS_VIDEO_BATCH_SIZE = 200;
const ANALYTICS_TRAFFIC_VIDEO_BATCH_SIZE = 10;
const RETENTION_CACHE_MS = 24 * 60 * 60_000;
const REPORT_METRICS = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'subscribersGained', 'subscribersLost'] as const;
const FIRST28D_METRICS = REPORT_METRICS.join(',');
const TRAFFIC_METRICS = 'views,estimatedMinutesWatched';

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

function toTrafficSources(payload: ReportPayload): YoutubeTrafficSource[] {
  const sourceColumn = columnIndex(payload, 'insightTrafficSourceType');
  return (payload.rows ?? []).flatMap((row) => {
    const sourceType = sourceColumn === undefined ? null : row[sourceColumn];
    if (typeof sourceType !== 'string') return [];
    return [{ sourceType, views: numberAt(row, columnIndex(payload, 'views')), estimatedMinutesWatched: numberAt(row, columnIndex(payload, 'estimatedMinutesWatched')) }];
  }).sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || a.sourceType.localeCompare(b.sourceType));
}

function toSearchTerms(payload: ReportPayload): YoutubeSearchTermsBreakdown['terms'] {
  const termColumn = columnIndex(payload, 'insightTrafficSourceDetail');
  return (payload.rows ?? []).flatMap((row) => {
    const term = termColumn === undefined ? null : row[termColumn];
    if (typeof term !== 'string' || !term.trim()) return [];
    return [{ term: term.replace(/[\u0000-\u001f\u007f-\u009f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 200), views: numberAt(row, columnIndex(payload, 'views')), estimatedMinutesWatched: numberAt(row, columnIndex(payload, 'estimatedMinutesWatched')) }];
  }).slice(0, YOUTUBE_SEARCH_TERM_MAX_RESULTS);
}

function searchTermDates(window: 'last28d' | 'lifetime', now: Date, firstPublishedAt: string | null): { startDate: string; endDate: string } {
  const end = shiftDate(now, -2);
  if (window === 'lifetime' && firstPublishedAt) return { startDate: dateString(new Date(firstPublishedAt)), endDate: dateString(end) };
  return { startDate: dateString(shiftDate(new Date(`${dateString(end)}T00:00:00.000Z`), -27)), endDate: dateString(end) };
}

async function querySearchTerms(window: 'last28d' | 'lifetime', accessToken: string, fetcher: typeof fetch, now: Date, video?: YoutubeVideoStats, firstPublishedAt: string | null = null): Promise<YoutubeSearchTermsBreakdown> {
  const targetPublishedAt = video?.publishedAt ?? firstPublishedAt;
  const dates = searchTermDates(window, now, targetPublishedAt);
  const filters = `insightTrafficSourceType==YT_SEARCH${video ? `;video==${video.videoId}` : ''}`;
  try {
    const payload = await queryReport({
      ...dates,
      metrics: TRAFFIC_METRICS,
      dimensions: 'insightTrafficSourceDetail',
      filters,
      sort: '-views',
      maxResults: String(YOUTUBE_SEARCH_TERM_MAX_RESULTS),
    }, accessToken, fetcher);
    return { capturedAt: now.toISOString(), status: 'ok', terms: toSearchTerms(payload) };
  } catch (error) {
    const status = queryStatus(error);
    return { capturedAt: now.toISOString(), status: status.status, terms: [] };
  }
}

export async function refreshYoutubeSearchTermsForVideo(profileId: string, video: YoutubeVideoStats, accessToken: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<YoutubeSearchTerms> {
  const [last28d, lifetime] = await Promise.all([
    querySearchTerms('last28d', accessToken, fetcher, now, video),
    querySearchTerms('lifetime', accessToken, fetcher, now, video),
  ]);
  await Promise.all([
    saveVideoSearchTerms(profileId, video.videoId, 'last28d', last28d),
    saveVideoSearchTerms(profileId, video.videoId, 'lifetime', lifetime),
  ]);
  return { last28d, lifetime };
}

async function syncYoutubeSearchTerms(profileId: string, videos: readonly YoutubeVideoStats[], accessToken: string, fetcher: typeof fetch, now: Date, report: YoutubeAnalyticsSyncReport, isCancelled?: () => Promise<boolean>): Promise<void> {
  const firstPublished = videos.flatMap((video) => video.publishedAt ? [video.publishedAt] : []).sort()[0] ?? null;
  let requestCount = 0;
  for (const window of ['last28d', 'lifetime'] as const) {
    if (await isCancelled?.()) return;
    const breakdown = await querySearchTerms(window, accessToken, fetcher, now, undefined, firstPublished);
    await saveChannelSearchTerms(profileId, window, breakdown);
    report[`search_channel_${window}`] = { status: breakdown.status };
    requestCount += 1;
  }

  const status = await getYoutubeGrowthPlanStatus(profileId, now);
  const maturePlanIds = new Set(status.videos.map((video) => video.videoId));
  const selected = videos.filter((video) => maturePlanIds.has(video.videoId))
    .sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')) || b.videoId.localeCompare(a.videoId))
    .slice(0, Math.floor((YOUTUBE_SEARCH_TERM_SYNC_QUERY_LIMIT - requestCount) / 2));
  let failedVideos = 0;
  let videoStatus: AnalyticsGroupStatus['status'] = 'ok';
  for (const video of selected) {
    for (const window of ['last28d', 'lifetime'] as const) {
      if (await isCancelled?.()) return;
      const breakdown = await querySearchTerms(window, accessToken, fetcher, now, video);
      await saveVideoSearchTerms(profileId, video.videoId, window, breakdown);
      requestCount += 1;
      if (breakdown.status !== 'ok') {
        failedVideos += 1;
        if (breakdown.status === 'error') videoStatus = 'error';
        else if (videoStatus === 'ok') videoStatus = 'unavailable';
      }
      report[`search_video_${window}`] = { status: videoStatus, ...(failedVideos ? { message: `Search term data unavailable for ${failedVideos} requests.` } : {}) };
    }
  }
  if (selected.length === 0) report.search_video_last28d = { status: 'ok', message: 'No mature plan videos were selected for search-term detail.' };
  if (selected.length === 0) report.search_video_lifetime = { status: 'ok', message: 'No mature plan videos were selected for search-term detail.' };
  report.searchTermQueryCount = { status: 'ok', message: `${requestCount} Analytics search-term queries; cap ${YOUTUBE_SEARCH_TERM_SYNC_QUERY_LIMIT}.` };
}

function first28dDates(publishedAt: string): { startDate: string; endDate: string } {
  const start = new Date(publishedAt);
  const end = shiftDate(new Date(`${dateString(start)}T00:00:00.000Z`), 27);
  return { startDate: dateString(start), endDate: dateString(end) };
}

function ageInDays(publishedAt: string | null, now: Date): number | null {
  if (!publishedAt) return null;
  const published = new Date(publishedAt).getTime();
  return Number.isFinite(published) ? Math.floor((now.getTime() - published) / 86_400_000) : null;
}

async function captureFirst28dSnapshots(profileId: string, videos: readonly YoutubeVideoStats[], accessToken: string, fetcher: typeof fetch, now: Date, report: YoutubeAnalyticsSyncReport): Promise<void> {
  const stored = new Map((await listVideoDocs(profileId)).map((video) => [video.videoId, video]));
  const mature = videos.filter((video) => {
    const age = ageInDays(video.publishedAt, now);
    return video.privacy === 'public' && !video.isShort && age !== null && age >= YOUTUBE_FIRST28D_MINIMUM_AGE_DAYS && !stored.get(video.videoId)?.first28d;
  });
  for (const video of mature) {
    const key = `first28d_${video.videoId}`;
    try {
      const payload = await queryReport({ ...first28dDates(video.publishedAt!), metrics: FIRST28D_METRICS, filters: `video==${video.videoId}` }, accessToken, fetcher);
      const row = payload.rows?.[0];
      const snapshot = {
        capturedAt: now.toISOString(),
        views: row ? numberAt(row, columnIndex(payload, 'views')) : null,
        estimatedMinutesWatched: row ? numberAt(row, columnIndex(payload, 'estimatedMinutesWatched')) : null,
        averageViewDurationSec: row ? numberAt(row, columnIndex(payload, 'averageViewDuration')) : null,
        averageViewPercentage: row ? numberAt(row, columnIndex(payload, 'averageViewPercentage')) : null,
        subscribersGained: row ? numberAt(row, columnIndex(payload, 'subscribersGained')) : null,
        subscribersLost: row ? numberAt(row, columnIndex(payload, 'subscribersLost')) : null,
      };
      await saveFirst28dIfMissing(profileId, video.videoId, snapshot);
      report[key] = { status: 'ok' };
    } catch (error) {
      report[key] = queryStatus(error);
    }
  }
}

async function syncTrafficSources(profileId: string, videos: readonly YoutubeVideoStats[], window: 'last28d' | 'lifetime', accessToken: string, fetcher: typeof fetch, now: Date, report: YoutubeAnalyticsSyncReport): Promise<void> {
  const endDate = dateString(shiftDate(now, -2));
  const startDate = window === 'last28d'
    ? dateString(shiftDate(new Date(`${endDate}T00:00:00.000Z`), -27))
    : videos.flatMap((video) => video.publishedAt ? [dateString(new Date(video.publishedAt))] : []).sort()[0] ?? endDate;
  const channelKey = `traffic_channel_${window}`;
  try {
    const payload = await queryReport({ startDate, endDate, metrics: TRAFFIC_METRICS, dimensions: 'insightTrafficSourceType', sort: '-views', maxResults: '200' }, accessToken, fetcher);
    await saveChannelTrafficSources(profileId, window, { capturedAt: now.toISOString(), status: 'ok', sources: toTrafficSources(payload) });
    report[channelKey] = { status: 'ok' };
  } catch (error) {
    const status = queryStatus(error);
    await saveChannelTrafficSources(profileId, window, { capturedAt: now.toISOString(), status: status.status, sources: [] });
    report[channelKey] = status;
  }

  const available = videos.filter((video) => video.privacy !== 'removed');
  let videoStatus: AnalyticsGroupStatus['status'] = 'ok';
  let failures = 0;
  for (let offset = 0; offset < available.length; offset += ANALYTICS_TRAFFIC_VIDEO_BATCH_SIZE) {
    const batch = available.slice(offset, offset + ANALYTICS_TRAFFIC_VIDEO_BATCH_SIZE);
    if (!batch.length) continue;
    try {
      const payload = await queryReport({ startDate, endDate, metrics: TRAFFIC_METRICS, dimensions: batch.length > 1 ? 'insightTrafficSourceType,video' : 'insightTrafficSourceType', filters: `video==${batch.map((video) => video.videoId).join(',')}`, sort: '-views', maxResults: '200' }, accessToken, fetcher);
      const videoColumn = columnIndex(payload, 'video');
      const sourceColumn = columnIndex(payload, 'insightTrafficSourceType');
      const grouped = new Map<string, YoutubeTrafficSource[]>();
      for (const row of payload.rows ?? []) {
        const videoId = batch.length === 1 ? batch[0]!.videoId : videoColumn === undefined ? null : row[videoColumn];
        const sourceType = sourceColumn === undefined ? null : row[sourceColumn];
        if (typeof videoId !== 'string' || typeof sourceType !== 'string') continue;
        const sources = grouped.get(videoId) ?? [];
        sources.push({ sourceType, views: numberAt(row, columnIndex(payload, 'views')), estimatedMinutesWatched: numberAt(row, columnIndex(payload, 'estimatedMinutesWatched')) });
        grouped.set(videoId, sources);
      }
      await Promise.all(batch.map((video) => saveVideoTrafficSources(profileId, video.videoId, window, { capturedAt: now.toISOString(), status: 'ok', sources: (grouped.get(video.videoId) ?? []).sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || a.sourceType.localeCompare(b.sourceType)) })));
    } catch (error) {
      failures += batch.length;
      const status = queryStatus(error);
      if (status.status === 'error') videoStatus = 'error';
      else if (videoStatus === 'ok') videoStatus = 'unavailable';
      await Promise.all(batch.map((video) => saveVideoTrafficSources(profileId, video.videoId, window, { capturedAt: now.toISOString(), status: status.status, sources: [] })));
    }
  }
  report[`traffic_video_${window}`] = failures ? { status: videoStatus, message: `Traffic source data unavailable for ${failures} videos.` } : { status: 'ok' };
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

export async function getYoutubeRetention(profileId: string, video: YoutubeVideoStats, accessToken: string | (() => Promise<string>), fetcher: typeof fetch = fetch, now = new Date()): Promise<{ curve: YoutubeRetentionCurve | null; reason?: string }> {
  const cached = await findRetention(profileId, video.videoId);
  if (cached && now.getTime() - cached.fetchedAt.getTime() < RETENTION_CACHE_MS) return cached.curve.length ? { curve: cached.curve } : { curve: null, reason: 'YouTube Analytics không trả đường giữ chân cho video này.' };
  try {
    const token = typeof accessToken === 'function' ? await accessToken() : accessToken;
    const curve = await queryRetention(video, token, fetcher, now);
    await upsertRetention(YoutubeRetentionDocSchema.parse({ _id: `${profileId}:${video.videoId}`, channelProfileId: profileId, videoId: video.videoId, fetchedAt: now, curve }));
    return curve.length ? { curve } : { curve: null, reason: 'YouTube Analytics không trả đường giữ chân cho video này.' };
  } catch (error) {
    const status = queryStatus(error);
    return { curve: null, reason: status.status === 'unavailable' ? 'Dữ liệu giữ chân chưa có hoặc không được API cung cấp cho video này.' : status.message };
  }
}

export async function syncYoutubeAnalytics(profileId: string, videos: readonly YoutubeVideoStats[], accessToken: string, fetcher: typeof fetch = fetch, now = new Date(), isCancelled?: () => Promise<boolean>): Promise<YoutubeAnalyticsSyncReport> {
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

  await captureFirst28dSnapshots(profileId, availableVideos, accessToken, fetcher, now, report);
  await syncTrafficSources(profileId, availableVideos, 'last28d', accessToken, fetcher, now, report);
  await syncTrafficSources(profileId, availableVideos, 'lifetime', accessToken, fetcher, now, report);
  await syncYoutubeSearchTerms(profileId, availableVideos, accessToken, fetcher, now, report, isCancelled);

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
