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
  replaceProjectChapters,
  replaceProjectScenes,
  setSceneWordTimings,
  setProjectScenesAssetType,
  setProjectSceneActive,
  type ProjectDoc,
} from '../project';
import { applyVideoDistribution, configureAssetModule, exportScenesJson, fitSceneToClip, importAssetsFromZip, previewVideoDistribution, removeSceneAsset, requestDepthMapsForImageScenes, uploadSceneAssets } from './index';

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

function uploadFile(originalname: string, mimetype: string, content = originalname): Express.Multer.File {
  const buffer = Buffer.from(content);
  return { fieldname: 'files', originalname, encoding: '7bit', mimetype, size: buffer.byteLength, buffer, destination: '', filename: '', path: '', stream: undefined as never };
}

describe('asset contracts', () => {
  it('uploads an image scene asset and requests its depth map', async () => {
    const project = await seedProjectWithScenes();
    const requested: string[] = [];
    configureAssetModule(filesDir, async (_projectId, sceneId) => { requested.push(sceneId); });

    const result = await uploadSceneAssets(project.id, 'scene-1', [uploadFile('still.png', 'image/png')]);

    expect(result).toMatchObject({ sceneId: 'scene-1', updated: { assetFileId: expect.any(String) }, files: [{ originalName: 'still.png' }] });
    expect((await getProject(project.id)).scenes[0]).toMatchObject({ assetFileId: result.updated.assetFileId, depthMap: null });
    expect(requested).toEqual(['scene-1']);
  });

  it('uploads a video clip and keyframe atomically, with duration and extracted tail', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video' });
    configureAssetModule(filesDir, undefined, { probeVideoDuration: async () => 8.25, extractLastFrame: async () => Buffer.from('tail') });

    const result = await uploadSceneAssets(project.id, 'scene-2', [uploadFile('key.png', 'image/png'), uploadFile('clip.mp4', 'video/mp4')]);

    expect(result.updated).toMatchObject({ assetFileId: expect.any(String), videoKeyframeFileId: expect.any(String), videoTailFileId: expect.any(String), videoDurationSec: 8.25 });
    expect(result.files.map((file) => file.originalName)).toEqual(expect.arrayContaining(['key.png', 'clip.mp4', 'clip.tail.png']));
    expect((await getProject(project.id)).scenes[1]).toMatchObject(result.updated);
  });

  it('cleans every newly stored file when the atomic project mutation fails', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video' });
    configureAssetModule(filesDir, undefined, {
      probeVideoDuration: async () => 2,
      extractLastFrame: async () => Buffer.from('tail'),
      applySceneAssets: async () => { throw new Error('conflict'); },
    });

    await expect(uploadSceneAssets(project.id, 'scene-2', [uploadFile('clip.mp4', 'video/mp4'), uploadFile('key.png', 'image/png')])).rejects.toThrow('conflict');
    expect(await getCollection('files').countDocuments({ projectId: project.id })).toBe(0);
  });

  it('rejects a concurrent scene change and cleans the clip and extracted tail', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video' });
    configureAssetModule(filesDir, undefined, {
      probeVideoDuration: async () => {
        const current = await getProject(project.id);
        await setProjectSceneActive(project.id, 'scene-2', false, current.version);
        return 2;
      },
      extractLastFrame: async () => Buffer.from('tail'),
    });

    await expect(uploadSceneAssets(project.id, 'scene-2', [uploadFile('clip.mp4', 'video/mp4')])).rejects.toMatchObject({ status: 409, code: 'PROJECT_CHANGED' });
    expect((await getProject(project.id)).scenes[1]).toMatchObject({ active: false, assetFileId: null, videoTailFileId: null });
    expect(await getCollection('files').countDocuments({ projectId: project.id })).toBe(0);
  });

  it('replaces only the clip, deletes the old clip and tail, and preserves the keyframe', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video' });
    configureAssetModule(filesDir, undefined, { probeVideoDuration: async () => 2, extractLastFrame: async () => Buffer.from('old-tail') });
    const oldClip = await uploadSceneAssets(project.id, 'scene-2', [uploadFile('old.mp4', 'video/mp4')]);
    const oldKey = await uploadSceneAssets(project.id, 'scene-2', [uploadFile('old-key.png', 'image/png')]);
    const oldTailId = oldClip.updated.videoTailFileId;
    if (!oldClip.updated.assetFileId || !oldTailId) throw new Error('Expected stored clip and tail IDs.');
    configureAssetModule(filesDir, undefined, { probeVideoDuration: async () => 3, extractLastFrame: async () => Buffer.from('new-tail') });

    const result = await uploadSceneAssets(project.id, 'scene-2', [uploadFile('new.mp4', 'video/mp4')]);
    const current = (await getProject(project.id)).scenes[1]!;

    expect(current.videoKeyframeFileId).toBe(oldKey.updated.videoKeyframeFileId);
    expect(current.assetFileId).toBe(result.updated.assetFileId);
    expect(await getCollection<{ _id: string }>('files').findOne({ _id: oldClip.updated.assetFileId })).toBeNull();
    expect(await getCollection<{ _id: string }>('files').findOne({ _id: oldTailId })).toBeNull();
  });

  it('replaces only the keyframe, deletes the old keyframe, and preserves clip and tail', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video' });
    configureAssetModule(filesDir, undefined, { probeVideoDuration: async () => 2, extractLastFrame: async () => Buffer.from('tail') });
    const oldClip = await uploadSceneAssets(project.id, 'scene-2', [uploadFile('old.mp4', 'video/mp4')]);
    const oldKey = await uploadSceneAssets(project.id, 'scene-2', [uploadFile('old-key.png', 'image/png')]);
    if (!oldKey.updated.videoKeyframeFileId) throw new Error('Expected stored keyframe ID.');

    const result = await uploadSceneAssets(project.id, 'scene-2', [uploadFile('new-key.png', 'image/png')]);
    const current = (await getProject(project.id)).scenes[1]!;

    expect(current.assetFileId).toBe(oldClip.updated.assetFileId);
    expect(current.videoTailFileId).toBe(oldClip.updated.videoTailFileId);
    expect(current.videoKeyframeFileId).toBe(result.updated.videoKeyframeFileId);
    expect(await getCollection<{ _id: string }>('files').findOne({ _id: oldKey.updated.videoKeyframeFileId })).toBeNull();
  });

  it('keeps displaced files for every supported project reference field', async () => {
    const references: Array<[string, (fileId: string) => Record<string, unknown>]> = [
      ['render', (fileId) => ({ renderFileId: fileId })],
      ['draft render', (fileId) => ({ draftRenderFileId: fileId })],
      ['BGM', (fileId) => ({ bgmFileId: fileId })],
      ['logo', (fileId) => ({ logoFileId: fileId })],
      ['custom style', (fileId) => ({ customStyleReferenceFileId: fileId })],
      ['SEO thumbnail', (fileId) => ({ 'seo.thumbnail.fileId': fileId })],
      ['scene audio', (fileId) => ({ 'scenes.1.audioFileId': fileId })],
      ['scene SFX', (fileId) => ({ 'scenes.1.sfxFileId': fileId })],
      ['word timings', (fileId) => ({ 'scenes.1.wordTimings': { audioFileId: fileId, words: [] } })],
      ['name analysis', (fileId) => ({ 'scenes.1.nameCandidates': { narrationHash: 'hash', audioFileId: fileId, provider: 'deepseek', model: 'model', generatedAt: '2026-10-20T00:00:00.000Z', candidates: [] } })],
      ['popup plan', (fileId) => ({ 'scenes.1.popupPlan': { narrationHash: 'hash', audioFileId: fileId, provider: 'deepseek', model: 'model', backend: 'api', density: 'low', generatedAt: '2026-10-20T00:00:00.000Z', needed: false, reason: 'none', popups: [], dropped: [] } })],
      ['depth source', (fileId) => ({ 'scenes.2.depthMap': { assetFileId: fileId, fileId: 'other-depth-file', score: 1 } })],
      ['depth image', (fileId) => ({ 'scenes.2.depthMap': { assetFileId: 'other-source-file', fileId, score: 1 } })],
    ];

    for (const [label, reference] of references) {
      const project = await seedProjectWithScenes();
      const first = await uploadSceneAssets(project.id, 'scene-1', [uploadFile(`${label}.png`, 'image/png')]);
      const sharedId = first.updated.assetFileId!;
      await getCollection<ProjectDoc>('projects').updateOne({ _id: project.id }, { $set: reference(sharedId) });

      await uploadSceneAssets(project.id, 'scene-1', [uploadFile('replacement.png', 'image/png')]);

      expect(await getCollection<{ _id: string }>('files').findOne({ _id: sharedId }), label).not.toBeNull();
    }
  });

  it('deletes asset metadata and image depth but keyframe deletion affects only video keyframes', async () => {
    const project = await seedProjectWithScenes();
    const image = await uploadSceneAssets(project.id, 'scene-1', [uploadFile('image.png', 'image/png')]);
    await getCollection<ProjectDoc>('projects').updateOne({ _id: project.id }, { $set: { 'scenes.0.depthMap': { assetFileId: image.updated.assetFileId, fileId: image.updated.assetFileId, score: 1 } } });

    const removedImage = await removeSceneAsset(project.id, 'scene-1', 'asset');
    expect(removedImage.updated).toMatchObject({ assetFileId: null, videoTailFileId: null, videoDurationSec: null });
    expect((await getProject(project.id)).scenes[0]).toMatchObject({ assetFileId: null, depthMap: null });

    await patchProjectScene(project.id, 'scene-2', { assetType: 'video' });
    configureAssetModule(filesDir, undefined, { probeVideoDuration: async () => 2, extractLastFrame: async () => Buffer.from('tail') });
    const uploaded = await uploadSceneAssets(project.id, 'scene-2', [uploadFile('clip.mp4', 'video/mp4'), uploadFile('key.png', 'image/png')]);
    const removedKey = await removeSceneAsset(project.id, 'scene-2', 'keyframe');
    expect(removedKey.updated).toEqual({ videoKeyframeFileId: null });
    expect((await getProject(project.id)).scenes[1]).toMatchObject({ assetFileId: uploaded.updated.assetFileId, videoTailFileId: uploaded.updated.videoTailFileId, videoKeyframeFileId: null });
    await expect(removeSceneAsset(project.id, 'scene-1', 'keyframe')).rejects.toMatchObject({ status: 422, code: 'KEYFRAME_REQUIRES_VIDEO' });
    const versionBeforeNoop = (await getProject(project.id)).version;
    await expect(removeSceneAsset(project.id, 'scene-1', 'asset')).resolves.toMatchObject({ updated: { assetFileId: null } });
    expect((await getProject(project.id)).version).toBe(versionBeforeNoop);
    const versionBeforeKeyframeNoop = (await getProject(project.id)).version;
    await expect(removeSceneAsset(project.id, 'scene-2', 'keyframe')).resolves.toMatchObject({ updated: { videoKeyframeFileId: null } });
    expect((await getProject(project.id)).version).toBe(versionBeforeKeyframeNoop);
  });

  it('rejects invalid combinations and inactive scenes before storing files', async () => {
    const project = await seedProjectWithScenes();
    await expect(uploadSceneAssets(project.id, 'scene-1', [])).rejects.toMatchObject({ code: 'FILES_REQUIRED' });
    await expect(uploadSceneAssets(project.id, 'missing-scene', [uploadFile('still.png', 'image/png')])).rejects.toMatchObject({ status: 404, code: 'not_found' });
    await expect(uploadSceneAssets(project.id, 'scene-1', [uploadFile('empty.png', 'image/png', '')])).rejects.toMatchObject({ code: 'EMPTY_FILE' });
    await expect(uploadSceneAssets(project.id, 'scene-1', [uploadFile('clip.mp4', 'video/mp4')])).rejects.toMatchObject({ code: 'IMAGE_SCENE_REQUIRES_IMAGE' });
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video' });
    await expect(uploadSceneAssets(project.id, 'scene-2', [uploadFile('a.png', 'image/png'), uploadFile('b.jpg', 'image/jpeg')])).rejects.toMatchObject({ code: 'DUPLICATE_ASSET_KIND' });
    await expect(uploadSceneAssets(project.id, 'scene-2', [uploadFile('a.mp4', 'video/mp4'), uploadFile('b.webm', 'video/webm')])).rejects.toMatchObject({ code: 'DUPLICATE_ASSET_KIND' });
    await expect(uploadSceneAssets(project.id, 'scene-2', [uploadFile('fake.png', 'video/mp4')])).rejects.toMatchObject({ code: 'FILE_TYPE_MISMATCH' });
    await setProjectSceneActive(project.id, 'scene-2', false);
    await expect(uploadSceneAssets(project.id, 'scene-2', [uploadFile('key.png', 'image/png')])).rejects.toMatchObject({ status: 409, code: 'SCENE_INACTIVE' });
    await expect(removeSceneAsset(project.id, 'scene-2', 'asset')).rejects.toMatchObject({ status: 409, code: 'SCENE_INACTIVE' });
    expect(await getCollection('files').countDocuments({ projectId: project.id })).toBe(0);
  });

  it('cleans a stored clip after probe failure and rejects oversized images before storage', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video' });
    configureAssetModule(filesDir, undefined, { probeVideoDuration: async () => { throw new Error('bad clip'); } });
    await expect(uploadSceneAssets(project.id, 'scene-2', [uploadFile('bad.mp4', 'video/mp4')])).rejects.toMatchObject({ status: 422, code: 'VIDEO_PROBE_FAILED', message: 'Không thể đọc thời lượng video.' });
    await expect(uploadSceneAssets(project.id, 'scene-1', [uploadFile('large.png', 'image/png', 'x'.repeat(25 * 1024 * 1024 + 1))])).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    expect(await getCollection('files').countDocuments({ projectId: project.id })).toBe(0);
  });

  it('logs cleanup failures without failing a successful replacement', async () => {
    const project = await seedProjectWithScenes();
    const first = await uploadSceneAssets(project.id, 'scene-1', [uploadFile('old.png', 'image/png')]);
    configureAssetModule(filesDir, undefined, { deleteFile: async () => { throw new Error('locked file'); } });

    await expect(uploadSceneAssets(project.id, 'scene-1', [uploadFile('new.png', 'image/png')])).resolves.toMatchObject({ updated: { assetFileId: expect.any(String) } });
    expect(await getCollection<{ _id: string }>('files').findOne({ _id: first.updated.assetFileId! })).not.toBeNull();
  });

  it('serves multipart upload and slot deletion routes with stable errors', async () => {
    const project = await seedProjectWithScenes();
    const base = await startAssetServer();
    const form = new FormData();
    form.append('files', new Blob(['png'], { type: 'image/png' }), 'still.png');
    const uploaded = await fetch(`${base}/api/project/${project.id}/scenes/scene-1/assets`, { method: 'POST', body: form });
    expect(uploaded.status).toBe(200);
    expect(await uploaded.json()).toMatchObject({ sceneId: 'scene-1', updated: { assetFileId: expect.any(String) } });
    expect((await fetch(`${base}/api/project/${project.id}/scenes/scene-1/assets?slot=asset`, { method: 'DELETE' })).status).toBe(200);
    const bad = await fetch(`${base}/api/project/${project.id}/scenes/scene-1/assets?slot=other`, { method: 'DELETE' });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: { code: 'validation_error' } });

    const tooMany = new FormData();
    for (const name of ['a.png', 'b.png', 'c.png']) tooMany.append('files', new Blob(['png'], { type: 'image/png' }), name);
    const tooManyResponse = await fetch(`${base}/api/project/${project.id}/scenes/scene-1/assets`, { method: 'POST', body: tooMany });
    expect(tooManyResponse.status).toBe(400);
    expect(await tooManyResponse.json()).toMatchObject({ error: { code: 'TOO_MANY_FILES' } });

    const missingForm = new FormData();
    missingForm.append('files', new Blob(['png'], { type: 'image/png' }), 'still.png');
    const missing = await fetch(`${base}/api/project/${project.id}/scenes/missing-scene/assets`, { method: 'POST', body: missingForm });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: 'not_found' } });

    await setProjectSceneActive(project.id, 'scene-2', false);
    const inactiveForm = new FormData();
    inactiveForm.append('files', new Blob(['png'], { type: 'image/png' }), 'key.png');
    const inactive = await fetch(`${base}/api/project/${project.id}/scenes/scene-2/assets`, { method: 'POST', body: inactiveForm });
    expect(inactive.status).toBe(409);
    expect(await inactive.json()).toMatchObject({ error: { code: 'SCENE_INACTIVE' } });
  });
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

  it('distributes only active scenes while retaining original scene numbers', async () => {
    const project = await seedProjectWithScenes();
    await setChapterSceneCounts(project.id, [2, 1]);
    await setProjectSceneActive(project.id, 'scene-2', false);

    const preview = await previewVideoDistribution(project.id, 100);

    expect(preview.total).toBe(2);
    expect(preview.videoCount).toBe(2);
    expect(preview.videoSceneNumbers).toEqual([1, 3]);
    expect(preview.changes.map((change) => change.sceneNumber)).toEqual([1, 3]);
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

  it('fits a scene through the strict versioned route', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-1', { assetType: 'video', assetFileId: 'clip-1', videoDurationSec: 5.2 });
    const before = await getProject(project.id);
    const base = await startAssetServer();

    const response = await fetch(`${base}/api/project/${project.id}/scenes/scene-1/fit-to-clip`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: before.version }),
    });

    expect(response.status).toBe(200);
    const responseBody = await response.json() as { scenes: Array<{ durationSec: number }> };
    expect(responseBody.scenes[0]?.durationSec).toBe(6);
    const strictResponse = await fetch(`${base}/api/project/${project.id}/scenes/scene-1/fit-to-clip`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: before.version + 1, extra: true }),
    });
    expect(strictResponse.status).toBe(422);
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

  it('uploads an image asset to a legacy scene without a stored asset type', async () => {
    const project = await createProject(projectInput);
    await getCollection<{ _id: string }>('projects').updateOne(
      { _id: project.id },
      {
        $set: {
          scenes: [{ id: 'scene-1', narration: 'Opening', visualPrompt: 'A door', durationSec: 5 }],
        },
      },
    );

    const result = await uploadSceneAssets(project.id, 'scene-1', [uploadFile('legacy.png', 'image/png')]);

    expect(result.updated.assetFileId).toEqual(expect.any(String));
    expect((await getProject(project.id)).scenes[0]).toMatchObject({ assetType: 'image', assetFileId: result.updated.assetFileId });
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

  it('edits narration atomically with duration, chapter sync, and stale voiceover cleanup', async () => {
    const project = await seedProjectWithScenes();
    await replaceProjectChapters(project.id, [{
      id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Opening', 'Context', 'Close'], status: 'approved', scenesCount: 3, durationSec: 15,
    }], null, 'assets');
    await patchProjectScene(project.id, 'scene-2', { audioFileId: 'voice-2' });
    await setSceneWordTimings(project.id, 'scene-2', 'voice-2', 'Context', { audioFileId: 'voice-2', words: [{ text: 'Context', startSec: 0, endSec: 1 }] });
    const before = await getProject(project.id);

    const updated = await patchProjectScene(project.id, 'scene-2', { narration: '  Rewritten context in detail  ' }, before.version);

    expect(updated.scenes[1]).toMatchObject({ narration: 'Rewritten context in detail', durationSec: 2, audioFileId: null, wordTimings: null, visualPrompt: 'A room' });
    expect(updated.chapters[0]).toMatchObject({ paragraphs: ['Opening', 'Rewritten context in detail', 'Close'], durationSec: 12 });
    expect(updated.version).toBe(before.version + 1);
  });

  it('fits a measured video scene to the ceil of its clip and updates the chapter total', async () => {
    const project = await seedProjectWithScenes();
    await replaceProjectChapters(project.id, [{
      id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Opening', 'Context', 'Close'], status: 'approved', scenesCount: 3, durationSec: 15,
    }], null, 'assets');
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video', assetFileId: 'clip-2', videoDurationSec: 5.2 });
    const before = await getProject(project.id);

    const updated = await fitSceneToClip(project.id, 'scene-2', before.version);

    expect(updated.scenes[1]).toMatchObject({ durationSec: 6, assetType: 'video', assetFileId: 'clip-2', videoDurationSec: 5.2 });
    expect(updated.chapters[0]).toMatchObject({ durationSec: 16 });
    expect(updated.version).toBe(before.version + 1);
  });

  it('rejects fit-to-clip when the video duration has not been measured', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-1', { assetType: 'video', assetFileId: 'clip-1', videoDurationSec: null });
    const before = await getProject(project.id);

    await expect(fitSceneToClip(project.id, 'scene-1', before.version)).rejects.toMatchObject({ status: 422, code: 'VIDEO_DURATION_UNAVAILABLE' });
  });

  it('rejects fit-to-clip for an inactive scene', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video', assetFileId: 'clip-2', videoDurationSec: 9 });
    await setProjectSceneActive(project.id, 'scene-2', false);

    await expect(fitSceneToClip(project.id, 'scene-2', project.version)).rejects.toMatchObject({ status: 409, code: 'SCENE_INACTIVE' });
  });

  it('rejects fit-to-clip from a stale project version without changing the scene', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-1', { assetType: 'video', assetFileId: 'clip-1', videoDurationSec: 5.2 });
    const before = await getProject(project.id);
    await patchProjectScene(project.id, 'scene-1', { visualPrompt: 'Changed after preview' });

    await expect(fitSceneToClip(project.id, 'scene-1', before.version)).rejects.toMatchObject({ status: 409, code: 'PROJECT_CHANGED' });
    expect((await getProject(project.id)).scenes[0]).toMatchObject({ durationSec: 5, visualPrompt: 'Changed after preview' });
  });

  it('rejects a narration patch based on a stale project version', async () => {
    const project = await seedProjectWithScenes();
    await expect(patchProjectScene(project.id, 'scene-1', { narration: 'New narration' }, project.version)).resolves.toMatchObject({ version: project.version + 1 });
    await expect(patchProjectScene(project.id, 'scene-1', { narration: 'Stale narration' }, project.version)).rejects.toMatchObject({ status: 409, code: 'PROJECT_CHANGED' });
  });

  it('sets the asset type for every scene in one project update', async () => {
    const project = await seedProjectWithScenes();

    const updated = await setProjectScenesAssetType(project.id, 'video');

    expect(updated.scenes.every((scene) => scene.assetType === 'video')).toBe(true);
    expect(updated.version).toBe(project.version + 1);
  });

  it('changes asset type only for active scenes', async () => {
    const project = await seedProjectWithScenes();
    await setProjectSceneActive(project.id, 'scene-2', false);

    const updated = await setProjectScenesAssetType(project.id, 'video');

    expect(updated.scenes.map((scene) => scene.assetType)).toEqual(['video', 'image', 'video']);
    expect(updated.scenes[1]!.active).toBe(false);
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

  it('exports reference tags from persisted scene plans and omits them for legacy scenes', async () => {
    const project = await seedProjectWithScenes();
    const planned = {
      ...project,
      scenes: project.scenes.map((scene, index) => index === 0
        ? { ...scene, shotType: 'wide' as const, lightType: 'interior' as const }
        : index === 1
          ? { ...scene, shotType: 'detail' as const, lightType: 'firelight' as const }
          : scene),
    };

    const exported = exportScenesJson(planned);

    expect(exported[0]).toEqual(expect.objectContaining({ prompt: 'A door', motionPrompt: '', referenceTags: ['core', 'interior', 'wide'] }));
    expect(exported[1]).toEqual(expect.objectContaining({ prompt: 'A room', assetType: 'image', referenceTags: ['core', 'night', 'props'] }));
    expect(exported[2]).not.toHaveProperty('referenceTags');
  });

  it('omits inactive scenes from Flow export without renumbering active scenes', async () => {
    const project = await seedProjectWithScenes();
    await setProjectSceneActive(project.id, 'scene-2', false);

    const exported = exportScenesJson(await getProject(project.id));

    expect(exported.map((scene) => scene.sceneNumber)).toEqual([1, 3]);
    expect(exported.map((scene) => scene.sceneId)).toEqual([1, 3]);
  });

  it('skips ZIP assets for inactive scenes and reports the skipped count', async () => {
    const project = await seedProjectWithScenes();
    await setProjectSceneActive(project.id, 'scene-2', false);
    const zip = new AdmZip();
    zip.addFile('SCENE_002_Context.png', Buffer.from('inactive asset'));

    const result = await importAssetsFromZip(project.id, zip.toBuffer());

    expect(result).toEqual({ updated: 0, skipped: ['SCENE_002_Context.png: Scene đang tắt.'], skippedInactive: 1 });
    expect((await getProject(project.id)).scenes[1]!.assetFileId).toBeNull();
    expect(await getCollection<{ _id: string }>('files').countDocuments({ projectId: project.id })).toBe(0);
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

    expect(result).toEqual({ updated: 1, skipped: [], skippedInactive: 0 });
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

    expect(result).toEqual({ updated: 1, skipped: [], skippedInactive: 0 });
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

    expect(result).toEqual({ updated: 1, skipped: [], skippedInactive: 0 });
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

    await expect(importAssetsFromZip(project.id, secondZip.toBuffer())).resolves.toEqual({ updated: 1, skipped: [], skippedInactive: 0 });
    expect((await getProject(project.id)).scenes[1]).toMatchObject({ videoDurationSec: 2, videoTailFileId: null });
  });

  it('leaves an existing tail untouched when importing only a video keyframe', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-2', { assetType: 'video', videoKeyframeFileId: 'old-keyframe', videoTailFileId: 'existing-tail', videoDurationSec: 1.25 });
    const zip = new AdmZip();
    zip.addFile('SCENE_002_Context.png', Buffer.from('keyframe'));

    await expect(importAssetsFromZip(project.id, zip.toBuffer())).resolves.toEqual({ updated: 1, skipped: [], skippedInactive: 0 });
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
      skippedInactive: 0,
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

    expect(result).toEqual({ updated: 1, skipped: ['SCENE_001_Opening.mp4'], skippedInactive: 0 });
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

  it('does not enqueue depth maps for inactive image scenes', async () => {
    const project = await seedProjectWithScenes();
    await patchProjectScene(project.id, 'scene-1', { assetFileId: 'image-1' });
    await patchProjectScene(project.id, 'scene-2', { assetFileId: 'image-2' });
    await setProjectSceneActive(project.id, 'scene-2', false);
    const requested: string[] = [];
    configureAssetModule(filesDir, async (_projectId, sceneId) => { requested.push(sceneId); });

    await requestDepthMapsForImageScenes(project.id);

    expect(requested).toEqual(['scene-1']);
  });

  it('exports JSON through the route with an attachment filename', async () => {
    const project = await seedProjectWithScenes();
    await getCollection<ProjectDoc>('projects').updateOne(
      { _id: project.id },
      { $set: { 'scenes.0.shotType': 'high-angle', 'scenes.0.lightType': 'night', 'scenes.1.active': false } },
    );
    const base = await startAssetServer();

    const response = await fetch(`${base}/api/project/${project.id}/scenes/export-json`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="scenes-export.json"');
    const exported = await response.json() as Array<Record<string, unknown>>;
    expect(exported).toHaveLength(2);
    expect(exported[0]).toMatchObject({ sceneId: 1, sceneNumber: 1, referenceTags: ['core', 'night', 'wide'] });
    expect(exported[1]).toMatchObject({ sceneId: 3, sceneNumber: 3 });
    expect(exported[1]).not.toHaveProperty('referenceTags');
  });

  it('imports a ZIP through the route and rejects non-ZIP MIME types', async () => {
    const project = await seedProjectWithScenes();
    const base = await startAssetServer();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(validZip())], { type: 'application/zip' }), 'assets.zip');

    const imported = await fetch(`${base}/api/project/${project.id}/scenes/import-assets`, { method: 'POST', body: form });
    expect(imported.status).toBe(200);
    expect(await imported.json()).toEqual({ updated: 1, skipped: [], skippedInactive: 0 });

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
    expect(secondImport).toEqual({ updated: 1, skipped: [], skippedInactive: 0 });
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
    await setProjectSceneActive(project.id, 'scene-2', false);

    const duplicate = await duplicateProject(project.id);

    expect(duplicate.scenes.map((scene) => scene.active)).toEqual([true, false, true]);
    expect(duplicate.scenes.map((scene) => scene.assetFileId)).toEqual([null, null, null]);
    expect(duplicate.scenes.map((scene) => scene.videoTailFileId)).toEqual([null, null, null]);
  });

  it('returns no updates for an empty ZIP and rejects malformed ZIP data', async () => {
    const project = await seedProjectWithScenes();
    const emptyZip = new AdmZip().toBuffer();
    const before = await getProject(project.id);

    await expect(importAssetsFromZip(project.id, emptyZip)).resolves.toEqual({ updated: 0, skipped: [], skippedInactive: 0 });
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

    const current = await getProject(project.id);
    const emptyNarration = await fetch(`${base}/api/project/${project.id}/scenes/scene-1`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ narration: '  ', expectedVersion: current.version }),
    });
    expect(emptyNarration.status).toBe(422);
    expect(await emptyNarration.json()).toMatchObject({ error: { code: 'validation_error' } });
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
