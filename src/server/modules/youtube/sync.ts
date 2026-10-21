import { createHash } from 'node:crypto';
import { AppError } from '../../shared/errors';
import { loadConfig } from '../../config';
import { YoutubeVideoStatsSchema, type YoutubeVideoStats } from '../../../contracts/youtube';
import { decryptRefreshToken } from './credentials-store';
import { YoutubeOAuthError, refreshAccessToken } from './oauth';
import { findCredential, getQuota, incrementQuota, patchCredential, upsertVideoDocs } from './repo';
import { YoutubeVideoDocSchema } from './docs';
import { syncYoutubeAnalytics } from './analytics-service';

export const YOUTUBE_DATA_API_DAILY_BUDGET = 10_000;
export const YOUTUBE_DATA_API_SYNC_SOFT_LIMIT = 8_000;
export const YOUTUBE_LIST_CALL_QUOTA_UNITS = 1;
export const YOUTUBE_LIST_PAGE_SIZE = 50;

export function estimateDataApiUnits(videoCount: number): number {
  const count = Math.max(0, Math.trunc(videoCount));
  const playlistPages = Math.max(1, Math.ceil(count / YOUTUBE_LIST_PAGE_SIZE));
  const videoBatches = Math.ceil(count / YOUTUBE_LIST_PAGE_SIZE);
  return YOUTUBE_LIST_CALL_QUOTA_UNITS * (1 + playlistPages + videoBatches);
}

export function quotaDatePacific(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function quotaProjectKey(clientId: string): string {
  const projectNumber = clientId.match(/^(\d+)-/)?.[1] ?? clientId;
  return createHash('sha256').update(projectNumber).digest('hex').slice(0, 24);
}

export function parseIsoDuration(value: string): number {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

async function apiJson<T>(url: URL, accessToken: string, fetcher: typeof fetch): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new AppError('Không thể kết nối tới YouTube. Hãy thử đồng bộ lại sau.', 502, 'YOUTUBE_API_UNAVAILABLE');
  }
  if (!response.ok) {
    throw new AppError('YouTube từ chối yêu cầu đọc dữ liệu. Hãy kiểm tra quyền kết nối rồi thử lại.', response.status === 401 ? 401 : 502, response.status === 401 ? 'YOUTUBE_UNAUTHORIZED' : 'YOUTUBE_API_ERROR');
  }
  return response.json() as Promise<T>;
}

