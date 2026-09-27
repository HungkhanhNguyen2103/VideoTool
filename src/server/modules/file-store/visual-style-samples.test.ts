import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { getCollection } from '../../db/client';
import { closeTestMongo, resetTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createApp } from '../../app';

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

  it('keeps a shared upload as the only resolved source', async () => {
    const first = await uploadShared();
    expect(first.status).toBe(200);
    const shared = await first.json() as { url: string };
    await getCollection<{ _id: string; createdAt: Date }>('visual_style_samples').updateOne({ _id: 'flat-cartoon' }, { $set: { createdAt: new Date(Date.now() + 2000) } });
    expect((await list())['flat-cartoon']).toMatchObject({ source: 'shared', url: shared.url });
  });

  it('rejects invalid style ids and non-image uploads', async () => {
    expect((await uploadShared('invalid-style')).status).toBe(400);
    expect((await uploadShared('flat-cartoon', 'application/pdf')).status).toBe(400);
    expect(await list()).toEqual({});
  });
});
