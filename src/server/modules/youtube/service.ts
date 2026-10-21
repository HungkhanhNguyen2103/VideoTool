import type { Config } from '../../config';
import { AppError, NotFound } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { encryptRefreshToken, decryptRefreshToken, randomSelectionId } from './credentials-store';
import { buildAuthorizationUrl, createOauthState, createPkcePair, exchangeAuthorizationCode, OAuthStateStore, revokeGoogleToken, type OAuthTokenResponse } from './oauth';
import { deleteCredential, deleteSyncedData, findCredential, findProfileForYoutubeChannel, getQuota, incrementQuota, upsertCredential } from './repo';
import { YoutubeCredentialDocSchema } from './docs';
import { estimateDataApiUnits, quotaDatePacific, quotaProjectKey, YOUTUBE_DATA_API_SYNC_SOFT_LIMIT } from './sync';
import type { YoutubeChannelOption, YoutubeConnectionSummary } from '../../../contracts/youtube';

export const YOUTUBE_ENCRYPTION_KEY_COMMAND = "node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64'))\"";
export const YOUTUBE_SETUP_MESSAGE = `Chưa cấu hình Google OAuth hoặc khóa mã hóa YouTube. Điền GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET và YOUTUBE_TOKEN_ENCRYPTION_KEY trong .env. Tạo khóa bằng lệnh: ${YOUTUBE_ENCRYPTION_KEY_COMMAND}`;

const oauthStates = new OAuthStateStore();
const oauthFetch: { fetcher: typeof fetch } = { fetcher: fetch };

export function configureYoutubeFetch(fetcher: typeof fetch): void {
  oauthFetch.fetcher = fetcher;
}

export function youtubeIsConfigured(config: Config): boolean {
  return Boolean(config.GOOGLE_OAUTH_CLIENT_ID && config.GOOGLE_OAUTH_CLIENT_SECRET && config.YOUTUBE_TOKEN_ENCRYPTION_KEY);
}

export function assertYoutubeConfigured(config: Config): void {
  if (!youtubeIsConfigured(config)) throw new AppError(YOUTUBE_SETUP_MESSAGE, 503, 'YOUTUBE_NOT_CONFIGURED');
  try {
    // Validate key format before a user starts an OAuth flow.
    encryptRefreshToken('validation-only', config.YOUTUBE_TOKEN_ENCRYPTION_KEY);
  } catch {
    throw new AppError(`YOUTUBE_TOKEN_ENCRYPTION_KEY không hợp lệ. Tạo lại bằng lệnh: ${YOUTUBE_ENCRYPTION_KEY_COMMAND}`, 503, 'YOUTUBE_ENCRYPTION_KEY_INVALID');
  }
}

export function beginYoutubeOauth(profileId: string, config: Config, host?: 'localhost' | '127.0.0.1'): string {
  assertYoutubeConfigured(config);
  const pkce = createPkcePair();
  const state = createOauthState();
  const redirectUri = `http://${host ?? 'localhost'}:${config.PORT}/api/youtube/oauth/callback`;
  oauthStates.put(state, profileId, pkce.verifier, redirectUri);
  return buildAuthorizationUrl({
    clientId: config.GOOGLE_OAUTH_CLIENT_ID,
    redirectUri,
    state,
    pkce,
  });
}

function takeOauthState(state: string | undefined) {
  const pending = oauthStates.take(state);
  if (!pending) throw new AppError('Phiên kết nối YouTube không hợp lệ hoặc đã hết hạn. Hãy bắt đầu lại.', 400, 'YOUTUBE_OAUTH_STATE_INVALID');
  return pending;
}

export function discardYoutubeOauthState(state: string | undefined): void {
  oauthStates.take(state);
}

