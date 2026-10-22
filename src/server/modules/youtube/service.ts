import type { Config } from '../../config';
import { AppError, NotFound } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { encryptRefreshToken, decryptRefreshToken, randomSelectionId } from './credentials-store';
import { buildAuthorizationUrl, createOauthState, createPkcePair, exchangeAuthorizationCode, OAuthStateStore, revokeGoogleToken, type OAuthTokenResponse } from './oauth';
import { deleteCredential, deleteSyncedData, findCredential, findProfileForYoutubeChannel, getQuota, incrementQuota, upsertCredential } from './repo';
import { YoutubeCredentialDocSchema } from './docs';
import { estimateDataApiUnits, getYoutubeAccessToken, quotaDatePacific, quotaProjectKey, YOUTUBE_DATA_API_SYNC_SOFT_LIMIT } from './sync';
import type { YoutubeChannelOption, YoutubeConnectionSummary } from '../../../contracts/youtube';
import { createChannel, deleteChannel, getChannel } from '../channel';
import { applyYoutubeProfileOption, type YoutubeProfileField } from './profile-refresh';
import { findPendingYoutubeImport, consumePendingYoutubeImport, insertPendingYoutubeImport, patchCredential } from './repo';
import type { EncryptedRefreshToken } from './credentials-store';
import { mapYoutubeChannelToProfile } from './youtube-profile-mapper';

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

export function beginYoutubeOauth(profileId: string, config: Config, host?: 'localhost' | '127.0.0.1', openerOrigin?: string): string {
  assertYoutubeConfigured(config);
  const pkce = createPkcePair();
  const state = createOauthState();
  const redirectUri = `http://${host ?? 'localhost'}:${config.PORT}/api/youtube/oauth/callback`;
  oauthStates.put(state, profileId, pkce.verifier, redirectUri, openerOrigin);
  return buildAuthorizationUrl({
    clientId: config.GOOGLE_OAUTH_CLIENT_ID,
    redirectUri,
    state,
    pkce,
  });
}

export function beginYoutubeImport(config: Config, host?: 'localhost' | '127.0.0.1', openerOrigin?: string): string {
  assertYoutubeConfigured(config);
  const pkce = createPkcePair();
  const state = createOauthState();
  const redirectUri = `http://${host ?? 'localhost'}:${config.PORT}/api/youtube/oauth/callback`;
  oauthStates.putImport(state, pkce.verifier, redirectUri, openerOrigin);
  return buildAuthorizationUrl({ clientId: config.GOOGLE_OAUTH_CLIENT_ID, redirectUri, state, pkce });
}

function takeOauthState(state: string | undefined) {
  const pending = oauthStates.take(state);
  if (!pending) throw new AppError('Phiên kết nối YouTube không hợp lệ hoặc đã hết hạn. Hãy bắt đầu lại.', 400, 'YOUTUBE_OAUTH_STATE_INVALID');
  return pending;
}

export function discardYoutubeOauthState(state: string | undefined): void {
  oauthStates.take(state);
}

