import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestMongo, resetTestMongo, startTestMongo } from '../../../test-utils/mongo';
import {
  createProject,
  getProject,
  replaceProjectScenes,
  patchProjectScene,
  setProjectBgm,
  setProjectRenderFile,
} from '../project';

const projectInput = {
  title: 'Video mutation project',
  brief: 'A valid brief for video mutation tests.',
  language: 'vi' as const,
  referencesText: '',
  scriptPresetId: 'documentary' as const,
  targetDurationSec: 60,
  chapterCount: 1,
  voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

beforeAll(() => startTestMongo());
beforeEach(() => resetTestMongo());
afterAll(() => closeTestMongo());

async function seedProject() {
  const project = await createProject(projectInput);
  await replaceProjectScenes(project.id, [{
    id: 'scene-1', narration: 'Narration', visualPrompt: 'Visual', durationSec: 5,
    assetType: 'image', assetFileId: 'asset-1', audioFileId: null, sfxPrompt: 'wind', sfxFileId: null,
  }]);
  return getProject(project.id);
}

describe('video project mutations', () => {
  it('patches scene audio, duration, and SFX fields with one version increment', async () => {
    const project = await seedProject();

    const updated = await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-1', durationSec: 8, sfxPrompt: 'clock', sfxFileId: 'sfx-1' });

    expect(updated.scenes[0]).toMatchObject({ audioFileId: 'voice-1', durationSec: 8, sfxPrompt: 'clock', sfxFileId: 'sfx-1' });
    expect(updated.version).toBe(project.version + 1);
  });

  it('updates BGM mood and file reference atomically', async () => {
    const project = await seedProject();

    const updated = await setProjectBgm(project.id, 'epic cinematic', 'bgm-1');

    expect(updated).toMatchObject({ bgmMood: 'epic cinematic', bgmFileId: 'bgm-1' });
    expect(updated.version).toBe(project.version + 1);
  });

  it('sets the final render file and rendered status atomically', async () => {
    const project = await seedProject();

    const updated = await setProjectRenderFile(project.id, 'render-1');

    expect(updated).toMatchObject({ renderFileId: 'render-1', status: 'rendered' });
    expect(updated.version).toBe(project.version + 1);
  });
});
