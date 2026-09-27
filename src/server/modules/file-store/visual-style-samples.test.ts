import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { getCollection } from '../../db/client';
import { closeTestMongo, resetTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createApp } from '../../app';
import { createProject, setProjectCustomStyleReferenceFile, setProjectVisualStylePreset } from '../project';
import { createFileStoreService } from './service';

const projectInput = {
  title: 'Kodak', brief: 'A valid brief for shared style samples.', language: 'vi' as const,
  referencesText: '', scriptPresetId: 'documentary' as const, visualStylePresetId: 'flat-cartoon' as const,
  targetDurationSec: 60, chapterCount: null, voiceId: null, aiProvider: 'deepseek' as const,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

describe('visual style samples', () => {
  const filesDir = mkdtempSync(path.join(tmpdir(), 'style-samples-'));
  let server: Server;
  let base: string;

  beforeAll(async () => { await startTestMongo(); });
  beforeEach(async () => {
    await resetTestMongo();
    await getCollection('files').deleteMany({});
    await getCollection('visual_style_samples').deleteMany({});
    server = createApp({ filesDir, clientDir: null }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  afterAll(async () => { await closeTestMongo(); rmSync(filesDir, { recursive: true, force: true }); });

  async function list() {
    const response = await fetch(`${base}/api/visual-style-samples`);
    expect(response.status).toBe(200);
    return response.json() as Promise<Record<string, { url: string; filename: string; source: string; updatedAt: string }>>;
  }
  async function uploadShared(style = 'flat-cartoon', type = 'image/png') {
    const form = new FormData();
    form.append('file', new Blob(['image'], { type }), 'sample.png');
    return fetch(`${base}/api/visual-style-samples/${style}`, { method: 'PUT', body: form });
  }

  it('returns no dynamic samples for a legacy empty store', async () => {
    expect(await list()).toEqual({});
  });

  it('resolves the latest current project reference and ignores a cleared pointer', async () => {
    const project = await createProject(projectInput);
    const file = await createFileStoreService(filesDir).storeFile({ projectId: project.id, originalName: 'kodak.png', mimeType: 'image/png', buffer: Buffer.from('image'), purpose: 'style-reference' });
    await setProjectCustomStyleReferenceFile(project.id, file.id);
    expect((await list())['flat-cartoon']).toMatchObject({ url: `/files/${file.storedPath}`, filename: 'kodak.png', source: 'project' });
    await setProjectCustomStyleReferenceFile(project.id, null);
    expect(await list()).toEqual({});
  });

  it('chooses the newest upload across shared and project sources', async () => {
    const first = await uploadShared();
    expect(first.status).toBe(200);
    const shared = await first.json() as { url: string };
    const project = await createProject(projectInput);
    const file = await createFileStoreService(filesDir).storeFile({ projectId: project.id, originalName: 'new.png', mimeType: 'image/png', buffer: Buffer.from('image'), purpose: 'style-reference' });
    await getCollection<{ _id: string; createdAt: Date }>('files').updateOne({ _id: file.id }, { $set: { createdAt: new Date(Date.now() + 1000) } });
    await setProjectCustomStyleReferenceFile(project.id, file.id);
    expect((await list())['flat-cartoon']).toMatchObject({ source: 'project', url: `/files/${file.storedPath}` });
    await getCollection<{ _id: string; createdAt: Date }>('visual_style_samples').updateOne({ _id: 'flat-cartoon' }, { $set: { createdAt: new Date(Date.now() + 2000) } });
    expect((await list())['flat-cartoon']).toMatchObject({ source: 'shared', url: shared.url });
    await setProjectVisualStylePreset(project.id, 'anime');
    expect((await list())['flat-cartoon']).toMatchObject({ source: 'shared' });
  });

  it('rejects invalid style ids and non-image uploads', async () => {
    expect((await uploadShared('invalid-style')).status).toBe(400);
    expect((await uploadShared('flat-cartoon', 'application/pdf')).status).toBe(400);
    expect(await list()).toEqual({});
  });
});
