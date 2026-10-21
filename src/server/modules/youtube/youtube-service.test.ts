import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { completeYoutubeOauth, beginYoutubeOauth, disconnectYoutube, getYoutubeConnection, selectYoutubeChannel } from './service';
import { loadConfig } from '../../config';
import type { Document } from 'mongodb';

type TestDoc = Document & { _id: string; [key: string]: unknown };

const encryptionKey = Buffer.alloc(32, 12).toString('base64');
const config = loadConfig({
  GOOGLE_OAUTH_CLIENT_ID: '123456789-test.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret-test',
  YOUTUBE_TOKEN_ENCRYPTION_KEY: encryptionKey,
  PORT: '3000',
});

beforeAll(async () => startTestMongo());
beforeEach(async () => {
  await getCollection<TestDoc>('youtubeCredentials').deleteMany({});
  await getCollection<TestDoc>('youtubeVideos').deleteMany({});
  await getCollection<TestDoc>('youtubeChannelDaily').deleteMany({});
});
afterAll(async () => closeTestMongo());

function fakeGoogle(channels: { id: string; title: string }[]) {
  const requests: { url: string; body: string }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, body: String(init?.body ?? '') });
    if (url.includes('/token')) return new Response(JSON.stringify({ access_token: 'access-token-test', refresh_token: 'refresh-token-test', expires_in: 3600 }), { status: 200 });
    if (url.includes('/youtube/v3/channels')) return new Response(JSON.stringify({ items: channels.map((channel) => ({ id: channel.id, snippet: { title: channel.title, customUrl: '@' + channel.id, thumbnails: { high: { url: 'https://example.com/channel.png' } } } })) }), { status: 200 });
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
    expect(second.result.selected).toBe(false);
    await expect(selectYoutubeChannel('profile-b', 'UC-a', second.result.selectionId!, config)).rejects.toMatchObject({ code: 'YOUTUBE_CHANNEL_ALREADY_BOUND', status: 409 });
  });

  it('automatically binds a single owned channel and revokes/deletes credentials on disconnect', async () => {
    const { result } = await finishLink('profile-single', [{ id: 'UC-single', title: 'Kênh duy nhất' }]);
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
});
