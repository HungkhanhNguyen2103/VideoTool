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
  duplicateProject,
  getProject,
  patchProjectScene,
  replaceProjectScenes,
  setProjectScenesAssetType,
  type ProjectDoc,
} from '../project';
import { applyVideoDistribution, configureAssetModule, exportScenesJson, importAssetsFromZip, previewVideoDistribution } from './index';

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
    { id: 'scene-1', narration: 'Opening', visualPrompt: 'A door', durationSec: 5, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null },
    { id: 'scene-2', narration: 'Context', visualPrompt: 'A room', durationSec: 5, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null },
    { id: 'scene-3', narration: 'Close', visualPrompt: 'A window', durationSec: 5, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null },
  ]);
  return getProject(project.id);
}

async function setChapterSceneCounts(projectId: string, counts: Array<number | null>): Promise<void> {
  await getCollection<ProjectDoc>('projects').updateOne(
    { _id: projectId },
    {
      $set: {
        chapters: counts.map((scenesCount, index) => ({
          id: `chapter-${index + 1}`,
          no: index + 1,
          title: `Chapter ${index + 1}`,
          paragraphs: [],
          status: 'approved',
          scenesCount,
          durationSec: null,
          role: null,
          beat: '',
          targetWords: null,
          endsOnTension: false,
          chapterSummary: null,
          avoidRepeating: [],
          persistentFacts: [],
          reviewStatus: 'clean',
        })),
      },
    },
  );
}