export function getYoutubeOauthOpenerOrigin(state: string | undefined): string | undefined {
  return oauthStates.peek(state)?.openerOrigin;
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
  const data = await response.json() as { items?: { id?: string; snippet?: { title?: string; customUrl?: string; description?: string; defaultLanguage?: string; country?: string; thumbnails?: { default?: { url?: string }; high?: { url?: string } } } }[] };
  return (data.items ?? []).flatMap((item) => {
    if (!item.id) return [];
    const thumbnailUrl = item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.default?.url;
    return [{
      youtubeChannelId: item.id,
      title: item.snippet?.title ?? '',
      ...(item.snippet?.customUrl ? { handle: item.snippet.customUrl, customUrl: item.snippet.customUrl } : {}),
      ...(item.snippet?.description !== undefined ? { description: item.snippet.description } : {}),
      ...(item.snippet?.defaultLanguage ? { defaultLanguage: item.snippet.defaultLanguage } : {}),
      ...(item.snippet?.country ? { country: item.snippet.country } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    }];
  });
}

const YOUTUBE_PENDING_IMPORT_TTL_MS = 10 * 60_000;

async function storePendingYoutubeImport(selectionId: string, token: OAuthTokenResponse, channels: YoutubeChannelOption[], key: string, openerOrigin?: string): Promise<void> {
  if (!token.refresh_token) throw new AppError('Google không cấp refresh token. Hãy thu hồi quyền cũ trong tài khoản Google rồi thử lại.', 502, 'YOUTUBE_REFRESH_TOKEN_MISSING');
  await insertPendingYoutubeImport({
    _id: selectionId,
    schemaVersion: 1,
    kind: 'pending-import',
    refreshToken: encryptRefreshToken(token.refresh_token, key),
    channelOptions: channels,
    expiresAt: new Date(Date.now() + YOUTUBE_PENDING_IMPORT_TTL_MS),
    ...(openerOrigin ? { openerOrigin } : {}),
  });
}

export type YoutubeImportChannelOption = YoutubeChannelOption & { boundProfileName?: string };

export async function getYoutubeImportOptions(selectionId: string): Promise<YoutubeImportChannelOption[]> {
  const pending = await findPendingYoutubeImport(selectionId);
  if (!pending) throw new AppError('Phiên thêm kênh không hợp lệ hoặc đã hết hạn. Hãy bắt đầu lại.', 409, 'YOUTUBE_IMPORT_SELECTION_INVALID');
  return Promise.all(pending.channelOptions.map(async (option) => {
    const boundProfileId = await findProfileForYoutubeChannel(option.youtubeChannelId);
    if (!boundProfileId) return option;
    const bound = await getChannel(boundProfileId).catch(() => null);
    return { ...option, boundProfileName: bound?.name ?? 'hồ sơ đã lưu' };
  }));
}

function makeCredential(input: {
  profileId: string;
  token: OAuthTokenResponse;
  channels: YoutubeChannelOption[];
  key: string;
  openerOrigin?: string;
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
    ...(input.openerOrigin ? { openerOrigin: input.openerOrigin } : {}),
  });
}

export type CompleteYoutubeOauthResult =
  | { mode: 'profile'; profileId: string; channelOptions: YoutubeChannelOption[]; selected: boolean; selectionId?: string; openerOrigin?: string }
  | { mode: 'import'; selectionId: string; channelOptions: YoutubeChannelOption[]; openerOrigin?: string };

export async function completeYoutubeOauth(input: { state?: string; code?: string; callbackHost?: string; config: Config; fetcher?: typeof fetch }): Promise<CompleteYoutubeOauthResult> {
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
  if (pending.mode === 'import') {
    const selectionId = randomSelectionId();
    await storePendingYoutubeImport(selectionId, token, channels, input.config.YOUTUBE_TOKEN_ENCRYPTION_KEY, pending.openerOrigin);
    return { mode: 'import', selectionId, channelOptions: channels, ...(pending.openerOrigin ? { openerOrigin: pending.openerOrigin } : {}) };
  }
  if (channels.length > 1) {
    const doc = makeCredential({ profileId: pending.profileId, token, channels, key: input.config.YOUTUBE_TOKEN_ENCRYPTION_KEY, openerOrigin: pending.openerOrigin });
    await upsertCredential(doc);
    return { mode: 'profile', profileId: pending.profileId, channelOptions: channels, selected: false, selectionId: doc.selectionId, ...(pending.openerOrigin ? { openerOrigin: pending.openerOrigin } : {}) };
  }
  await bindCredential(pending.profileId, channels[0]!, token, input.config.YOUTUBE_TOKEN_ENCRYPTION_KEY);
  return { mode: 'profile', profileId: pending.profileId, channelOptions: channels, selected: true, ...(pending.openerOrigin ? { openerOrigin: pending.openerOrigin } : {}) };
}

