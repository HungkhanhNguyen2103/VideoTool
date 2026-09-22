import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeTestMongo, resetTestMongo, startTestMongo } from '../../../test-utils/mongo';
import {
  createProject,
  getProject,
  replaceProjectScenes,
  patchProjectScene,
  setProjectBgm,
  setProjectRenderFile,
} from '../project';
import { createFileStoreService } from '../file-store';
import { buildBgmFilterGraph, buildConcatArguments, buildSceneArguments, buildSceneFilterGraph, SFX_VOLUME, BGM_VOLUME } from './docs';
import { FfmpegRenderer, getVideoRenderer } from './index';
import * as videoIndex from './index';
import { configureVideoModule, generateProjectBgm, generateProjectVoiceovers, generateSceneSfx, generateSceneVoiceover, renderFullProject } from './index';

const mocks = vi.hoisted(() => ({
  synthesize: vi.fn(),
  masterAudio: vi.fn(),
  probeAudioDuration: vi.fn(),
  searchAndDownloadSfx: vi.fn(),
  searchAndDownloadBgm: vi.fn(),
}));
vi.mock('../../shared/tts', () => ({
  getTtsClient: () => ({ synthesize: mocks.synthesize }),
  masterAudio: mocks.masterAudio,
  probeAudioDuration: mocks.probeAudioDuration,
}));
vi.mock('../../shared/freesound', () => ({
  getFreesoundClient: () => ({ searchAndDownloadSfx: mocks.searchAndDownloadSfx, searchAndDownloadBgm: mocks.searchAndDownloadBgm }),
}));

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

let filesDir = '';

beforeAll(async () => {
  await startTestMongo();
  filesDir = await mkdtemp(path.join(tmpdir(), 'video-tool-module-'));
});
beforeEach(async () => {
  await resetTestMongo();
  configureVideoModule(filesDir);
  mocks.synthesize.mockReset();
  mocks.masterAudio.mockReset();
  mocks.probeAudioDuration.mockReset();
  mocks.searchAndDownloadSfx.mockReset();
  mocks.searchAndDownloadBgm.mockReset();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await closeTestMongo();
  if (filesDir) await rm(filesDir, { recursive: true, force: true });
});

async function seedProject() {
  const project = await createProject(projectInput);
  await replaceProjectScenes(project.id, [{
    id: 'scene-1', narration: 'Narration', visualPrompt: 'Visual', durationSec: 5,
    assetType: 'image', assetFileId: 'asset-1', audioFileId: null, sfxPrompt: 'wind', sfxFileId: null,
  }]);
  return getProject(project.id);
}

async function seedVoiceProject() {
  const project = await createProject(projectInput);
  await replaceProjectScenes(project.id, [
    { id: 'scene-1', narration: 'First narration', visualPrompt: 'Visual 1', durationSec: 5, assetType: 'image', assetFileId: 'asset-1', audioFileId: null, sfxPrompt: 'wind', sfxFileId: null },
    { id: 'scene-2', narration: 'Second narration', visualPrompt: 'Visual 2', durationSec: 7, assetType: 'image', assetFileId: 'asset-2', audioFileId: null, sfxPrompt: '', sfxFileId: null },
  ]);
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

    await expect(renderer.renderScenePreview(project, project.scenes[0]!)).rejects.toThrow();

    const after = (await readdir(tmpdir())).filter((name) => name.startsWith('video-tool-preview-'));
    expect(after).toEqual([...before]);
  });
});