export async function readUploadVideoIds(uploadsPlaylistId: string, accessToken: string, fetcher: typeof fetch = fetch): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'contentDetails');
    url.searchParams.set('playlistId', uploadsPlaylistId);
    url.searchParams.set('maxResults', String(YOUTUBE_LIST_PAGE_SIZE));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const page = await apiJson<{ items?: { contentDetails?: { videoId?: string } }[]; nextPageToken?: string }>(url, accessToken, fetcher);
    ids.push(...(page.items ?? []).flatMap((item) => typeof item.contentDetails?.videoId === 'string' ? [item.contentDetails.videoId] : []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return ids;
}

type ApiVideo = {
  id: string;
  snippet?: { title?: string; publishedAt?: string; thumbnails?: { default?: { url?: string } } };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  status?: { privacyStatus?: 'public' | 'unlisted' | 'private' };
};

export async function readVideosByIds(ids: readonly string[], accessToken: string, fetcher: typeof fetch = fetch): Promise<ApiVideo[]> {
  const result: ApiVideo[] = [];
  for (let offset = 0; offset < ids.length; offset += YOUTUBE_LIST_PAGE_SIZE) {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,contentDetails,statistics,status');
    url.searchParams.set('id', ids.slice(offset, offset + YOUTUBE_LIST_PAGE_SIZE).join(','));
    url.searchParams.set('maxResults', String(YOUTUBE_LIST_PAGE_SIZE));
    const page = await apiJson<{ items?: ApiVideo[] }>(url, accessToken, fetcher);
    result.push(...(page.items ?? []));
  }
  return result;
}

function numeric(value?: string): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function normalizeApiVideo(video: ApiVideo, fetchedAt: string): YoutubeVideoStats {
  return YoutubeVideoStatsSchema.parse({
    videoId: video.id,
    title: video.snippet?.title ?? '',
    publishedAt: video.snippet?.publishedAt ?? null,
    durationSec: parseIsoDuration(video.contentDetails?.duration ?? ''),
    // YouTube Data API does not expose aspect ratio for ordinary channel owners; use the documented duration-only fallback.
    isShort: parseIsoDuration(video.contentDetails?.duration ?? '') <= 180,
    privacy: video.status?.privacyStatus ?? 'private',
    viewCount: numeric(video.statistics?.viewCount),
    likeCount: numeric(video.statistics?.likeCount),
    commentCount: numeric(video.statistics?.commentCount),
    fetchedAt,
    analytics: {},
  });
}

export type YoutubeSyncJobContext = {
  reportProgress: (percent: number, result?: unknown) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
};

const accessTokens = new Map<string, { value: string; expiresAt: number }>();

async function getAccessToken(profileId: string, fetcher: typeof fetch, config = loadConfig()): Promise<{ token: string; refreshToken: string }> {
  if (!config.GOOGLE_OAUTH_CLIENT_ID || !config.GOOGLE_OAUTH_CLIENT_SECRET || !config.YOUTUBE_TOKEN_ENCRYPTION_KEY) {
    throw new AppError('Chưa cấu hình thông tin Google OAuth và khóa mã hóa YouTube ở máy chủ.', 503, 'YOUTUBE_NOT_CONFIGURED');
  }
  const credential = await findCredential(profileId);
  if (!credential?.youtubeChannelId) throw new AppError('Kênh YouTube chưa được kết nối.', 409, 'YOUTUBE_NOT_CONNECTED');
  if (credential.needsReconnect) throw new AppError('Cần kết nối lại kênh (token hết hạn). Nếu app Google đang ở chế độ Testing, token chỉ sống 7 ngày.', 401, 'YOUTUBE_RECONNECT_REQUIRED');
  let refreshToken: string;
  try {
    refreshToken = decryptRefreshToken(credential.refreshToken, config.YOUTUBE_TOKEN_ENCRYPTION_KEY);
  } catch {
    await patchCredential(profileId, { needsReconnect: true });
    throw new AppError('Cần kết nối lại kênh vì không đọc được token đã mã hóa.', 409, 'YOUTUBE_RECONNECT_REQUIRED');
  }
  const cached = accessTokens.get(profileId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return { token: cached.value, refreshToken };
  try {
    const response = await refreshAccessToken({ refreshToken, clientId: config.GOOGLE_OAUTH_CLIENT_ID, clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET, fetcher });
    accessTokens.set(profileId, { value: response.access_token, expiresAt: Date.now() + response.expires_in * 1000 });
    return { token: response.access_token, refreshToken };
  } catch (error) {
    if (error instanceof YoutubeOAuthError && error.providerCode === 'invalid_grant') {
      await patchCredential(profileId, { needsReconnect: true, lastSyncError: 'Cần kết nối lại kênh (token hết hạn). Nếu app Google đang ở chế độ Testing, token chỉ sống 7 ngày.' });
      throw new AppError('Cần kết nối lại kênh (token hết hạn). Nếu app Google đang ở chế độ Testing, token chỉ sống 7 ngày.', 401, 'YOUTUBE_RECONNECT_REQUIRED');
    }
    throw new AppError('Không thể làm mới quyền truy cập YouTube. Hãy kết nối lại kênh.', 502, 'YOUTUBE_TOKEN_REFRESH_FAILED');
  }
}

async function runYoutubeSync(profileId: string, context: YoutubeSyncJobContext, fetcher: typeof fetch): Promise<{ videos: number; removed: number; quotaUnits: number }> {
  const config = loadConfig();
  const credential = await findCredential(profileId);
  if (!credential?.youtubeChannelId) throw new AppError('Kênh YouTube chưa được kết nối.', 409, 'YOUTUBE_NOT_CONNECTED');
  const { token } = await getAccessToken(profileId, fetcher, config);
  let units = 0;
  const now = new Date();
  const fetchedAt = now.toISOString();
  const channelUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
  channelUrl.searchParams.set('part', 'contentDetails,statistics');
  channelUrl.searchParams.set('id', credential.youtubeChannelId);
  const channel = await apiJson<{ items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } }; statistics?: { subscriberCount?: string } }[] }>(channelUrl, token, fetcher);
  units += 1;
  const uploads = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new AppError('Không tìm thấy danh sách video tải lên của kênh.', 502, 'YOUTUBE_UPLOADS_UNAVAILABLE');
  await context.reportProgress(10);
  const ids = await readUploadVideoIds(uploads, token, fetcher);
  units += Math.max(1, Math.ceil(ids.length / YOUTUBE_LIST_PAGE_SIZE));
  const day = quotaDatePacific(now);
  const projectKey = quotaProjectKey(config.GOOGLE_OAUTH_CLIENT_ID);
  const current = (await getQuota(day, projectKey))?.estimatedUnits ?? 0;
  const projected = current + estimateDataApiUnits(ids.length);
  if (projected > YOUTUBE_DATA_API_SYNC_SOFT_LIMIT) {
    await incrementQuota(day, projectKey, units);
    throw new AppError(`Đồng bộ sẽ vượt ngưỡng ước tính ${YOUTUBE_DATA_API_SYNC_SOFT_LIMIT} đơn vị/ngày. Đã dùng ${current} đơn vị ước tính; hãy thử lại sau khi quota làm mới.`, 429, 'YOUTUBE_QUOTA_LIMIT');
  }
  if (await context.isCancelled()) return { videos: 0, removed: 0, quotaUnits: units };
  const apiVideos = await readVideosByIds(ids, token, fetcher);
  units += Math.ceil(ids.length / YOUTUBE_LIST_PAGE_SIZE);
  await context.reportProgress(65);
  const stats = apiVideos.map((video) => normalizeApiVideo(video, fetchedAt));
  const docs = stats.map((row) => YoutubeVideoDocSchema.parse({ ...row, _id: `${profileId}:${row.videoId}`, channelProfileId: profileId, removed: false }));
  await upsertVideoDocs(profileId, docs, now);
  await context.reportProgress(72);
  const analyticsReport = await syncYoutubeAnalytics(profileId, stats, token, fetcher, now);
  await incrementQuota(day, projectKey, units);
  await patchCredential(profileId, {
    lastSyncAt: now,
    lastSyncError: undefined,
    needsReconnect: false,
    subscriberCount: numeric(channel.items?.[0]?.statistics?.subscriberCount),
    lastSyncReport: analyticsReport,
  });
  await context.appendLog(`Đã đồng bộ ${stats.length} video; quota dữ liệu ước tính ${units} đơn vị.`);
  await context.reportProgress(100);
  return { videos: stats.length, removed: Math.max(0, ids.length - stats.length), quotaUnits: units };
}

export async function syncYoutubeChannel(profileId: string, context: YoutubeSyncJobContext, fetcher: typeof fetch = fetch): Promise<{ videos: number; removed: number; quotaUnits: number }> {
  try {
    return await runYoutubeSync(profileId, context, fetcher);
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'Đồng bộ YouTube không thành công.';
    await patchCredential(profileId, { lastSyncError: message }).catch(() => undefined);
    throw error;
  }
}

export async function getYoutubeAccessToken(profileId: string, fetcher: typeof fetch = fetch, config = loadConfig()): Promise<string> {
  return (await getAccessToken(profileId, fetcher, config)).token;
}

export function clearYoutubeAccessToken(profileId: string): void {
  accessTokens.delete(profileId);
}