async function bindCredential(profileId: string, channel: YoutubeChannelOption, token: OAuthTokenResponse | null, key: string, pendingRefreshToken?: EncryptedRefreshToken): Promise<void> {
  const existing = await findCredential(profileId);
  if (!token && !existing && !pendingRefreshToken) throw new NotFound('Không tìm thấy phiên chọn kênh YouTube.');
  const other = await findProfileForYoutubeChannel(channel.youtubeChannelId, profileId);
  if (other) throw new AppError('Kênh YouTube này đã được gắn với một hồ sơ khác.', 409, 'YOUTUBE_CHANNEL_ALREADY_BOUND');
  const encrypted = token?.refresh_token
    ? encryptRefreshToken(token.refresh_token, key)
    : pendingRefreshToken ? encryptRefreshToken(decryptRefreshToken(pendingRefreshToken, key), key) : existing!.refreshToken;
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

type ImportDependencies = {
  createProfile: typeof createChannel;
  deleteProfile: typeof deleteChannel;
  bind: (profileId: string, channel: YoutubeChannelOption, pendingToken: EncryptedRefreshToken, key: string) => Promise<void>;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}

function retryName(name: string, option: YoutubeChannelOption): string {
  const suffix = ` (${mapYoutubeChannelToProfile(option).handle ?? option.youtubeChannelId})`;
  return `${name.slice(0, Math.max(1, 100 - suffix.length)).trimEnd()}${suffix}`;
}

export async function selectYoutubeImportChannels(
  selectionId: string,
  selectedChannelIds: readonly string[],
  config: Config,
  dependencies: ImportDependencies = {
    createProfile: createChannel,
    deleteProfile: deleteChannel,
    bind: (profileId, channel, pendingToken, key) => bindCredential(profileId, channel, null, key, pendingToken),
  },
): Promise<{ results: Array<{ youtubeChannelId: string; ok: boolean; profileId?: string; reason?: string }>; openerOrigin?: string }> {
  assertYoutubeConfigured(config);
  const pending = await consumePendingYoutubeImport(selectionId);
  if (!pending) throw new AppError('Phiên thêm kênh không hợp lệ hoặc đã hết hạn, hoặc đã được dùng.', 409, 'YOUTUBE_IMPORT_SELECTION_INVALID');
  const channelById = new Map(pending.channelOptions.map((channel) => [channel.youtubeChannelId, channel]));
  const results: Array<{ youtubeChannelId: string; ok: boolean; profileId?: string; reason?: string }> = [];

  for (const youtubeChannelId of [...new Set(selectedChannelIds)]) {
    const channel = channelById.get(youtubeChannelId);
    if (!channel) {
      results.push({ youtubeChannelId, ok: false, reason: 'Kênh này không thuộc danh sách Google đã cấp quyền.' });
      continue;
    }
    const existingProfileId = await findProfileForYoutubeChannel(youtubeChannelId);
    if (existingProfileId) {
      const existing = await getChannel(existingProfileId).catch(() => null);
      results.push({ youtubeChannelId, ok: false, reason: `Kênh YouTube này đã được gắn với hồ sơ ${existing?.name ?? 'đã lưu'}.` });
      continue;
    }

    const mapped = mapYoutubeChannelToProfile(channel);
    if (!mapped.name) {
      results.push({ youtubeChannelId, ok: false, reason: 'YouTube chưa cung cấp tên kênh để tạo hồ sơ.' });
      continue;
    }
    let profile;
    try {
      profile = await dependencies.createProfile(mapped);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'CHANNEL_NAME_TAKEN') {
        results.push({ youtubeChannelId, ok: false, reason: errorMessage(error, 'Không thể tạo hồ sơ từ kênh YouTube này.') });
        continue;
      }
      try {
        profile = await dependencies.createProfile({ ...mapped, name: retryName(mapped.name, channel) });
      } catch {
        results.push({ youtubeChannelId, ok: false, reason: 'Tên kênh đã trùng sau khi thử thêm handle để phân biệt.' });
        continue;
      }
    }

    try {
      await dependencies.bind(profile.id, channel, pending.refreshToken, config.YOUTUBE_TOKEN_ENCRYPTION_KEY);
      results.push({ youtubeChannelId, ok: true, profileId: profile.id });
    } catch {
      let cleanupSucceeded = false;
      try {
        await dependencies.deleteProfile(profile.id);
        cleanupSucceeded = true;
      } catch {
        // Keep the binding failure as the primary result and disclose failed compensation.
      }
      results.push({
        youtubeChannelId,
        ok: false,
        reason: cleanupSucceeded
          ? 'Không thể lưu kết nối YouTube; hồ sơ vừa tạo đã được xóa.'
          : 'Không thể lưu kết nối YouTube và không thể tự động xóa hồ sơ vừa tạo.',
      });
    }
  }

  return { results, ...(pending.openerOrigin ? { openerOrigin: pending.openerOrigin } : {}) };
}

