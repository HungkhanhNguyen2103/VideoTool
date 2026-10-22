import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { completeYoutubeOauth, beginYoutubeImport, beginYoutubeOauth, disconnectYoutube, getYoutubeConnection, getYoutubeImportOptions, refreshYoutubeProfile, selectYoutubeChannel, selectYoutubeImportChannels } from './service';
import { loadConfig } from '../../config';
import type { Document } from 'mongodb';
import { createChannel, deleteChannel, getChannel } from '../channel';
import { quotaDatePacific, quotaProjectKey, syncYoutubeChannel } from './sync';
import { ensureYoutubeIndexes } from './indexes';

type TestDoc = Document & { _id: string; [key: string]: unknown };

const encryptionKey = Buffer.alloc(32, 12).toString('base64');
const config = loadConfig({
  GOOGLE_OAUTH_CLIENT_ID: '123456789-test.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret-test',
  YOUTUBE_TOKEN_ENCRYPTION_KEY: encryptionKey,
  PORT: '3000',
});

beforeAll(async () => { await startTestMongo(); await ensureYoutubeIndexes(); });
beforeEach(async () => {
  await getCollection<TestDoc>('youtubeCredentials').deleteMany({});
  await getCollection<TestDoc>('youtubeVideos').deleteMany({});
  await getCollection<TestDoc>('youtubeChannelDaily').deleteMany({});
  await getCollection<TestDoc>('channels').deleteMany({});
});
afterAll(async () => closeTestMongo());

function fakeGoogle(channels: { id: string; title: string }[]) {
  const requests: { url: string; body: string }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, body: String(init?.body ?? '') });
    if (url.includes('/token')) return new Response(JSON.stringify({ access_token: 'access-token-test', refresh_token: 'refresh-token-test', expires_in: 3600 }), { status: 200 });
    if (url.includes('/youtube/v3/channels')) return new Response(JSON.stringify({ items: channels.map((channel) => ({ id: channel.id, snippet: { title: channel.title, customUrl: '@' + channel.id, description: `Mô tả ${channel.title}`, defaultLanguage: 'vi-VN', country: 'VN', thumbnails: { high: { url: 'https://example.com/channel.png' } } } })) }), { status: 200 });
    if (url.includes('/revoke')) return new Response('', { status: 200 });
    throw new Error(`Unexpected URL: ${url}`);
  };
  return { fetcher, requests };
}

async function finishLink(profileId: string, channels: { id: string; title: string }[]) {
  const { fetcher, requests } = fakeGoogle(channels);
  const authorizationUrl = new URL(beginYoutubeOauth(profileId, config));
  const result = await completeYoutubeOauth({ state: authorizationUrl.searchParams.get('state') ?? undefined, code: 'one-time-code', config, fetcher });
  return { result, requests };
}

