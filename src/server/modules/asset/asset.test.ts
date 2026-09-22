import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import AdmZip from 'adm-zip';
import { FileSummarySchema } from '../../../contracts/file';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createApp } from '../../app';
import {
  applySceneAssets,
  createProject,
  getProject,
  patchProjectScene,
  replaceProjectScenes,
  setProjectScenesAssetType,
} from '../project';
import { exportScenesJson, importAssetsFromZip } from './index';

const projectInput = {
  title: 'Asset contract project',
  brief: 'A valid brief for asset contract tests.',
  language: 'vi' as const,
  referencesText: '',
  scriptPresetId: 'documentary' as const,
  targetDurationSec: 60,
  chapterCount: 1,
  voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

async function seedProjectWithScenes() {
  const project = await createProject(projectInput);
  await replaceProjectScenes(project.id, [
    { id: 'scene-1', narration: 'Opening', visualPrompt: 'A door', durationSec: 5, assetType: 'image', assetFileId: null },
    { id: 'scene-2', narration: 'Context', visualPrompt: 'A room', durationSec: 5, assetType: 'image', assetFileId: null },
    { id: 'scene-3', narration: 'Close', visualPrompt: 'A window', durationSec: 5, assetType: 'image', assetFileId: null },
  ]);
  return getProject(project.id);
}

beforeAll(() => startTestMongo());
let filesDir = '';
let server: Server | null = null;
beforeAll(async () => { filesDir = await mkdtemp(path.join(os.tmpdir(), 'video-tool-asset-')); });
beforeEach(async () => {
  await getCollection('projects').deleteMany({});
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

async function startAssetServer(): Promise<string> {
  const app = createApp({ filesDir, clientDir: null });
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

function validZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile('SCENE_001_Opening.png', Buffer.from('png-data'));
  return zip.toBuffer();
}

describe('asset contracts', () => {
  it('defaults asset fields when reading a legacy scene document', async () => {
    const project = await createProject(projectInput);
    await getCollection<{ _id: string }>('projects').updateOne(
      { _id: project.id },
      {
        $set: {
          scenes: [{ id: 'scene-1', narration: 'Opening', visualPrompt: 'A door', durationSec: 5 }],
        },
      },
    );

    const loaded = await getProject(project.id);
    expect(loaded.scenes[0]).toMatchObject({ assetType: 'image', assetFileId: null });
  });

  it('requires the generated stored path in file summaries', () => {
    const summary = FileSummarySchema.parse({
      id: 'file-1',
      projectId: 'project-1',
      originalName: 'scene.png',
      mimeType: 'image/png',
      ext: 'png',
      sizeBytes: 10,
      purpose: 'reference',
      storedPath: 'file-1.png',
      createdAt: new Date().toISOString(),
    });

    expect(summary.storedPath).toBe('file-1.png');
  });

  it('patches one scene through the project service', async () => {
    const project = await seedProjectWithScenes();

    const updated = await patchProjectScene(project.id, 'scene-2', { visualPrompt: 'A bright room', assetType: 'video' });

    expect(updated.scenes[1]).toMatchObject({ visualPrompt: 'A bright room', assetType: 'video', assetFileId: null });
    expect(updated.scenes[0]).toMatchObject({ visualPrompt: 'A door', assetType: 'image' });
    expect(updated.version).toBe(project.version + 1);
  });

  it('sets the asset type for every scene in one project update', async () => {
    const project = await seedProjectWithScenes();

    const updated = await setProjectScenesAssetType(project.id, 'video');

    expect(updated.scenes.every((scene) => scene.assetType === 'video')).toBe(true);
    expect(updated.version).toBe(project.version + 1);
  });

  it('applies multiple scene assets with one version increment and last-value-wins duplicates', async () => {
    const project = await seedProjectWithScenes();

    const updated = await applySceneAssets(project.id, [
      { sceneId: 'scene-1', assetFileId: 'file-old' },
      { sceneId: 'scene-2', assetFileId: 'file-two' },
      { sceneId: 'scene-1', assetFileId: 'file-new' },
    ]);

    expect(updated.scenes[0]!.assetFileId).toBe('file-new');
    expect(updated.scenes[1]!.assetFileId).toBe('file-two');
    expect(updated.scenes[2]!.assetFileId).toBeNull();
    expect(updated.version).toBe(project.version + 1);
  });

  it('exports Flow scenes with one-based numbering and prompts', async () => {
    const project = await seedProjectWithScenes();

    const exported = exportScenesJson(project);

    expect(exported).toEqual([
      expect.objectContaining({ sceneId: 1, sceneNumber: 1, prompt: 'A door', assetType: 'image' }),
      expect.objectContaining({ sceneId: 2, sceneNumber: 2, prompt: 'A room', assetType: 'image' }),
      expect.objectContaining({ sceneId: 3, sceneNumber: 3, prompt: 'A window', assetType: 'image' }),
    ]);
  });

  it('imports a valid root-level image and applies its file reference', async () => {
    const project = await seedProjectWithScenes();

    const result = await importAssetsFromZip(project.id, validZip());

    expect(result).toEqual({ updated: 1, skipped: [] });
    const updated = await getProject(project.id);
    expect(updated.scenes[0]!.assetFileId).toEqual(expect.any(String));
    expect(await getCollection<{ projectId: string; originalName: string }>('files').findOne({ projectId: project.id })).toMatchObject({ originalName: 'SCENE_001_Opening.png' });
  });

  it('exports JSON through the route with an attachment filename', async () => {
    const project = await seedProjectWithScenes();
    const base = await startAssetServer();

    const response = await fetch(`${base}/api/project/${project.id}/scenes/export-json`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="scenes-export.json"');
    expect(await response.json()).toHaveLength(3);
  });

  it('imports a ZIP through the route and rejects non-ZIP MIME types', async () => {
    const project = await seedProjectWithScenes();
    const base = await startAssetServer();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(validZip())], { type: 'application/zip' }), 'assets.zip');

    const imported = await fetch(`${base}/api/project/${project.id}/scenes/import-assets`, { method: 'POST', body: form });
    expect(imported.status).toBe(200);
    expect(await imported.json()).toEqual({ updated: 1, skipped: [] });

    const invalidForm = new FormData();
    invalidForm.append('file', new Blob(['not a zip'], { type: 'text/plain' }), 'assets.txt');
    const rejected = await fetch(`${base}/api/project/${project.id}/scenes/import-assets`, { method: 'POST', body: invalidForm });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: { code: 'INVALID_FILE_TYPE' } });
  });
});