export async function refreshYoutubeProfile(
  profileId: string,
  config: Config,
  input: { overwrite?: boolean; fields?: readonly YoutubeProfileField[] } = {},
  fetcher: typeof fetch = oauthFetch.fetcher,
): Promise<{ updated: YoutubeProfileField[]; skipped: YoutubeProfileField[] }> {
  assertYoutubeConfigured(config);
  const credential = await findCredential(profileId);
  if (!credential?.youtubeChannelId) throw new AppError('Kênh YouTube chưa được kết nối.', 409, 'YOUTUBE_NOT_CONNECTED');
  const accessToken = await getYoutubeAccessToken(profileId, fetcher, config);
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('id', credential.youtubeChannelId);
  let response: Response;
  try {
    response = await fetcher(url, { headers: { authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new AppError('Không thể tải thông tin kênh từ YouTube.', 502, 'YOUTUBE_PROFILE_REFRESH_FAILED');
  }
  await incrementQuota(quotaDatePacific(), quotaProjectKey(config.GOOGLE_OAUTH_CLIENT_ID), 1);
  if (!response.ok) throw new AppError('Không thể tải thông tin kênh từ YouTube. Hãy thử lại.', response.status === 401 ? 401 : 502, 'YOUTUBE_PROFILE_REFRESH_FAILED');
  const data = await response.json().catch(() => null) as { items?: Array<{ snippet?: { title?: string; customUrl?: string; description?: string; defaultLanguage?: string; country?: string; thumbnails?: { default?: { url?: string }; high?: { url?: string } } } }> } | null;
  const snippet = data?.items?.[0]?.snippet;
  if (!snippet) throw new AppError('YouTube không trả thông tin cho kênh đã kết nối.', 502, 'YOUTUBE_PROFILE_REFRESH_FAILED');
  const thumbnailUrl = snippet.thumbnails?.high?.url ?? snippet.thumbnails?.default?.url;
  const option: YoutubeChannelOption = {
    youtubeChannelId: credential.youtubeChannelId,
    title: snippet.title ?? '',
    ...(snippet.customUrl ? { handle: snippet.customUrl, customUrl: snippet.customUrl } : {}),
    ...(snippet.description !== undefined ? { description: snippet.description } : {}),
    ...(snippet.defaultLanguage ? { defaultLanguage: snippet.defaultLanguage } : {}),
    ...(snippet.country ? { country: snippet.country } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  };
  const result = await applyYoutubeProfileOption(profileId, option, input);
  if (thumbnailUrl) await patchCredential(profileId, { thumbnailUrl }).catch(() => undefined);
  return result;
}

export async function selectYoutubeChannel(profileId: string, channelId: string, selectionId: string, config: Config): Promise<{ openerOrigin?: string }> {
  assertYoutubeConfigured(config);
  const doc = await findCredential(profileId);
  if (!doc || !doc.selectionId || doc.selectionId !== selectionId) throw new AppError('Phiên chọn kênh không hợp lệ hoặc đã hết hạn.', 409, 'YOUTUBE_SELECTION_INVALID');
  const choice = doc.channelOptions.find((channel) => channel.youtubeChannelId === channelId);
  if (!choice) throw new AppError('Kênh này không thuộc danh sách tài khoản Google đã cấp quyền.', 422, 'YOUTUBE_CHANNEL_CHOICE_INVALID');
  await bindCredential(profileId, choice, null, config.YOUTUBE_TOKEN_ENCRYPTION_KEY);
  return doc.openerOrigin ? { openerOrigin: doc.openerOrigin } : {};
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
