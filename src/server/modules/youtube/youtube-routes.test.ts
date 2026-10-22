import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Document } from 'mongodb';
import { getCollection } from '../../db/client';
import { errorHandler } from '../../error-handler';
import { loadConfig } from '../../config';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createChannel } from '../channel';
import { encryptRefreshToken } from './credentials-store';
import { ensureYoutubeIndexes } from './indexes';
import { createYoutubeRouter } from './routes';

type TestDoc = Document & { _id: string; [key: string]: unknown };
const key = Buffer.alloc(32, 26).toString('base64');
const config = loadConfig({
  GOOGLE_OAUTH_CLIENT_ID: '123456789-test.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret-test',
  YOUTUBE_TOKEN_ENCRYPTION_KEY: key,
  PORT: '3000',
});

let server: Server | null = null;

beforeAll(async () => { await startTestMongo(); await ensureYoutubeIndexes(); });
beforeEach(async () => {
  await getCollection<TestDoc>('youtubeCredentials').deleteMany({});
  await getCollection<TestDoc>('youtubeQuota').deleteMany({});
  await getCollection<TestDoc>('channels').deleteMany({});
});
afterEach(async () => {
  const current = server;
  server = null;
  if (current) await new Promise<void>((resolve) => current.close(() => resolve()));
});
afterAll(async () => closeTestMongo());

async function startApi(fetcher: typeof fetch): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use('/api/youtube', createYoutubeRouter({
    config,
    fetcher,
    enqueueJob: async () => ({ id: 'job-1' } as never),
    getActiveJob: async () => null,
  }));
  app.use(errorHandler);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('YouTube import routes', () => {
  it('renders escaped, bound-aware multi-select options and reports the import to the opener', async () => {
    const owner = await createChannel({ name: '<Owner & Co>' });
    await getCollection<TestDoc>('youtubeCredentials').insertOne({
      _id: owner.id, schemaVersion: 1, refreshToken: encryptRefreshToken('bound-refresh-token', key), youtubeChannelId: 'UC-bound',
      title: 'Bound channel', connectedAt: new Date(), needsReconnect: false, channelOptions: [],
    });
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/token')) return new Response(JSON.stringify({ access_token: 'access-token-private', refresh_token: 'import-refresh-token-private', expires_in: 3600 }), { status: 200 });
      if (url.includes('/youtube/v3/channels')) return new Response(JSON.stringify({ items: [
        { id: 'UC-bound', snippet: { title: 'Bound channel', customUrl: '@boundchannel', description: 'Bound description' } },
        { id: 'UC-free', snippet: { title: '<script>unsafe()</script>', customUrl: '@freechannel', description: 'Free description', defaultLanguage: 'en-US', country: 'US', thumbnails: { high: { url: 'https://example.com/avatar.png' } } } },
      ] }), { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    };
    const base = await startApi(fetcher);
    const setup = await fetch(`${base}/api/youtube/setup`);
    expect(await setup.json()).toMatchObject({ configured: true });

    const start = await fetch(`${base}/api/youtube/import/start`, { method: 'POST', headers: { origin: 'http://localhost:5173' } });
    const { authorizationUrl } = await start.json() as { authorizationUrl: string };
    const auth = new URL(authorizationUrl);
    expect(auth.searchParams.get('scope')?.split(' ')).toEqual([
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    ]);
    expect(auth.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3000/api/youtube/oauth/callback');

    const callback = await fetch(`${base}/api/youtube/oauth/callback?state=${encodeURIComponent(auth.searchParams.get('state')!)}&code=one-time-code`);
    const picker = await callback.text();
    expect(callback.status).toBe(200);
    expect(picker).toContain('Đã gắn với hồ sơ &lt;Owner &amp; Co&gt;');
    expect(picker).toMatch(/name="youtubeChannelIds" value="UC-bound" disabled/);
    expect(picker).toMatch(/name="youtubeChannelIds" value="UC-free" checked/);
    expect(picker).not.toContain('<script>unsafe()');
    expect(picker).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(picker).toContain('Google quyết định kênh nào được liệt kê');
    expect(picker).not.toContain('import-refresh-token-private');
    expect(calls.every((url) => !url.includes('refresh-token-private'))).toBe(true);

    const selectionId = picker.match(/name="selectionId" value="([^"]+)"/)?.[1];
    expect(selectionId).toBeTruthy();
    const form = new URLSearchParams();
    form.append('selectionId', selectionId!);
    form.append('youtubeChannelIds', 'UC-bound');
    form.append('youtubeChannelIds', 'UC-free');
    const selected = await fetch(`${base}/api/youtube/import/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const resultPage = await selected.text();
    expect(selected.status).toBe(200);
    expect(resultPage).toContain('Đã thêm 1 kênh, bỏ qua 1 kênh');
    expect(resultPage).toContain('alreadyBound:1');
    expect(resultPage).toContain('type:\'youtube-oauth-finished\',success:true,imported:1,skipped:1');
    expect(resultPage).toContain('},"http://localhost:5173");window.close()');
    expect(resultPage).not.toContain('import-refresh-token-private');
    const credentials = await getCollection<TestDoc>('youtubeCredentials').find({}).toArray();
    expect(JSON.stringify(credentials)).not.toContain('import-refresh-token-private');
    expect(credentials.some((credential) => credential.kind === 'pending-import')).toBe(false);
  });
});
