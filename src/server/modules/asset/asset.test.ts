import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileSummarySchema } from '../../../contracts/file';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import {
  applySceneAssets,
  createProject,
  getProject,
  patchProjectScene,
  replaceProjectScenes,
  setProjectScenesAssetType,
} from '../project';

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
afterAll(() => closeTestMongo());

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
});