describe('video orchestration services', () => {
  it('stores a mastered voiceover and patches the probed duration', async () => {
    const project = await seedVoiceProject();
    mocks.synthesize.mockResolvedValue(Buffer.from('voice')); 
    mocks.masterAudio.mockImplementation(async (buffer: Buffer) => buffer);
    mocks.probeAudioDuration.mockResolvedValue(2.2);

    const updated = await generateSceneVoiceover(project.id, 'scene-1');

    expect(updated).toMatchObject({ audioFileId: expect.any(String), durationSec: 3 });
    const files = await createFileStoreService(filesDir).listProjectFiles(project.id);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ purpose: 'voiceover', mimeType: 'audio/wav' });
  });

  it('keeps the previous voiceover reference and duration when regeneration fails', async () => {
    const project = await seedVoiceProject();
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'old-voice', durationSec: 9 });
    mocks.synthesize.mockRejectedValue(new Error('TTS unavailable'));

    await expect(generateSceneVoiceover(project.id, 'scene-1')).rejects.toThrow('TTS unavailable');

    const unchanged = await getProject(project.id);
    expect(unchanged.scenes[0]!).toMatchObject({ audioFileId: 'old-voice', durationSec: 9 });
  });

  it('continues batch voiceover generation after one scene fails and logs a summary', async () => {
    const project = await seedVoiceProject();
    mocks.synthesize.mockRejectedValueOnce(new Error('first failed')).mockResolvedValue(Buffer.from('voice'));
    mocks.masterAudio.mockImplementation(async (buffer: Buffer) => buffer);
    mocks.probeAudioDuration.mockResolvedValue(1.1);
    const logs: string[] = [];

    await generateProjectVoiceovers(project.id, async (message) => { logs.push(message); });

    const updated = await getProject(project.id);
    expect(updated.scenes[0]!.audioFileId).toBeNull();
    expect(updated.scenes[1]!.audioFileId).toEqual(expect.any(String));
    expect(logs.some((line) => line.includes('scene 1'))).toBe(true);
    expect(logs.some((line) => line.includes('failed'))).toBe(true);
  });

  it('does not write SFX when Freesound has no result, then stores a successful SFX hit', async () => {
    const project = await seedVoiceProject();
    mocks.searchAndDownloadSfx.mockResolvedValueOnce(null).mockResolvedValueOnce(Buffer.from('sfx'));

    await generateSceneSfx(project.id, 'scene-1');
    expect((await getProject(project.id)).scenes[0]!.sfxFileId).toBeNull();

    await generateSceneSfx(project.id, 'scene-1');
    const updated = await getProject(project.id);
    expect(updated.scenes[0]!.sfxFileId).toEqual(expect.any(String));
    const files = await createFileStoreService(filesDir).listProjectFiles(project.id);
    expect(files).toContainEqual(expect.objectContaining({ purpose: 'sfx', mimeType: 'audio/mpeg' }));
  });

  it('stores BGM and updates the project mood/file reference atomically', async () => {
    const project = await seedVoiceProject();
    mocks.searchAndDownloadBgm.mockResolvedValue(Buffer.from('bgm'));

    await generateProjectBgm(project.id, 'calm ambient');
    const updated = await getProject(project.id);

    expect(updated).toMatchObject({ bgmMood: 'calm ambient', bgmFileId: expect.any(String) });
    const files = await createFileStoreService(filesDir).listProjectFiles(project.id);
    expect(files).toContainEqual(expect.objectContaining({ purpose: 'bgm', mimeType: 'audio/mpeg' }));
  });

  it('rejects renders with one-based scene numbers when assets are missing', async () => {
    const project = await createProject(projectInput);
    await replaceProjectScenes(project.id, [{ id: 'scene-1', narration: 'Missing', visualPrompt: 'Visual', durationSec: 5, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', sfxFileId: null }]);

    await expect(renderFullProject(project.id, async () => undefined)).rejects.toMatchObject({ code: 'SCENES_NOT_READY', status: 422 });
  });

  it('stores rendered output and updates the project final file/status', async () => {
    const project = await seedProject();
    const renderer = { renderScenePreview: vi.fn(), renderFullVideo: vi.fn().mockResolvedValue(Buffer.from('mp4')) };
    vi.spyOn(videoIndex, 'getVideoRenderer').mockReturnValue(renderer);

    await renderFullProject(project.id, async () => undefined);

    const updated = await getProject(project.id);
    expect(updated).toMatchObject({ status: 'rendered', renderFileId: expect.any(String) });
    const files = await createFileStoreService(filesDir).listProjectFiles(project.id);
    expect(files).toContainEqual(expect.objectContaining({ purpose: 'render', mimeType: 'video/mp4' }));
    expect(renderer.renderFullVideo).toHaveBeenCalledOnce();
  });
});