async function listOwnedChannels(accessToken: string, fetcher: typeof fetch): Promise<YoutubeChannelOption[]> {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part', 'snippet,contentDetails');
  url.searchParams.set('mine', 'true');
  url.searchParams.set('maxResults', '50');
  let response: Response;
  try {
    response = await fetcher(url, { headers: { authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new AppError('Không thể tải danh sách kênh từ Google.', 502, 'YOUTUBE_CHANNEL_LIST_FAILED');
  }
  if (!response.ok) throw new AppError('Không thể tải danh sách kênh từ Google. Hãy kiểm tra quyền YouTube rồi thử lại.', 502, 'YOUTUBE_CHANNEL_LIST_FAILED');
  const data = await response.json() as { items?: { id?: string; snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string }; high?: { url?: string } } } }[] };
  return (data.items ?? []).flatMap((item) => {
    if (!item.id) return [];
    const thumbnailUrl = item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.default?.url;
    return [{
      youtubeChannelId: item.id,
      title: item.snippet?.title ?? '',
      ...(item.snippet?.customUrl ? { handle: item.snippet.customUrl } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    }];
  });
}

function makeCredential(input: {
  profileId: string;
  token: OAuthTokenResponse;
  channels: YoutubeChannelOption[];
  key: string;
}): ReturnType<typeof YoutubeCredentialDocSchema.parse> {
  if (!input.token.refresh_token) throw new AppError('Google không cấp refresh token. Hãy thu hồi quyền cũ trong tài khoản Google rồi thử kết nối lại.', 502, 'YOUTUBE_REFRESH_TOKEN_MISSING');
  return YoutubeCredentialDocSchema.parse({
    _id: input.profileId,
    schemaVersion: 1,
    refreshToken: encryptRefreshToken(input.token.refresh_token, input.key),
    youtubeChannelId: null,
    title: null,
    connectedAt: new Date(),
    needsReconnect: false,
    channelOptions: input.channels,
    selectionId: randomSelectionId(),
  });
}

export async function completeYoutubeOauth(input: { state?: string; code?: string; callbackHost?: string; config: Config; fetcher?: typeof fetch }): Promise<{ profileId: string; channelOptions: YoutubeChannelOption[]; selected: boolean; selectionId?: string }> {
  assertYoutubeConfigured(input.config);
  const pending = takeOauthState(input.state);
  const expectedHost = new URL(pending.redirectUri ?? `http://localhost:${input.config.PORT}/api/youtube/oauth/callback`).hostname;
  if (input.callbackHost && input.callbackHost !== expectedHost) throw new AppError('Địa chỉ callback không khớp với phiên OAuth.', 400, 'YOUTUBE_OAUTH_STATE_INVALID');
  if (!input.code) throw new AppError('Google không trả mã ủy quyền.', 400, 'YOUTUBE_OAUTH_CODE_MISSING');
  const fetcher = input.fetcher ?? oauthFetch.fetcher;
  const token = await exchangeAuthorizationCode({
    code: input.code,
    verifier: pending.verifier,
    clientId: input.config.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: input.config.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: pending.redirectUri ?? `http://localhost:${input.config.PORT}/api/youtube/oauth/callback`,
    fetcher,
  });
  const channels = await listOwnedChannels(token.access_token, fetcher);
  if (channels.length === 0) throw new AppError('Tài khoản Google này chưa có kênh YouTube mà API có thể đọc.', 403, 'YOUTUBE_CHANNEL_NOT_FOUND');
  await incrementQuota(quotaDatePacific(), quotaProjectKey(input.config.GOOGLE_OAUTH_CLIENT_ID), 1);
  if (channels.length > 1) {
    const doc = makeCredential({ profileId: pending.profileId, token, channels, key: input.config.YOUTUBE_TOKEN_ENCRYPTION_KEY });
    await upsertCredential(doc);
    return { profileId: pending.profileId, channelOptions: channels, selected: false, selectionId: doc.selectionId };
  }
  await bindCredential(pending.profileId, channels[0]!, token, input.config.YOUTUBE_TOKEN_ENCRYPTION_KEY);
  return { profileId: pending.profileId, channelOptions: channels, selected: true };
}

async function bindCredential(profileId: string, channel: YoutubeChannelOption, token: OAuthTokenResponse | null, key: string): Promise<void> {
  const existing = await findCredential(profileId);
  if (!token && !existing) throw new NotFound('Không tìm thấy phiên chọn kênh YouTube.');
  const other = await findProfileForYoutubeChannel(channel.youtubeChannelId, profileId);
  if (other) throw new AppError('Kênh YouTube này đã được gắn với một hồ sơ khác.', 409, 'YOUTUBE_CHANNEL_ALREADY_BOUND');
  const encrypted = token?.refresh_token
    ? encryptRefreshToken(token.refresh_token, key)
    : existing!.refreshToken;
  const next = YoutubeCredentialDocSchema.parse({
    _id: profileId,
    schemaVersion: 1,
    refreshToken: encrypted,
    youtubeChannelId: channel.youtubeChannelId,
    title: channel.title,
    ...(channel.handle ? { handle: channel.handle } : {}),
    ...(channel.thumbnailUrl ? { thumbnailUrl: channel.thumbnailUrl } : {}),
    connectedAt: existing?.connectedAt ?? new Date(),
    needsReconnect: false,
    channelOptions: [],
  });
  try {
    await upsertCredential(next);
  } catch {
    throw new AppError('Kênh YouTube này đã được gắn với một hồ sơ khác.', 409, 'YOUTUBE_CHANNEL_ALREADY_BOUND');
  }
}

export async function selectYoutubeChannel(profileId: string, channelId: string, selectionId: string, config: Config): Promise<void> {
  assertYoutubeConfigured(config);
  const doc = await findCredential(profileId);
  if (!doc || !doc.selectionId || doc.selectionId !== selectionId) throw new AppError('Phiên chọn kênh không hợp lệ hoặc đã hết hạn.', 409, 'YOUTUBE_SELECTION_INVALID');
  const choice = doc.channelOptions.find((channel) => channel.youtubeChannelId === channelId);
  if (!choice) throw new AppError('Kênh này không thuộc danh sách tài khoản Google đã cấp quyền.', 422, 'YOUTUBE_CHANNEL_CHOICE_INVALID');
  await bindCredential(profileId, choice, null, config.YOUTUBE_TOKEN_ENCRYPTION_KEY);
}

export async function getYoutubeConnection(profileId: string, config: Config): Promise<YoutubeConnectionSummary> {
  const doc = await findCredential(profileId);
  const base = {
    connected: Boolean(doc?.youtubeChannelId && !doc.needsReconnect),
    youtubeChannelId: doc?.youtubeChannelId ?? null,
    title: doc?.title ?? null,
    connectedAt: doc?.connectedAt.toISOString() ?? null,
    needsReconnect: doc?.needsReconnect ?? false,
    setupConfigured: youtubeIsConfigured(config),
  };
  return {
    ...base,
    ...(doc?.handle ? { handle: doc.handle } : {}),
    ...(doc?.thumbnailUrl ? { thumbnailUrl: doc.thumbnailUrl } : {}),
    ...(doc?.lastSyncAt ? { lastSyncAt: doc.lastSyncAt.toISOString() } : {}),
    ...(doc?.lastSyncError ? { lastSyncError: doc.lastSyncError } : {}),
    ...(doc?.channelOptions.length ? { channelOptions: doc.channelOptions } : {}),
  };
}

export async function disconnectYoutube(profileId: string, config: Config, deleteData: boolean, fetcher?: typeof fetch): Promise<void> {
  const doc = await findCredential(profileId);
  if (!doc) return;
  try {
    const refreshToken = decryptRefreshToken(doc.refreshToken, config.YOUTUBE_TOKEN_ENCRYPTION_KEY);
    const revoked = await revokeGoogleToken(refreshToken, fetcher ?? oauthFetch.fetcher);
    if (!revoked) logger.warn('Google token revocation failed; local YouTube credentials were removed.');
  } catch {
    // Local deletion succeeds even when the user changed the encryption key or Google is unavailable.
    logger.warn('Google token revocation could not be completed; local YouTube credentials were removed.');
  }
  await deleteCredential(profileId);
  if (deleteData) await deleteSyncedData(profileId);
}

export async function assertYoutubeQuotaAllowsSync(profileId: string, config: Config, knownVideoCount: number): Promise<void> {
  const date = quotaDatePacific();
  const projectKey = quotaProjectKey(config.GOOGLE_OAUTH_CLIENT_ID);
  const used = (await getQuota(date, projectKey))?.estimatedUnits ?? 0;
  const estimate = estimateDataApiUnits(knownVideoCount);
  if (used + estimate > YOUTUBE_DATA_API_SYNC_SOFT_LIMIT) {
    throw new AppError(`Đồng bộ bị tạm dừng: quota YouTube dùng ${used} đơn vị ước tính hôm nay; dự kiến thêm ${estimate}, vượt ngưỡng ${YOUTUBE_DATA_API_SYNC_SOFT_LIMIT}.`, 429, 'YOUTUBE_QUOTA_LIMIT');
  }
}