beforeAll(() => startTestMongo());
let filesDir = '';
let server: Server | null = null;
beforeAll(async () => { filesDir = await mkdtemp(path.join(os.tmpdir(), 'video-tool-asset-')); });
beforeEach(async () => {
  configureAssetModule(filesDir);
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

function zipWithCorruptCentralDirectory(): Buffer {
  const zip = new AdmZip();
  zip.addFile('SCENE_001_Broken.png', Buffer.from('broken'));
  const buffer = zip.toBuffer();
  const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const offset = buffer.lastIndexOf(centralSignature);
  if (offset < 0) throw new Error('Expected a central directory header.');
  buffer.writeUInt32LE(0, offset);
  return buffer;
}

describe('asset contracts', () => {
  it('previews video distribution without changing the project', async () => {
    const project = await seedProjectWithScenes();
    await setChapterSceneCounts(project.id, [2, 1]);
    const before = await getProject(project.id);

    const preview = await previewVideoDistribution(project.id, 50);

    expect(preview).toEqual({
      total: 3,
      videoCount: 2,
      imageCount: 1,
      lockedCount: 0,
      changes: [
        { sceneId: 'scene-1', sceneNumber: 1, from: 'image', to: 'video' },
        { sceneId: 'scene-3', sceneNumber: 3, from: 'image', to: 'video' },
      ],
      videoSceneNumbers: [1, 3],
      projectVersion: before.version,
    });
    expect((await getProject(project.id)).version).toBe(before.version);
  });

  it('applies only unlocked distribution changes and clears depth metadata for new videos', async () => {
    const project = await seedProjectWithScenes();
    await setChapterSceneCounts(project.id, [2, 1]);
    await getCollection<ProjectDoc>('projects').updateOne(
      { _id: project.id },
      {
        $set: {
          'scenes.0.assetFileId': 'locked-image',
          'scenes.0.depthMap': { assetFileId: 'locked-image', fileId: 'depth-1', score: 0.9 },
          'scenes.1.depthMap': { assetFileId: 'asset-2', fileId: 'depth-2', score: 0.8 },
        },
      },
    );
    const before = await getProject(project.id);

    const updated = await applyVideoDistribution(project.id, 100, before.version);

    expect(updated.scenes.map((scene) => scene.assetType)).toEqual(['image', 'video', 'video']);
    expect(updated.scenes[0]).toMatchObject({ assetFileId: 'locked-image', depthMap: { fileId: 'depth-1' } });
    expect(updated.scenes[1]).toMatchObject({ assetFileId: null, depthMap: null });
    expect(updated.version).toBe(before.version + 1);
  });

  it('treats a keyframe-only video as locked during distribution', async () => {
    const project = await seedProjectWithScenes();
    await setChapterSceneCounts(project.id, [2, 1]);
    await patchProjectScene(project.id, 'scene-2', {
      assetType: 'video',
      videoKeyframeFileId: 'keyframe-only',
      videoDurationSec: 1.5,
    });
    const before = await getProject(project.id);

    const preview = await previewVideoDistribution(project.id, 0);

    expect(preview).toMatchObject({ lockedCount: 1, videoCount: 1, imageCount: 2, videoSceneNumbers: [2], changes: [] });
    const updated = await applyVideoDistribution(project.id, 0, before.version);

    expect(updated.version).toBe(before.version);
    expect(updated.scenes[1]).toMatchObject({ assetType: 'video', assetFileId: null, videoKeyframeFileId: 'keyframe-only', videoDurationSec: 1.5 });
  });

  it('clears video metadata when an unlocked video becomes an image', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-3', { assetType: 'video', videoDurationSec: 4.5 });
    const before = await getProject(project.id);

    const updated = await applyVideoDistribution(project.id, 0, before.version);

    expect(updated.scenes[2]).toMatchObject({ assetType: 'image', videoKeyframeFileId: null, videoDurationSec: null });
  });

  it('rejects a stale expected version without changing the project', async () => {
    const project = await seedProjectWithScenes();
    const expectedVersion = project.version;
    await patchProjectScene(project.id, 'scene-1', { visualPrompt: 'Changed after preview' });

    await expect(applyVideoDistribution(project.id, 50, expectedVersion)).rejects.toMatchObject({
      status: 409,
      code: 'PROJECT_CHANGED',
      message: 'Project changed, preview again.',
    });
    expect((await getProject(project.id)).scenes[0]!.assetType).toBe('image');
  });

  it('skips a no-op distribution update', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-1', { assetType: 'video' });
    const before = await getProject(project.id);

    const updated = await applyVideoDistribution(project.id, 20, before.version);

    expect(updated.version).toBe(before.version);
    expect(updated.scenes[0]!.assetType).toBe('video');
  });

  it('falls back to one chapter when stored chapter counts do not match the scene count', async () => {
    const project = await seedProjectWithScenes();
    await setChapterSceneCounts(project.id, [2, 2]);

    await expect(previewVideoDistribution(project.id, 50)).resolves.toMatchObject({
      videoSceneNumbers: [1, 3],
      projectVersion: project.version,
    });
  });

  it.each([101, -1, 12.5])('rejects targetPercent %p with HTTP 422', async (targetPercent) => {
    const project = await seedProjectWithScenes();
    const base = await startAssetServer();

    const response = await fetch(`${base}/api/project/${project.id}/scenes/video-distribution/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetPercent }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'validation_error' } });
  });

  it('returns PROJECT_CHANGED through the apply route for a stale version', async () => {
    const project = await seedProjectWithScenes();
    const base = await startAssetServer();
    await patchProjectScene(project.id, 'scene-1', { visualPrompt: 'Changed after preview' });

    const response = await fetch(`${base}/api/project/${project.id}/scenes/video-distribution/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetPercent: 50, expectedVersion: project.version }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: 'PROJECT_CHANGED', message: 'Project changed, preview again.' } });
  });

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
    expect(loaded.scenes[0]).toMatchObject({ assetType: 'image', assetFileId: null, motionPrompt: '', videoKeyframeFileId: null, videoDurationSec: null });
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

  it('preserves an existing video keyframe and duration when only the video file changes', async () => {
    const project = await seedProjectWithScenes();
    await getCollection<{ _id: string }>('projects').updateOne(
      { _id: project.id },
      { $set: { 'scenes.1.assetType': 'video', 'scenes.1.assetFileId': 'old-video', 'scenes.1.videoKeyframeFileId': 'old-keyframe', 'scenes.1.videoTailFileId': 'old-tail', 'scenes.1.videoDurationSec': 2.5 } },
    );

    const updated = await applySceneAssets(project.id, [{ sceneId: 'scene-2', assetFileId: 'new-video' }]);

    expect(updated.scenes[1]).toMatchObject({ assetFileId: 'new-video', videoKeyframeFileId: 'old-keyframe', videoTailFileId: 'old-tail', videoDurationSec: 2.5 });
  });

  it('writes an explicit null video tail through applySceneAssets', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video', videoTailFileId: 'tail-1' });

    const updated = await applySceneAssets(project.id, [{ sceneId: 'scene-2', videoTailFileId: null }]);

    expect(updated.scenes[1]!.videoTailFileId).toBeNull();
  });

  it('clears a stale tail when the video asset file is patched without an explicit tail', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video', videoTailFileId: 'tail-1' });

    const updated = await patchProjectScene(project.id, 'scene-2', { assetFileId: 'video-1' });

    expect(updated.scenes[1]).toMatchObject({ assetFileId: 'video-1', videoTailFileId: null });
  });

  it('exports Flow scenes with one-based numbering and prompts', async () => {
    const project = await seedProjectWithScenes();

    const exported = exportScenesJson(project);

    expect(exported).toEqual([
      expect.objectContaining({ sceneId: 1, sceneNumber: 1, prompt: 'A door', assetType: 'image', motionPrompt: '' }),
      expect.objectContaining({ sceneId: 2, sceneNumber: 2, prompt: 'A room', assetType: 'image' }),
      expect.objectContaining({ sceneId: 3, sceneNumber: 3, prompt: 'A window', assetType: 'image' }),
    ]);
  });

  it('exports the stored motion prompt for a video scene', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video', motionPrompt: 'Slow dolly toward the subject.' });

    const exported = exportScenesJson(await getProject(project.id));

    expect(exported[1]).toMatchObject({ assetType: 'video', motionPrompt: 'Slow dolly toward the subject.' });
  });

  it('imports a valid root-level image and applies its file reference', async () => {
    const project = await seedProjectWithScenes();

    const result = await importAssetsFromZip(project.id, validZip());

    expect(result).toEqual({ updated: 1, skipped: [] });
    const updated = await getProject(project.id);
    expect(updated.scenes[0]!.assetFileId).toEqual(expect.any(String));
    expect(await getCollection<{ projectId: string; originalName: string }>('files').findOne({ projectId: project.id })).toMatchObject({ originalName: 'SCENE_001_Opening.png' });
  });

  it('imports both a video and its keyframe image for a video scene', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video' });
    configureAssetModule(filesDir, undefined, { probeVideoDuration: async () => 1.25, extractLastFrame: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]) });
    const zip = new AdmZip();
    zip.addFile('SCENE_002_Context.mp4', Buffer.from('video'));
    zip.addFile('SCENE_002_Context.png', Buffer.from('keyframe'));

    const result = await importAssetsFromZip(project.id, zip.toBuffer());

    expect(result).toEqual({ updated: 1, skipped: [] });
    expect((await getProject(project.id)).scenes[1]).toMatchObject({
      assetType: 'video',
      assetFileId: expect.any(String),
      videoKeyframeFileId: expect.any(String),
      videoTailFileId: expect.any(String),
      videoDurationSec: 1.25,
    });
    const updated = await getProject(project.id);
    const tailId = updated.scenes[1]!.videoTailFileId;
    expect(tailId).toEqual(expect.any(String));
    if (!tailId) throw new Error('Expected an imported video tail file.');
    expect(await getCollection<{ _id: string; originalName: string; mimeType: string; purpose: string }>('files').findOne({ _id: tailId })).toMatchObject({ originalName: 'SCENE_002_Context.tail.png', mimeType: 'image/png', purpose: 'reference' });
  });

  it('keeps a video when tail extraction fails and records an explicit null tail', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video' });
    configureAssetModule(filesDir, undefined, {
      probeVideoDuration: async () => 1.25,
      extractLastFrame: async () => { throw new Error('tail extraction failed'); },
    });
    const zip = new AdmZip();
    zip.addFile('SCENE_002_Context.mp4', Buffer.from('video'));

    const result = await importAssetsFromZip(project.id, zip.toBuffer());

    expect(result).toEqual({ updated: 1, skipped: [] });
    expect((await getProject(project.id)).scenes[1]).toMatchObject({ assetFileId: expect.any(String), videoDurationSec: 1.25, videoTailFileId: null });
    expect(result.skipped).not.toContain('SCENE_002_Context.mp4');
  });

  it('clears a previous tail when a video is re-imported and extraction fails', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video' });
    configureAssetModule(filesDir, undefined, { probeVideoDuration: async () => 1.25, extractLastFrame: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]) });
    const firstZip = new AdmZip();
    firstZip.addFile('SCENE_002_First.mp4', Buffer.from('video'));
    await importAssetsFromZip(project.id, firstZip.toBuffer());
    expect((await getProject(project.id)).scenes[1]!.videoTailFileId).toEqual(expect.any(String));

    configureAssetModule(filesDir, undefined, { probeVideoDuration: async () => 2, extractLastFrame: async () => { throw new Error('tail extraction failed'); } });
    const secondZip = new AdmZip();
    secondZip.addFile('SCENE_002_Replacement.mp4', Buffer.from('video'));

    await expect(importAssetsFromZip(project.id, secondZip.toBuffer())).resolves.toEqual({ updated: 1, skipped: [] });
    expect((await getProject(project.id)).scenes[1]).toMatchObject({ videoDurationSec: 2, videoTailFileId: null });
  });

  it('leaves an existing tail untouched when importing only a video keyframe', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video', videoKeyframeFileId: 'old-keyframe', videoTailFileId: 'existing-tail', videoDurationSec: 1.25 });
    const zip = new AdmZip();
    zip.addFile('SCENE_002_Context.png', Buffer.from('keyframe'));

    await expect(importAssetsFromZip(project.id, zip.toBuffer())).resolves.toEqual({ updated: 1, skipped: [] });
    expect((await getProject(project.id)).scenes[1]).toMatchObject({ videoKeyframeFileId: expect.any(String), videoTailFileId: 'existing-tail', videoDurationSec: 1.25 });
  });

  it('clears the tail when a video scene switches to an image', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video', videoTailFileId: 'tail-1', videoDurationSec: 1.25 });

    const updated = await patchProjectScene(project.id, 'scene-2', { assetType: 'image' });

    expect(updated.scenes[1]).toMatchObject({ assetType: 'image', videoKeyframeFileId: null, videoTailFileId: null, videoDurationSec: null });
  });

  it('skips a video whose duration probe fails without losing its companion keyframe', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video' });
    configureAssetModule(filesDir, undefined, {
      probeVideoDuration: async () => { throw new Error('corrupt video'); },
    });
    const zip = new AdmZip();
    zip.addFile('SCENE_002_Context.png', Buffer.from('keyframe'));
    zip.addFile('SCENE_002_Context.mp4', Buffer.from('corrupt video'));

    await expect(importAssetsFromZip(project.id, zip.toBuffer())).resolves.toEqual({
      updated: 1,
      skipped: ['SCENE_002_Context.mp4'],
    });
    expect((await getProject(project.id)).scenes[1]).toMatchObject({
      assetFileId: null,
      videoKeyframeFileId: expect.any(String),
      videoDurationSec: null,
    });
  });

  it('keeps image scenes strict when a video and image share a scene number', async () => {
    const project = await seedProjectWithScenes();
    const zip = new AdmZip();
    zip.addFile('SCENE_001_Opening.mp4', Buffer.from('video'));
    zip.addFile('SCENE_001_Opening.png', Buffer.from('image'));

    const result = await importAssetsFromZip(project.id, zip.toBuffer());

    expect(result).toEqual({ updated: 1, skipped: ['SCENE_001_Opening.mp4'] });
    expect((await getProject(project.id)).scenes[0]).toMatchObject({ assetType: 'image', assetFileId: expect.any(String) });
  });

  it('requests depth maps only for imported image scenes', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video' });
    const requested: string[] = [];
    configureAssetModule(filesDir, async (_projectId, sceneId) => { requested.push(sceneId); }, { probeVideoDuration: async () => 1.25 });
    const zip = new AdmZip();
    zip.addFile('SCENE_001_Opening.png', Buffer.from('image'));
    zip.addFile('SCENE_002_Context.mp4', Buffer.from('video'));
    zip.addFile('SCENE_002_Context.png', Buffer.from('keyframe'));

    await importAssetsFromZip(project.id, zip.toBuffer());

    expect(requested).toEqual(['scene-1']);
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

  it('skips mixed invalid, unsupported, out-of-range, and type-mismatched entries', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video' });
    const zip = new AdmZip();
    zip.addFile('SCENE_001_Opening.png', Buffer.from('valid'));
    zip.addFile('SCENE_002_WrongType.png', Buffer.from('wrong-type'));
    zip.addFile('SCENE_999_TooFar.png', Buffer.from('too-far'));
    zip.addFile('not-a-scene.txt', Buffer.from('bad-name'));
    zip.addFile('SCENE_003_Unsupported.gif', Buffer.from('unsupported'));
    zip.addFile('nested/SCENE_001_Ignored.png', Buffer.from('nested'));

    const result = await importAssetsFromZip(project.id, zip.toBuffer());

    expect(result.updated).toBe(2);
    expect(result.skipped).toHaveLength(3);
    expect(result.skipped).toEqual(expect.arrayContaining([
      'SCENE_999_TooFar.png',
      'not-a-scene.txt',
      'SCENE_003_Unsupported.gif',
    ]));
    expect((await getProject(project.id)).scenes[0]!.assetFileId).toEqual(expect.any(String));
    expect((await getProject(project.id)).scenes[1]!).toMatchObject({ assetFileId: null, videoKeyframeFileId: expect.any(String) });
  });

  it('uses the last duplicate scene entry and overwrites on re-import', async () => {
    const project = await seedProjectWithScenes();
    const duplicateZip = new AdmZip();
    duplicateZip.addFile('SCENE_001_First.png', Buffer.from('first'));
    duplicateZip.addFile('SCENE_001_Last.png', Buffer.from('last'));

    const firstImport = await importAssetsFromZip(project.id, duplicateZip.toBuffer());
    const first = await getProject(project.id);
    const firstId = first.scenes[0]!.assetFileId;
    expect(firstImport.updated).toBe(1);
    expect(firstId).toEqual(expect.any(String));
    if (!firstId) throw new Error('Expected an imported file id.');
    expect(await getCollection<{ _id: string; originalName: string }>('files').findOne({ _id: firstId })).toMatchObject({ originalName: 'SCENE_001_Last.png' });

    const replacementZip = new AdmZip();
    replacementZip.addFile('SCENE_001_Replacement.png', Buffer.from('replacement'));
    const secondImport = await importAssetsFromZip(project.id, replacementZip.toBuffer());
    const second = await getProject(project.id);
    expect(secondImport).toEqual({ updated: 1, skipped: [] });
    expect(second.scenes[0]!.assetFileId).not.toBe(firstId);
  });

  it('skips an entry whose payload cannot be extracted and continues importing', async () => {
    const project = await seedProjectWithScenes();
    const zip = new AdmZip();
    zip.addFile('SCENE_001_Broken.png', Buffer.from('broken'));
    zip.addFile('SCENE_002_Valid.png', Buffer.from('valid'));
    const buffer = zip.toBuffer();
    const localSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const localOffset = buffer.indexOf(localSignature);
    const centralOffset = buffer.indexOf(centralSignature);
    buffer.writeUInt16LE(99, localOffset + 8);
    buffer.writeUInt16LE(99, centralOffset + 10);

    const result = await importAssetsFromZip(project.id, buffer);

    expect(result.updated).toBe(1);
    expect(result.skipped).toEqual(['SCENE_001_Broken.png']);
    expect((await getProject(project.id)).scenes[0]!.assetFileId).toBeNull();
    expect((await getProject(project.id)).scenes[1]!.assetFileId).toEqual(expect.any(String));
  });

  it('maps a malformed central directory to INVALID_ZIP', async () => {
    const project = await seedProjectWithScenes();

    await expect(importAssetsFromZip(project.id, zipWithCorruptCentralDirectory()))
      .rejects.toMatchObject({ code: 'INVALID_ZIP', status: 422 });
  });

  it('clears asset references when duplicating a project', async () => {
    const project = await seedProjectWithScenes();
    await applySceneAssets(project.id, [{ sceneId: 'scene-1', assetFileId: 'file-1', videoTailFileId: 'tail-1' }]);

    const duplicate = await duplicateProject(project.id);

    expect(duplicate.scenes.map((scene) => scene.assetFileId)).toEqual([null, null, null]);
    expect(duplicate.scenes.map((scene) => scene.videoTailFileId)).toEqual([null, null, null]);
  });

  it('returns no updates for an empty ZIP and rejects malformed ZIP data', async () => {
    const project = await seedProjectWithScenes();
    const emptyZip = new AdmZip().toBuffer();
    const before = await getProject(project.id);

    await expect(importAssetsFromZip(project.id, emptyZip)).resolves.toEqual({ updated: 0, skipped: [] });
    expect((await getProject(project.id)).version).toBe(before.version);
    await expect(importAssetsFromZip(project.id, Buffer.from('not a zip'))).rejects.toMatchObject({ code: 'INVALID_ZIP', status: 422 });
  });

  it('patches a scene through the route and validates an empty patch', async () => {
    const project = await seedProjectWithScenes();
    const base = await startAssetServer();

    const patched = await fetch(`${base}/api/project/${project.id}/scenes/scene-1`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visualPrompt: 'Updated prompt', sfxPrompt: 'tiếng gió', motionPrompt: 'Slow camera push-in.' }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json() as { scenes: Array<{ visualPrompt: string; sfxPrompt: string; motionPrompt: string }> }).scenes[0]).toMatchObject({ visualPrompt: 'Updated prompt', sfxPrompt: 'tiếng gió', motionPrompt: 'Slow camera push-in.' });

    const rejected = await fetch(`${base}/api/project/${project.id}/scenes/scene-1`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: { code: 'validation_error' } });
  });

  it('maps an asset ZIP over the 200 MB limit to FILE_TOO_LARGE', async () => {
    const project = await seedProjectWithScenes();
    const base = await startAssetServer();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(200 * 1024 * 1024 + 1)], { type: 'application/zip' }), 'large.zip');

    const response = await fetch(`${base}/api/project/${project.id}/scenes/import-assets`, { method: 'POST', body: form });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'FILE_TOO_LARGE' } });
  }, 60_000);
});
