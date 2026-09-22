import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { closeTestMongo, resetTestMongo, startTestMongo } from '../../../test-utils/mongo';
import {
  createProject,
  getProject,
  replaceProjectScenes,
  patchProjectScene,
  setProjectBgm,
  setProjectRenderFile,
} from '../project';
import { buildBgmFilterGraph, buildConcatArguments, buildSceneArguments, buildSceneFilterGraph, SFX_VOLUME, BGM_VOLUME } from './docs';
import { FfmpegRenderer, getVideoRenderer } from './index';

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

describe('video renderer builders', () => {
  it('builds a uniform scene graph with scaling, silence, and SFX attenuation', () => {
    const graph = buildSceneFilterGraph({ durationSec: 5, width: 1920, height: 1080, fps: 30 });

    expect(graph).toContain('[0:v]scale=1920:1080');
    expect(graph).toContain(`volume=${SFX_VOLUME}`);
    expect(graph).toContain('amix=inputs=2:duration=first');
  });

  it('builds image and audio input arguments without looping SFX', () => {
    const args = buildSceneArguments({ assetType: 'image', videoPath: 'scene.png', audioPath: 'voice.wav', sfxPath: 'wind.mp3', outputPath: 'segment.mp4', durationSec: 5, width: 1920, height: 1080, fps: 30 });

    expect(args).toContain('-loop');
    expect(args).toContain('1');
    expect(args).toContain('scene.png');
    expect(args).toContain('voice.wav');
    expect(args).toContain('wind.mp3');
    expect(args).not.toContain('-stream_loop');
    const silentArgs = buildSceneArguments({ assetType: 'image', videoPath: 'scene.png', outputPath: 'silent.mp4', durationSec: 5, width: 1920, height: 1080, fps: 30 });
    expect(silentArgs.join(' ')).toContain('anullsrc');
  });

  it('builds the concat and BGM second-pass graph with fixed volume', () => {
    expect(buildConcatArguments('segments.txt', 'concat.mp4')).toEqual(['-y', '-f', 'concat', '-safe', '0', '-i', 'segments.txt', '-c', 'copy', 'concat.mp4']);
    expect(buildBgmFilterGraph(42)).toContain(`volume=${BGM_VOLUME}`);
    expect(buildBgmFilterGraph(42)).toContain('amix=inputs=2:duration=first');
  });

  it('throws the explicit not-implemented error for Remotion', async () => {
    await expect(getVideoRenderer('remotion').renderFullVideo({} as never, async () => undefined)).rejects.toMatchObject({ code: 'RENDER_ENGINE_NOT_IMPLEMENTED', status: 501 });
  });

  it('cleans the temporary preview directory when FFmpeg fails', async () => {
    const project = await seedProject();
    const renderer = new FfmpegRenderer({
      ffmpegPath: '__video_tool_missing_ffmpeg__',
      resolveFilePath: async () => ({ absolutePath: 'asset.png', mimeType: 'image/png', purpose: 'reference' }),
    });
    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('video-tool-preview-')));

    await expect(renderer.renderScenePreview(project, project.scenes[0])).rejects.toThrow();

    const after = (await readdir(tmpdir())).filter((name) => name.startsWith('video-tool-preview-'));
    expect(after).toEqual([...before]);
  });
});
