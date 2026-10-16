import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { VISUAL_STYLE_IDS } from '../../../contracts/project';
import { createApp } from '../../app';
import { getCollection } from '../../db/client';
import { closeTestMongo, resetTestMongo, startTestMongo } from '../../../test-utils/mongo';

describe('visual style packs', () => {
  const filesDir = mkdtempSync(path.join(tmpdir(), 'style-packs-'));
  let server: Server;
  let base: string;

  beforeAll(async () => { await startTestMongo(); });
  beforeEach(async () => {
    await resetTestMongo();
    await getCollection('visual_style_pack_images').deleteMany({});
    await getCollection('visual_style_samples').deleteMany({});
    server = createApp({ filesDir, clientDir: null }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  afterAll(async () => { await closeTestMongo(); rmSync(filesDir, { recursive: true, force: true }); });

  async function list() {
    const response = await fetch(`${base}/api/visual-style-packs`);
    expect(response.status).toBe(200);
    return response.json() as Promise<Record<string, Record<string, { url: string; filename: string; source: string }>>>;
  }
  async function upload(styleId: string, slotId: string, name = 'image.png', type = 'image/png') {
    const form = new FormData();
    form.append('file', new Blob([name], { type }), name);
    return fetch(`${base}/api/visual-style-packs/${styleId}/${slotId}`, { method: 'PUT', body: form });
  }
  async function remove(styleId: string, slotId: string) {
    return fetch(`${base}/api/visual-style-packs/${styleId}/${slotId}`, { method: 'DELETE' });
  }

  it('stores and serves an image for every style', async () => {
    for (const styleId of VISUAL_STYLE_IDS) {
      const response = await upload(styleId, 'core');
      expect(response.status).toBe(200);
      const image = await response.json() as { url: string; filename: string };
      expect(image.filename).toBe('image.png');
      expect((await fetch(`${base}${image.url}`)).status).toBe(200);
    }
    const packs = await list();
    expect(Object.keys(packs)).toHaveLength(6);
    expect(await getCollection('visual_style_pack_images').countDocuments()).toBe(6);
  });

  it('replaces a slot and deletes its previous disk file', async () => {
    const first = await (await upload('anime', 'wide', 'first.png')).json() as { url: string };
    const second = await (await upload('anime', 'wide', 'second.png')).json() as { url: string };
    expect(second.url).not.toBe(first.url);
    expect((await list()).anime?.wide?.filename).toBe('second.png');
    expect(existsSync(path.join(filesDir, decodeURIComponent(first.url.slice('/files/'.length))))).toBe(false);
  });

  it('deletes a slot and tolerates deleting it again', async () => {
    const image = await (await upload('watercolor', 'props')).json() as { url: string };
    expect((await remove('watercolor', 'props')).status).toBe(204);
    expect((await remove('watercolor', 'props')).status).toBe(204);
    expect((await list()).watercolor?.props).toBeUndefined();
    expect(existsSync(path.join(filesDir, decodeURIComponent(image.url.slice('/files/'.length))))).toBe(false);
  });

  it('rejects unknown styles, invalid slots, wrong MIME and missing files', async () => {
    expect((await (await upload('unknown', 'core')).json()).error.code).toBe('INVALID_VISUAL_STYLE');
    expect((await (await upload('strategic-map', 'props')).json()).error.code).toBe('INVALID_STYLE_PACK_SLOT');
    expect((await (await upload('cinematic', 'wide', 'bad.pdf', 'application/pdf')).json()).error.code).toBe('INVALID_FILE_TYPE');
    const missing = await fetch(`${base}/api/visual-style-packs/cinematic/wide`, { method: 'PUT', body: new FormData() });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe('FILE_REQUIRED');
    expect((await remove('strategic-map', 'props')).status).toBe(400);
    expect(await getCollection('visual_style_pack_images').countDocuments()).toBe(0);
  });

  it('falls back to a legacy core sample and removes it when core is uploaded or deleted', async () => {
    const form = new FormData();
    form.append('file', new Blob(['legacy'], { type: 'image/png' }), 'legacy.png');
    const legacy = await (await fetch(`${base}/api/visual-style-samples/flat-cartoon`, { method: 'PUT', body: form })).json() as { url: string };
    expect((await list())['flat-cartoon']?.core?.url).toBe(legacy.url);

    const next = await upload('flat-cartoon', 'core');
    expect(next.status).toBe(200);
    expect(await getCollection('visual_style_samples').countDocuments()).toBe(0);
    expect(existsSync(path.join(filesDir, decodeURIComponent(legacy.url.slice('/files/'.length))))).toBe(false);
    expect((await list())['flat-cartoon']?.core?.url).not.toBe(legacy.url);

    const secondLegacy = await (await fetch(`${base}/api/visual-style-samples/flat-cartoon`, { method: 'PUT', body: form })).json() as { url: string };
    expect((await remove('flat-cartoon', 'core')).status).toBe(204);
    expect(await getCollection('visual_style_samples').countDocuments()).toBe(0);
    expect(existsSync(path.join(filesDir, decodeURIComponent(secondLegacy.url.slice('/files/'.length))))).toBe(false);
    expect((await list())['flat-cartoon']?.core).toBeUndefined();
  });
});
