import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createApp } from '../../app';

const projectInput = {
  title: 'Assigned project',
  brief: 'A sufficiently long brief for channel assignment.',
  language: 'vi' as const,
  referencesText: '',
  scriptPresetId: 'documentary' as const,
  targetDurationSec: 60,
  chapterCount: 1,
  voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

let filesDir = '';
let server: Server | null = null;

beforeAll(async () => {
  await startTestMongo();
  filesDir = await mkdtemp(path.join(tmpdir(), 'channel-routes-'));
});

beforeEach(async () => {
  await getCollection('channels').deleteMany({});
  await getCollection('projects').deleteMany({});
  await getCollection('jobs').deleteMany({});
  await getCollection('files').deleteMany({});
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
  const app = createApp({ filesDir, clientDir: null });
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

function json(method: string, value?: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) };
}

describe('channel CRUD routes', () => {
  it('creates, lists, reads, updates, validates, and deletes channel profiles', async () => {
    const base = await startApi();
    const createdResponse = await fetch(`${base}/api/channels`, json('POST', {
      name: 'Lịch Sử', handle: '@lichsu213', tagline: 'Những câu chuyện lịch sử',
      links: [{ label: 'Trang chủ', url: 'https://example.com' }], defaultHashtags: ['lịch sử'],
    }));
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created).toMatchObject({ name: 'Lịch Sử', handle: '@lichsu213', defaultHashtags: ['#LichSu'], publishSchedule: null });

    expect(await (await fetch(`${base}/api/channels`)).json()).toMatchObject([{ id: created.id, name: 'Lịch Sử' }]);
    expect(await (await fetch(`${base}/api/channels/${created.id}`)).json()).toMatchObject({ id: created.id, descriptionFooter: '' });

    const updated = await fetch(`${base}/api/channels/${created.id}`, json('PATCH', { tagline: 'Lịch sử Việt Nam', handle: null }));
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ name: 'Lịch Sử', tagline: 'Lịch sử Việt Nam' });

    const invalidHandle = await fetch(`${base}/api/channels`, json('POST', { name: 'Bad handle', handle: '@ab' }));
    expect(invalidHandle.status).toBe(400);
    const invalidUrl = await fetch(`${base}/api/channels`, json('POST', { name: 'Bad URL', links: [{ label: 'Site', url: 'javascript:alert(1)' }] }));
    expect(invalidUrl.status).toBe(400);

    const duplicateName = await fetch(`${base}/api/channels`, json('POST', { name: 'Lich Su' }));
    expect(duplicateName.status).toBe(409);
    expect(await duplicateName.json()).toMatchObject({ error: { code: 'CHANNEL_NAME_TAKEN' } });

    expect((await fetch(`${base}/api/channels/${created.id}`, json('DELETE'))).status).toBe(204);
    expect((await fetch(`${base}/api/channels/${created.id}`)).status).toBe(404);
  });

  it('validates project assignment and refuses to delete a channel in use with its count', async () => {
    const base = await startApi();
    const channelResponse = await fetch(`${base}/api/channels`, json('POST', { name: 'Kênh lịch sử' }));
    const channel = await channelResponse.json();

    const projectResponse = await fetch(`${base}/api/project`, json('POST', { ...projectInput, channelId: channel.id }));
    expect(projectResponse.status).toBe(201);
    const project = await projectResponse.json();
    expect(project.channelId).toBe(channel.id);

    const unknownAssignment = await fetch(`${base}/api/project/${project.id}/channel`, json('PATCH', { channelId: 'missing-channel' }));
    expect(unknownAssignment.status).toBe(404);
    const unknownCreate = await fetch(`${base}/api/project`, json('POST', { ...projectInput, channelId: 'missing-channel' }));
    expect(unknownCreate.status).toBe(404);

    const inUse = await fetch(`${base}/api/channels/${channel.id}`, json('DELETE'));
    expect(inUse.status).toBe(409);
    expect(await inUse.json()).toMatchObject({ error: { code: 'CHANNEL_IN_USE', message: expect.stringContaining('1') } });

    const cleared = await fetch(`${base}/api/project/${project.id}/channel`, json('PATCH', { channelId: null }));
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ channelId: null, version: project.version + 1 });
    expect((await fetch(`${base}/api/channels/${channel.id}`, json('DELETE'))).status).toBe(204);
  });
});
