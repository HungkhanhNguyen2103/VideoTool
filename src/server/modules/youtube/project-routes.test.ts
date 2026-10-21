import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Document } from 'mongodb';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createApp } from '../../app';
import { loadConfig } from '../../config';
import { encryptRefreshToken } from './credentials-store';

type TestDoc = Document & { _id: string; [key: string]: unknown };
const key = Buffer.alloc(32, 4).toString('base64');
const config = loadConfig({ GOOGLE_OAUTH_CLIENT_ID: '123456-youtube.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', YOUTUBE_TOKEN_ENCRYPTION_KEY: key });
const projectInput = {
  title: 'Linked project', brief: 'A sufficiently long project brief for linking.', language: 'vi' as const,
  referencesText: '', scriptPresetId: 'documentary' as const, targetDurationSec: 60, chapterCount: 1,
  voiceId: null, renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

let filesDir = '';
let server: Server | null = null;

beforeAll(async () => {
  await startTestMongo();
  filesDir = await mkdtemp(path.join(tmpdir(), 'youtube-project-link-'));
});
beforeEach(async () => {
  for (const name of ['channels', 'projects', 'youtubeCredentials', 'youtubeVideos', 'youtubeChannelDaily', 'youtubeRetention', 'youtubeReviews', 'jobs', 'files']) {
    await getCollection<TestDoc>(name).deleteMany({});
  }
});
afterEach(async () => {
  const current = server;
  server = null;
  if (current) await new Promise<void>((resolve) => current.close(() => resolve()));
});
afterAll(async () => {
  await closeTestMongo();
  if (filesDir) await rm(filesDir, { recursive: true, force: true });
});

async function startApi(): Promise<string> {
  const app = createApp({ filesDir, clientDir: null, youtubeConfig: config });
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const postJson = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });

describe('project to YouTube video linking', () => {
  it('only links a video synced for the assigned channel and clears it when the project channel changes', async () => {
    const base = await startApi();
    const channelA = await (await fetch(`${base}/api/channels`, postJson({ name: 'Channel A' }))).json() as { id: string };
    const channelB = await (await fetch(`${base}/api/channels`, postJson({ name: 'Channel B' }))).json() as { id: string };
    const project = await (await fetch(`${base}/api/project`, postJson({ ...projectInput, channelId: channelA.id }))).json() as { id: string };
    await getCollection<TestDoc>('youtubeCredentials').insertOne({
      _id: channelA.id, schemaVersion: 1, refreshToken: encryptRefreshToken('refresh-token', key), youtubeChannelId: 'UC-A',
      title: 'YouTube A', connectedAt: new Date(), needsReconnect: false, channelOptions: [],
    });
    await getCollection<TestDoc>('youtubeVideos').insertOne({
      _id: `${channelA.id}:video-A`, channelProfileId: channelA.id, videoId: 'video-A', title: 'An owned upload', publishedAt: new Date().toISOString(),
      durationSec: 60, isShort: true, privacy: 'public', viewCount: 10, likeCount: null, commentCount: null,
      fetchedAt: new Date().toISOString(), analytics: {}, removed: false,
    });

    const linked = await fetch(`${base}/api/project/${project.id}/youtube-video`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoId: 'video-A' }) });
    expect(linked.status).toBe(200);
    expect(await linked.json()).toMatchObject({ youtubeVideoId: 'video-A' });

    const notOwned = await fetch(`${base}/api/project/${project.id}/youtube-video`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoId: 'video-B' }) });
    expect(notOwned.status).toBe(404);

    const changed = await fetch(`${base}/api/project/${project.id}/channel`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channelId: channelB.id }) });
    expect(await changed.json()).toMatchObject({ channelId: channelB.id, youtubeVideoId: null });

    const unlinked = await fetch(`${base}/api/project/${project.id}/youtube-video`, { method: 'DELETE' });
    expect(await unlinked.json()).toMatchObject({ youtubeVideoId: null });
  });
});