describe('YouTube connection persistence', () => {
  it('stores only encrypted refresh tokens, offers a choice, and prevents duplicate channel bindings', async () => {
    const { result, requests } = await finishLink('profile-a', [{ id: 'UC-a', title: 'Kênh A' }, { id: 'UC-b', title: 'Kênh B' }]);
    expect(result.mode).toBe('profile');
    if (result.mode !== 'profile') throw new Error('Expected a profile OAuth result.');
    expect(result.selected).toBe(false);
    expect(result.channelOptions).toHaveLength(2);
    expect(requests[0]?.body).toContain('code_verifier=');

    const stored = await getCollection<TestDoc>('youtubeCredentials').findOne({ _id: 'profile-a' });
    expect(JSON.stringify(stored)).not.toContain('refresh-token-test');
    expect(JSON.stringify(stored)).not.toContain('access-token-test');
    expect(stored?.refreshToken).toMatchObject({ algorithm: 'aes-256-gcm' });

    await selectYoutubeChannel('profile-a', 'UC-a', result.selectionId!, config);
    const summary = await getYoutubeConnection('profile-a', config);
    expect(summary).toMatchObject({ connected: true, youtubeChannelId: 'UC-a', title: 'Kênh A' });
    expect(JSON.stringify(summary)).not.toContain('token-test');

    const second = await finishLink('profile-b', [{ id: 'UC-a', title: 'Kênh A' }, { id: 'UC-b', title: 'Kênh B' }]);
    if (second.result.mode !== 'profile') throw new Error('Expected a profile OAuth result.');
    expect(second.result.selected).toBe(false);
    await expect(selectYoutubeChannel('profile-b', 'UC-a', second.result.selectionId!, config)).rejects.toMatchObject({ code: 'YOUTUBE_CHANNEL_ALREADY_BOUND', status: 409 });
  });

  it('automatically binds a single owned channel and revokes/deletes credentials on disconnect', async () => {
    const { result } = await finishLink('profile-single', [{ id: 'UC-single', title: 'Kênh duy nhất' }]);
    expect(result.mode).toBe('profile');
    if (result.mode !== 'profile') throw new Error('Expected a profile OAuth result.');
    expect(result.selected).toBe(true);
    expect((await getYoutubeConnection('profile-single', config)).youtubeChannelId).toBe('UC-single');

    await getCollection<TestDoc>('youtubeVideos').insertOne({ _id: 'video', channelProfileId: 'profile-single', videoId: 'video', title: '', publishedAt: null, durationSec: 1, isShort: true, privacy: 'public', viewCount: 1, likeCount: null, commentCount: null, fetchedAt: new Date().toISOString(), analytics: {}, removed: false });
    const fetcher: typeof fetch = async (_input, init) => {
      expect(String(init?.body)).toContain('refresh-token-test');
      return new Response('', { status: 200 });
    };
    await disconnectYoutube('profile-single', config, true, fetcher);
    expect(await getCollection<TestDoc>('youtubeCredentials').countDocuments({ _id: 'profile-single' })).toBe(0);
    expect(await getCollection<TestDoc>('youtubeVideos').countDocuments({ channelProfileId: 'profile-single' })).toBe(0);
  });

  it('imports selected profiles from an encrypted, single-use pending record', async () => {
    const { fetcher } = fakeGoogle([{ id: 'UC-import-1', title: 'Kênh nhập 1' }, { id: 'UC-import-2', title: 'Kênh nhập 2' }]);
    const authorizationUrl = new URL(beginYoutubeImport(config, '127.0.0.1'));
    expect(authorizationUrl.searchParams.get('scope')?.split(' ')).toEqual([
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    ]);
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3000/api/youtube/oauth/callback');
    const callback = await completeYoutubeOauth({ state: authorizationUrl.searchParams.get('state') ?? undefined, code: 'one-time-code', config, fetcher });
    expect(callback.mode).toBe('import');
    if (callback.mode !== 'import') throw new Error('Expected an import OAuth result.');

    const pending = await getCollection<TestDoc>('youtubeCredentials').findOne({ _id: callback.selectionId });
    expect(pending).toMatchObject({ kind: 'pending-import', refreshToken: { algorithm: 'aes-256-gcm' } });
    expect(JSON.stringify(pending)).not.toContain('refresh-token-test');
    expect(callback.channelOptions[0]).toMatchObject({ description: 'Mô tả Kênh nhập 1', defaultLanguage: 'vi-VN', country: 'VN' });

    const selected = await selectYoutubeImportChannels(callback.selectionId, ['UC-import-1', 'UC-import-2'], config);
    expect(selected.results).toHaveLength(2);
    expect(selected.results.every((result) => result.ok)).toBe(true);
    const first = await getChannel(selected.results[0]!.profileId!);
    const second = await getChannel(selected.results[1]!.profileId!);
    expect(first).toMatchObject({ name: 'Kênh nhập 1', handle: '@UC-import-1', description: 'Mô tả Kênh nhập 1', language: 'vi' });
    expect(second).toMatchObject({ name: 'Kênh nhập 2', handle: '@UC-import-2', description: 'Mô tả Kênh nhập 2', language: 'vi' });
    expect((await getYoutubeConnection(first.id, config)).connected).toBe(true);
    const firstCredential = await getCollection<TestDoc>('youtubeCredentials').findOne({ _id: first.id });
    const secondCredential = await getCollection<TestDoc>('youtubeCredentials').findOne({ _id: second.id });
    expect(JSON.stringify([firstCredential, secondCredential, selected])).not.toContain('refresh-token-test');
    expect((firstCredential?.refreshToken as { iv: string }).iv).not.toBe((secondCredential?.refreshToken as { iv: string }).iv);
    expect(await getCollection<TestDoc>('youtubeCredentials').findOne({ _id: callback.selectionId })).toBeNull();
    await expect(selectYoutubeImportChannels(callback.selectionId, ['UC-import-1'], config)).rejects.toMatchObject({ code: 'YOUTUBE_IMPORT_SELECTION_INVALID' });
  });

  it('rejects an expired pending import and installs a TTL index', async () => {
    const { fetcher } = fakeGoogle([{ id: 'UC-expired', title: 'Kênh hết hạn' }]);
    const authorizationUrl = new URL(beginYoutubeImport(config));
    const callback = await completeYoutubeOauth({ state: authorizationUrl.searchParams.get('state')!, code: 'one-time-code', config, fetcher });
    if (callback.mode !== 'import') throw new Error('Expected an import OAuth result.');
    await getCollection<TestDoc>('youtubeCredentials').updateOne({ _id: callback.selectionId }, { $set: { expiresAt: new Date(Date.now() - 1_000) } });
    await expect(selectYoutubeImportChannels(callback.selectionId, ['UC-expired'], config)).rejects.toMatchObject({ code: 'YOUTUBE_IMPORT_SELECTION_INVALID' });
    const indexes = await getCollection<TestDoc>('youtubeCredentials').listIndexes().toArray();
    expect(indexes).toContainEqual(expect.objectContaining({ name: 'youtube_pending_import_ttl', expireAfterSeconds: 0 }));
    expect(await getCollection<TestDoc>('channels').countDocuments({})).toBe(0);
  });

  it('skips already-bound channels with the owning profile name', async () => {
    const boundProfile = await createChannel({ name: 'Kênh đã gắn' });
    const bound = await finishLink(boundProfile.id, [{ id: 'UC-bound', title: 'Kênh đã gắn' }]);
    expect(bound.result.mode).toBe('profile');
    const { fetcher } = fakeGoogle([{ id: 'UC-bound', title: 'Kênh đã gắn' }, { id: 'UC-free', title: 'Kênh mới' }]);
    const authorizationUrl = new URL(beginYoutubeImport(config));
    const callback = await completeYoutubeOauth({ state: authorizationUrl.searchParams.get('state')!, code: 'one-time-code', config, fetcher });
    if (callback.mode !== 'import') throw new Error('Expected an import OAuth result.');
    const preview = await getYoutubeImportOptions(callback.selectionId);
    expect(preview.find((option) => option.youtubeChannelId === 'UC-bound')).toMatchObject({ boundProfileName: 'Kênh đã gắn' });
    const result = await selectYoutubeImportChannels(callback.selectionId, ['UC-bound', 'UC-free'], config);
    expect(result.results[0]).toMatchObject({ youtubeChannelId: 'UC-bound', ok: false, reason: expect.stringContaining('Kênh đã gắn') });
    expect(result.results[1]?.ok).toBe(true);
  });

  it('retries a duplicate profile name once with the YouTube handle suffix', async () => {
    await createChannel({ name: 'Kênh trùng' });
    const { fetcher } = fakeGoogle([{ id: 'UC-duplicate', title: 'Kênh trùng' }]);
    const authorizationUrl = new URL(beginYoutubeImport(config));
    const callback = await completeYoutubeOauth({ state: authorizationUrl.searchParams.get('state')!, code: 'one-time-code', config, fetcher });
    if (callback.mode !== 'import') throw new Error('Expected an import OAuth result.');
    const result = await selectYoutubeImportChannels(callback.selectionId, ['UC-duplicate'], config);
    expect(result.results[0]?.ok).toBe(true);
    expect(await getChannel(result.results[0]!.profileId!)).toMatchObject({ name: 'Kênh trùng (@UC-duplicate)' });
  });

  it('compensates by deleting a created profile when binding the credential fails', async () => {
    const { fetcher } = fakeGoogle([{ id: 'UC-bind-fail', title: 'Kênh lỗi kết nối' }]);
    const authorizationUrl = new URL(beginYoutubeImport(config));
    const callback = await completeYoutubeOauth({ state: authorizationUrl.searchParams.get('state')!, code: 'one-time-code', config, fetcher });
    if (callback.mode !== 'import') throw new Error('Expected an import OAuth result.');
    const result = await selectYoutubeImportChannels(callback.selectionId, ['UC-bind-fail'], config, {
      createProfile: createChannel,
      deleteProfile: deleteChannel,
      bind: async () => { throw new Error('synthetic credential write failure'); },
    });
    expect(result.results[0]).toMatchObject({ ok: false, reason: 'Không thể lưu kết nối YouTube; hồ sơ vừa tạo đã được xóa.' });
    expect(await getCollection<TestDoc>('channels').countDocuments({ name: 'Kênh lỗi kết nối' })).toBe(0);
  });

  it('refreshes empty profile fields from one snippet request and keeps the avatar only on the connection', async () => {
    const profile = await createChannel({ name: 'Tên tự nhập', description: '', language: 'vi', tagline: 'Tagline giữ nguyên', defaultHashtags: ['#Giu'] });
    const oauth = await finishLink(profile.id, [{ id: 'UC-refresh', title: 'Kênh Google cũ' }]);
    if (oauth.result.mode !== 'profile') throw new Error('Expected a profile OAuth result.');
    const quotaFilter = { date: quotaDatePacific(), projectKey: quotaProjectKey(config.GOOGLE_OAUTH_CLIENT_ID) };
    const quotaBefore = (await getCollection<TestDoc>('youtubeQuota').findOne(quotaFilter))?.estimatedUnits as number ?? 0;
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/token')) return new Response(JSON.stringify({ access_token: 'refresh-access-token', expires_in: 3600 }), { status: 200 });
      if (url.includes('/youtube/v3/channels')) return new Response(JSON.stringify({ items: [{ snippet: {
        title: 'Tên YouTube mới', customUrl: '@kenhrefresh', description: 'Mô tả YouTube', defaultLanguage: 'en-US',
        thumbnails: { high: { url: 'https://example.com/refreshed.png' } },
      } }] }), { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await refreshYoutubeProfile(profile.id, config, { overwrite: false }, fetcher);
    expect(result).toEqual({ updated: ['handle', 'description', 'language'], skipped: ['name'] });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toContain('part=snippet');
    expect(requests[1]).toContain('id=UC-refresh');
    expect(await getChannel(profile.id)).toMatchObject({ name: 'Tên tự nhập', handle: '@kenhrefresh', description: 'Mô tả YouTube', language: 'en', tagline: 'Tagline giữ nguyên', defaultHashtags: ['#Giu'] });
    expect((await getYoutubeConnection(profile.id, config)).thumbnailUrl).toBe('https://example.com/refreshed.png');
    const quotaAfter = (await getCollection<TestDoc>('youtubeQuota').findOne(quotaFilter))?.estimatedUnits as number;
    expect(quotaAfter - quotaBefore).toBe(1);
    expect(JSON.stringify(result)).not.toContain('refresh-access-token');
  });

  it('keeps a successful sync successful when the automatic profile fill cannot update a deleted profile', async () => {
    const profile = await createChannel({ name: 'Profile removed before sync' });
    const oauth = await finishLink(profile.id, [{ id: 'UC-autofill-fail', title: 'Kênh YouTube' }]);
    if (oauth.result.mode !== 'profile') throw new Error('Expected a profile OAuth result.');
    await deleteChannel(profile.id);
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/token')) return new Response(JSON.stringify({ access_token: 'sync-access-token', expires_in: 3600 }), { status: 200 });
      if (url.includes('/youtube/v3/channels')) return new Response(JSON.stringify({ items: [{
        snippet: { title: 'Kênh YouTube', description: 'Mô tả mới' },
        contentDetails: { relatedPlaylists: { uploads: 'uploads-list' } },
        statistics: { subscriberCount: '20' },
      }] }), { status: 200 });
      if (url.includes('/playlistItems')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.includes('youtubeanalytics.googleapis.com')) return new Response(JSON.stringify({ error: 'unavailable' }), { status: 400 });
      throw new Error(`Unexpected URL: ${url}`);
    };
    const appendLog = vi.fn(async () => undefined);
    const result = await syncYoutubeChannel(profile.id, { reportProgress: async () => undefined, isCancelled: async () => false, appendLog }, fetcher, config);
    expect(result).toMatchObject({ videos: 0, quotaUnits: 2 });
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('Đã đồng bộ 0 video'));
  });

  it('fills empty profile fields from the snippet already fetched during sync and logs the changed fields', async () => {
    const profile = await createChannel({ name: 'Tên tự nhập', description: '', language: 'vi' });
    const oauth = await finishLink(profile.id, [{ id: 'UC-autofill', title: 'Kênh YouTube' }]);
    if (oauth.result.mode !== 'profile') throw new Error('Expected a profile OAuth result.');
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/token')) return new Response(JSON.stringify({ access_token: 'sync-access-token', expires_in: 3600 }), { status: 200 });
      if (url.includes('/youtube/v3/channels')) return new Response(JSON.stringify({ items: [{
        snippet: { title: 'Tên YouTube mới', customUrl: '@kenhvideo', description: 'Mô tả từ YouTube', defaultLanguage: 'en-US' },
        contentDetails: { relatedPlaylists: { uploads: 'uploads-list' } },
        statistics: { subscriberCount: '20' },
      }] }), { status: 200 });
      if (url.includes('/playlistItems')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.includes('youtubeanalytics.googleapis.com')) return new Response(JSON.stringify({ error: 'unavailable' }), { status: 400 });
      throw new Error(`Unexpected URL: ${url}`);
    };
    const appendLog = vi.fn(async () => undefined);
    const result = await syncYoutubeChannel(profile.id, { reportProgress: async () => undefined, isCancelled: async () => false, appendLog }, fetcher, config);
    expect(result.quotaUnits).toBe(2);
    expect(await getChannel(profile.id)).toMatchObject({ name: 'Tên tự nhập', handle: '@kenhvideo', description: 'Mô tả từ YouTube', language: 'en' });
    expect(appendLog).toHaveBeenCalledWith('Đã cập nhật thông tin hồ sơ từ YouTube: handle, description, language.');
  });
});
