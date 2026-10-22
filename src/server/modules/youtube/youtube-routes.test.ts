import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Document } from 'mongodb';
import type { JobSummary } from '../../../contracts/job';
import { getCollection } from '../../db/client';
import { errorHandler } from '../../error-handler';
import { loadConfig } from '../../config';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createChannel } from '../channel';
import { encryptRefreshToken } from './credentials-store';
import { ensureYoutubeIndexes } from './indexes';
import { createYoutubeRouter } from './routes';
import { quotaDatePacific, quotaProjectKey } from './sync';

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
  await getCollection<TestDoc>('youtubeVideos').deleteMany({});
  await getCollection<TestDoc>('youtubeChannelDaily').deleteMany({});
  await getCollection<TestDoc>('youtubeChannelTraffic').deleteMany({});
  await getCollection<TestDoc>('channels').deleteMany({});
});
afterEach(async () => {
  const current = server;
  server = null;
  if (current) await new Promise<void>((resolve) => current.close(() => resolve()));
});
afterAll(async () => closeTestMongo());

async function startApi(fetcher: typeof fetch, overrides: {
  config?: typeof config;
  enqueueJob?: (input: { type: string; projectId: string; payload: unknown; maxAttempts?: number }) => Promise<JobSummary>;
  getActiveJob?: (projectId: string, type: string) => Promise<JobSummary | null>;
} = {}): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use('/api/youtube', createYoutubeRouter({
    config: overrides.config ?? config,
    fetcher,
    enqueueJob: overrides.enqueueJob ?? (async () => ({ id: 'job-1' } as JobSummary)),
    getActiveJob: overrides.getActiveJob ?? (async () => null),
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

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function addCredential(profileId: string, values: {
  youtubeChannelId: string | null;
  title: string | null;
  subscriberCount?: number | null;
  needsReconnect?: boolean;
}): Promise<void> {
  await getCollection<TestDoc>('youtubeCredentials').insertOne({
    _id: profileId,
    schemaVersion: 1,
    refreshToken: encryptRefreshToken('refresh-token-secret', key),
    youtubeChannelId: values.youtubeChannelId,
    title: values.title,
    connectedAt: new Date(),
    needsReconnect: values.needsReconnect ?? false,
    subscriberCount: values.subscriberCount ?? null,
    channelOptions: [],
  });
}

describe('YouTube channels overview and sync-all routes', () => {
  it('returns every profile from stored data, preserves unavailable metrics, ranks videos, and omits credentials', async () => {
    let activeProfileId = '';
    const base = await startApi(async () => { throw new Error('Overview must not call Google.'); }, {
      getActiveJob: async (profileId) => profileId === activeProfileId ? { id: 'active-sync-1' } as JobSummary : null,
    });
    const disconnected = await createChannel({ name: 'Chưa kết nối', language: 'vi' });
    const connected = await createChannel({ name: 'Kênh đã kết nối', handle: '@connected', language: 'en' });
    activeProfileId = connected.id;
    const missingDaily = await createChannel({ name: 'Thiếu dữ liệu ngày', language: 'vi' });
    const reconnect = await createChannel({ name: 'Cần kết nối lại', language: 'vi' });
    await addCredential(connected.id, { youtubeChannelId: 'UC-connected', title: 'Tên YouTube', subscriberCount: 300 });
    await addCredential(missingDaily.id, { youtubeChannelId: 'UC-missing', title: 'Kênh thiếu daily', subscriberCount: 200 });
    await addCredential(reconnect.id, { youtubeChannelId: 'UC-reconnect', title: 'Kênh hết quyền', subscriberCount: 9, needsReconnect: true });
    await getCollection<TestDoc>('youtubeCredentials').updateOne({ _id: connected.id }, { $set: { lastSyncAt: new Date(), thumbnailUrl: 'https://example.com/channel.png' } });
    await getCollection<TestDoc>('youtubeChannelDaily').insertMany([
      { _id: `${connected.id}:${daysAgo(5)}`, channelProfileId: connected.id, date: daysAgo(5), views: 150, estimatedMinutesWatched: 9_000, subscribersGained: 5, subscribersLost: 1 },
      { _id: `${connected.id}:${daysAgo(35)}`, channelProfileId: connected.id, date: daysAgo(35), views: 100, estimatedMinutesWatched: 6_000, subscribersGained: 3, subscribersLost: 2 },
    ]);
    await getCollection<TestDoc>('youtubeVideos').insertOne({
      _id: `${connected.id}:video-top`, channelProfileId: connected.id, videoId: 'video-top', title: 'Video nổi bật',
      publishedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(), durationSec: 600, isShort: false, privacy: 'public',
      viewCount: 300, likeCount: 4, commentCount: 2, fetchedAt: new Date().toISOString(), analytics: {}, removed: false,
    });

    const response = await fetch(`${base}/api/youtube/channels-overview`);
    expect(response.status).toBe(200);
    const payload = await response.json() as { channels: Array<{ channelId: string; [key: string]: unknown }>; totals: Record<string, unknown> };
    const rows = new Map(payload.channels.map((channel) => [channel.channelId, channel]));
    expect(rows.size).toBe(4);
    expect(rows.get(disconnected.id)).toMatchObject({ connection: { connected: false }, last28: { views: null }, activeSyncJobId: null });
    expect(rows.get(connected.id)).toMatchObject({
      language: 'en', subscriberCount: 300, videoCount: 1, longCount: 1, shortCount: 0,
      last28: { views: 150, estimatedMinutesWatched: 9_000, subscribersGained: 5, subscribersLost: 1 },
      previous28: { views: 100, estimatedMinutesWatched: 6_000, subscribersGained: 3, subscribersLost: 2 },
      trend: { views: { changePercent: 50 }, tooFewData: false },
      activeSyncJobId: 'active-sync-1', topVideo: { videoId: 'video-top', title: 'Video nổi bật', viewsPerDay: expect.any(Number) },
    });
    expect(rows.get(missingDaily.id)).toMatchObject({ last28: { views: null, estimatedMinutesWatched: null, subscribersGained: null, subscribersLost: null }, previous28: { views: null } });
    expect(rows.get(reconnect.id)?.connection).toMatchObject({ connected: false, needsReconnect: true });
    expect(payload.totals).toMatchObject({ subscriberCount: 500, channelsConnected: 2, channelsNeedReconnect: 1, views28: 150, watchHours28: 150, subscribersGained28: 5 });
    expect(JSON.stringify(payload)).not.toMatch(/refreshToken|accessToken|ciphertext|authTag|clientSecret/i);
  });

  it('returns empty overview and queues only eligible channels while isolating quota and active-job skips', async () => {
    const emptyBase = await startApi(async () => { throw new Error('Overview must not call Google.'); });
    const empty = await (await fetch(`${emptyBase}/api/youtube/channels-overview`)).json();
    expect(empty).toMatchObject({ channels: [], totals: { channelsConnected: 0, channelsNeedReconnect: 0 } });
    await new Promise<void>((resolve) => { server!.close(() => resolve()); });
    server = null;

    const eligible = await createChannel({ name: 'Đủ điều kiện' });
    const alreadyRunning = await createChannel({ name: 'Đang chạy' });
    const quotaBlocked = await createChannel({ name: 'Hết quota' });
    const disconnected = await createChannel({ name: 'Chưa kết nối' });
    const reconnect = await createChannel({ name: 'Cần kết nối lại' });
    await addCredential(eligible.id, { youtubeChannelId: 'UC-eligible', title: 'Eligible' });
    await addCredential(alreadyRunning.id, { youtubeChannelId: 'UC-running', title: 'Running' });
    await addCredential(quotaBlocked.id, { youtubeChannelId: 'UC-quota', title: 'Quota' });
    await addCredential(reconnect.id, { youtubeChannelId: 'UC-reconnect', title: 'Reconnect', needsReconnect: true });
    await getCollection<TestDoc>('youtubeQuota').insertOne({ _id: 'quota', date: quotaDatePacific(), projectKey: quotaProjectKey(config.GOOGLE_OAUTH_CLIENT_ID), estimatedUnits: 7_970 });
    await getCollection<TestDoc>('youtubeVideos').insertMany(Array.from({ length: 1_000 }, (_, index) => ({
      _id: `quota-video-${index}`, channelProfileId: quotaBlocked.id, videoId: `video-${index}`, removed: false,
    })));
    const enqueued: string[] = [];
    const base = await startApi(async () => { throw new Error('Sync-all must enqueue jobs without calling Google.'); }, {
      enqueueJob: async (input) => { enqueued.push(input.projectId); return { id: `job-${input.projectId}` } as JobSummary; },
      getActiveJob: async (profileId) => profileId === alreadyRunning.id ? { id: 'already-running-job' } as JobSummary : null,
    });

    const response = await fetch(`${base}/api/youtube/sync-all`, { method: 'POST' });
    expect(response.status).toBe(200);
    const payload = await response.json() as { results: Array<Record<string, unknown>> };
    const rows = new Map(payload.results.map((result) => [result.channelId, result]));
    expect(enqueued).toEqual([eligible.id]);
    expect(rows.get(eligible.id)).toMatchObject({ jobId: `job-${eligible.id}` });
    expect(rows.get(alreadyRunning.id)).toMatchObject({ jobId: 'already-running-job', skipped: 'already-running' });
    expect(rows.get(quotaBlocked.id)).toMatchObject({ jobId: null, skipped: 'quota' });
    expect(rows.get(disconnected.id)).toMatchObject({ jobId: null, skipped: 'not-connected' });
    expect(rows.get(reconnect.id)).toMatchObject({ jobId: null, skipped: 'needs-reconnect' });
    expect(JSON.stringify(payload)).not.toMatch(/refreshToken|accessToken|ciphertext|authTag|clientSecret/i);
  });

  it('refuses sync-all with the existing setup message only when Google is unconfigured', async () => {
    const noGoogleConfig = { ...config, GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '', YOUTUBE_TOKEN_ENCRYPTION_KEY: '' };
    const base = await startApi(async () => { throw new Error('No Google request should happen.'); }, { config: noGoogleConfig });
    const response = await fetch(`${base}/api/youtube/sync-all`, { method: 'POST' });
    expect(response.status).toBe(503);
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('YOUTUBE_NOT_CONFIGURED');
    expect(body.error.message).toContain('GOOGLE_OAUTH_CLIENT_ID');
    expect(JSON.stringify(body)).not.toMatch(/refreshToken|accessToken|ciphertext|authTag|clientSecret/i);
  });
});

describe('YouTube manual reach and plan exclusion routes', () => {
  it('validates and persists manual Studio reach values and exclusion without exposing credentials', async () => {
    const profile = await createChannel({ name: 'Kênh kiểm tra' });
    await getCollection<TestDoc>('youtubeVideos').insertOne({
      _id: `${profile.id}:video-manual`, channelProfileId: profile.id, videoId: 'video-manual', title: 'Video',
      publishedAt: '2026-10-01T00:00:00.000Z', durationSec: 600, isShort: false, privacy: 'public',
      viewCount: 100, likeCount: 2, commentCount: 0, fetchedAt: '2026-10-21T00:00:00.000Z', analytics: {}, removed: false,
    });
    const base = await startApi(async () => { throw new Error('Manual fields must not call Google.'); });
    const path = `${base}/api/youtube/videos/${profile.id}/video-manual`;

    const invalid = await fetch(`${path}/manual-reach`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ impressions: 2_000, ctrPercent: 101 }) });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: 'YOUTUBE_MANUAL_REACH_INVALID' } });

    const missingVideo = await fetch(`${base}/api/youtube/videos/${profile.id}/missing-video/manual-reach`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ impressions: 200, ctrPercent: 2 }) });
    expect(missingVideo.status).toBe(404);
    const missingProfile = await fetch(`${base}/api/youtube/videos/missing-profile/video-manual/manual-reach`, { method: 'DELETE' });
    expect(missingProfile.status).toBe(404);

    const saved = await fetch(`${path}/manual-reach`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ impressions: 2_000, ctrPercent: 3.2 }) });
    expect(saved.status).toBe(200);
    const savedBody = await saved.json() as Record<string, unknown>;
    expect(savedBody).toMatchObject({ manualReach: { impressions: 2_000, ctrPercent: 3.2, enteredAt: expect.any(String) } });
    expect(JSON.stringify(savedBody)).not.toMatch(/refreshToken|accessToken|ciphertext|authTag|clientSecret/i);

    const excluded = await fetch(`${path}/plan-exclusion`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ excluded: true }) });
    expect(excluded.status).toBe(200);
    expect(await excluded.json()).toMatchObject({ excludedFromPlan: true });

    const cleared = await fetch(`${path}/manual-reach`, { method: 'DELETE' });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ manualReach: null, excludedFromPlan: true });
    expect(await getCollection<TestDoc>('youtubeVideos').findOne({ _id: `${profile.id}:video-manual` })).toMatchObject({ manualReach: null, excludedFromPlan: true });
  });
});
