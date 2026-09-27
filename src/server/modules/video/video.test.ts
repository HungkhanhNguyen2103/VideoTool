import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, open, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { closeTestMongo, resetTestMongo, startTestMongo } from '../../../test-utils/mongo';
import {
  createProject,
  getProject,
  duplicateProject,
  replaceProjectScenes,
  patchProjectScene,
  setProjectBgm,
  setProjectRenderEngine,
  setProjectParallax,
  setProjectRenderFile,
  setSceneWordTimings,
  setSceneDepthMap,
} from '../project';
import { createFileStoreService } from '../file-store';
import { buildBgmFilterGraph, buildConcatArguments, buildSceneArguments, buildSceneFilterGraph, SFX_VOLUME, BGM_VOLUME } from './docs';
import { FfmpegRenderer, getVideoRenderer, RemotionRenderer } from './index';
import * as videoIndex from './index';
import { alignProjectWordTimings, configureVideoModule, generateProjectBgm, generateProjectSfx, generateProjectVoiceovers, generateSceneSfx, generateSceneVoiceover, renderFullProject } from './index';
import { createVideoRouter } from './routes';
import { enqueueJob as insertJob } from '../job';
import { jobHandlers } from '../../../worker/registry';

const mocks = vi.hoisted(() => ({
  synthesize: vi.fn(),
  masterAudio: vi.fn(),
  probeAudioDuration: vi.fn(),
  requestWhisperAlignment: vi.fn(),
  searchAndDownloadSfx: vi.fn(),
  searchAndDownloadBgm: vi.fn(),
}));
vi.mock('../../shared/tts', () => ({
  getTtsClient: () => ({ synthesize: mocks.synthesize }),
  masterAudio: mocks.masterAudio,
  probeAudioDuration: mocks.probeAudioDuration,
}));
vi.mock('../../shared/tts/align', () => ({ requestWhisperAlignment: mocks.requestWhisperAlignment }));
vi.mock('../../shared/freesound', () => ({
  getFreesoundClient: () => ({ searchAndDownloadSfx: mocks.searchAndDownloadSfx, searchAndDownloadBgm: mocks.searchAndDownloadBgm }),
}));

const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
const ffmpegAvailable = spawnSync(ffmpegPath, ['-version'], { stdio: 'ignore' }).status === 0;
const ffprobeAvailable = spawnSync(ffprobePath, ['-version'], { stdio: 'ignore' }).status === 0;
const binarySkipReason = !ffmpegAvailable && !ffprobeAvailable
  ? `missing FFmpeg (${ffmpegPath}) and ffprobe (${ffprobePath})`
  : !ffmpegAvailable ? `missing FFmpeg (${ffmpegPath})` : !ffprobeAvailable ? `missing ffprobe (${ffprobePath})` : '';

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
let server: Server | null = null;
const renderResourceLock = path.join(tmpdir(), 'video-tool-render-resource.lock');

async function acquireRenderResourceLock(): Promise<() => Promise<void>> {
  const started = Date.now();
  while (true) {
    try {
      const handle = await open(renderResourceLock, 'wx');
      return async () => { await handle.close(); await rm(renderResourceLock, { force: true }); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() - started > 120_000) throw new Error('Timed out waiting for the render resource lock.');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

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
  mocks.requestWhisperAlignment.mockReset();
  mocks.requestWhisperAlignment.mockResolvedValue([]);
  mocks.searchAndDownloadSfx.mockReset();
  mocks.searchAndDownloadBgm.mockReset();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await closeTestMongo();
  if (filesDir) await rm(filesDir, { recursive: true, force: true });
});
afterEach(async () => {
  const current = server;
  server = null;
  if (current) await new Promise<void>((resolve) => current.close(() => resolve()));
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
  it('defaults legacy timings to null and conditionally invalidates them when audio or narration changes', async () => {
    const project = await seedProject();
    expect(project.scenes[0]!.wordTimings).toBeNull();
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-1' });
    const timing = { audioFileId: 'voice-1', words: [{ text: 'Narration', startSec: 0, endSec: 1 }] };
    expect(await setSceneWordTimings(project.id, 'scene-1', 'voice-1', 'Narration', timing)).toBe(true);
    expect(await setSceneWordTimings(project.id, 'scene-1', 'wrong-voice', 'Narration', timing)).toBe(false);
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-2' });
    expect((await getProject(project.id)).scenes[0]!.wordTimings).toBeNull();
    expect(await setSceneWordTimings(project.id, 'scene-1', 'voice-1', 'Narration', timing)).toBe(false);
    await replaceProjectScenes(project.id, [{ ...(await getProject(project.id)).scenes[0]!, narration: 'Rewritten narration' }]);
    expect((await getProject(project.id)).scenes[0]!.wordTimings).toBeNull();
  });
  it('clears all cross-project media references when duplicating a project', async () => {
    const project = await seedProject();
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-1', sfxFileId: 'sfx-1' });
    await setProjectBgm(project.id, 'calm', 'bgm-1');
    await setProjectRenderFile(project.id, 'render-1');

    const duplicate = await duplicateProject(project.id);

    expect(duplicate.renderFileId).toBeNull();
    expect(duplicate.bgmFileId).toBeNull();
    expect(duplicate.scenes[0]).toMatchObject({ assetFileId: null, audioFileId: null, sfxFileId: null });
  });

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

  it('updates the render engine with one version increment through the project API', async () => {
    const project = await seedProject();

    const remotion = await setProjectRenderEngine(project.id, 'remotion');
    expect(remotion.renderEngine).toBe('remotion');
    expect(remotion.version).toBe(project.version + 1);

    const ffmpeg = await setProjectRenderEngine(project.id, 'ffmpeg');
    expect(ffmpeg.renderEngine).toBe('ffmpeg');
    expect(ffmpeg.version).toBe(remotion.version + 1);
  });

  it('maps an unknown render-engine project to NotFound', async () => {
    await expect(setProjectRenderEngine('missing-project', 'remotion')).rejects.toMatchObject({ status: 404 });
  });

  it('persists parallax settings and clears a depth map when the source asset changes', async () => {
    const project = await seedProject();
    expect((await setProjectParallax(project.id, 'auto')).parallax).toBe('auto');
    expect(await setSceneDepthMap(project.id, 'scene-1', 'asset-1', { assetFileId: 'asset-1', fileId: 'depth-1', score: 0.95 })).toBe(true);
    await patchProjectScene(project.id, 'scene-1', { assetFileId: 'asset-2' });
    expect((await getProject(project.id)).scenes[0]!.depthMap).toBeNull();
    expect(await setSceneDepthMap(project.id, 'scene-1', 'asset-1', { assetFileId: 'asset-1', fileId: 'depth-2', score: 0.95 })).toBe(false);
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
    const videoArgs = buildSceneArguments({ assetType: 'video', videoPath: 'scene.mp4', outputPath: 'video-segment.mp4', durationSec: 5, width: 1920, height: 1080, fps: 30 });
    expect(videoArgs.join(' ')).toContain('tpad=stop_mode=clone:stop_duration=5');
  });

  it('builds the concat and BGM second-pass graph with fixed volume', () => {
    expect(buildConcatArguments('segments.txt', 'concat.mp4')).toEqual(['-y', '-f', 'concat', '-safe', '0', '-i', 'segments.txt', '-c', 'copy', 'concat.mp4']);
    expect(buildBgmFilterGraph(42)).toContain(`volume=${BGM_VOLUME}`);
    expect(buildBgmFilterGraph(42)).toContain('amix=inputs=2:duration=first');
  });

  it('selects the Remotion renderer when the project engine is remotion', () => {
    expect(getVideoRenderer('remotion')).toBeInstanceOf(RemotionRenderer);
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
  it('backfills eligible voiceovers sequentially and skips fresh timings', async () => {
    const project = await seedVoiceProject();
    const file = await createFileStoreService(filesDir).storeFile({ projectId: project.id, originalName: 'scene.wav', mimeType: 'audio/wav', buffer: Buffer.from('wav'), purpose: 'voiceover' });
    await patchProjectScene(project.id, 'scene-1', { audioFileId: file.id });
    mocks.probeAudioDuration.mockResolvedValue(2);
    mocks.requestWhisperAlignment.mockResolvedValue([
      { word: 'First', start: 0, end: 0.8, probability: 0.9 },
      { word: 'narration', start: 1, end: 1.8, probability: 0.9 },
    ]);
    const logs: string[] = [];
    const counts = await alignProjectWordTimings(project.id, async (line) => { logs.push(line); }, async () => {}, async () => false);
    expect(counts).toEqual({ aligned: 1, rejected: 0, failed: 0, stale: 0, skipped: 1 });
    expect((await getProject(project.id)).scenes[0]!.wordTimings?.words.map((word) => word.text)).toEqual(['First', 'narration']);
    expect(logs.at(-1)).toContain('"aligned":1');
    expect((await alignProjectWordTimings(project.id, async () => {}, async () => {}, async () => false)).skipped).toBe(2);
  });

  it('preserves a generated voiceover when alignment fails', async () => {
    const project = await seedVoiceProject();
    mocks.synthesize.mockResolvedValue(Buffer.from('voice'));
    mocks.masterAudio.mockImplementation(async (buffer: Buffer) => buffer);
    mocks.probeAudioDuration.mockResolvedValue(2);
    mocks.requestWhisperAlignment.mockRejectedValue(new Error('Model not downloaded'));
    const updated = await generateSceneVoiceover(project.id, 'scene-1');
    expect(updated.audioFileId).toEqual(expect.any(String));
    expect((await getProject(project.id)).scenes[0]!.wordTimings).toBeNull();
  });
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
    const progress: number[] = [];

    await generateProjectVoiceovers(project.id, async (message) => { logs.push(message); }, async (percent) => { progress.push(percent); });

    const updated = await getProject(project.id);
    expect(updated.scenes[0]!.audioFileId).toBeNull();
    expect(updated.scenes[1]!.audioFileId).toEqual(expect.any(String));
    expect(logs.some((line) => line.includes('scene 1'))).toBe(true);
    expect(logs.some((line) => line.includes('failed'))).toBe(true);
    expect(progress).toEqual([50, 100]);
  });

  it('generates project SFX sequentially and reports progress for every scene', async () => {
    const project = await seedVoiceProject();
    mocks.searchAndDownloadSfx.mockResolvedValue(Buffer.from('sfx'));
    const logs: string[] = [];
    const progress: number[] = [];

    await generateProjectSfx(project.id, async (message) => { logs.push(message); }, async (percent) => { progress.push(percent); });

    const updated = await getProject(project.id);
    expect(updated.scenes[0]!.sfxFileId).toEqual(expect.any(String));
    expect(updated.scenes[1]!.sfxFileId).toBeNull();
    expect(logs).toHaveLength(2);
    expect(progress).toEqual([50, 100]);
  });

  it('continues project SFX generation after one scene fails and logs a summary', async () => {
    const project = await seedVoiceProject();
    mocks.searchAndDownloadSfx.mockRejectedValueOnce(new Error('first failed'));
    const logs: string[] = [];
    const progress: number[] = [];

    await generateProjectSfx(project.id, async (message) => { logs.push(message); }, async (percent) => { progress.push(percent); });

    expect((await getProject(project.id)).scenes[0]!.sfxFileId).toBeNull();
    expect(logs.some((line) => line.includes('Scene 1 failed: first failed'))).toBe(true);
    expect(logs.some((line) => line.includes('SFX failed for scenes: 1'))).toBe(true);
    expect(progress).toEqual([50, 100]);
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

    await expect(renderFullProject(project.id, async () => undefined, async () => undefined)).rejects.toMatchObject({ code: 'SCENES_NOT_READY', status: 422 });
  });

  it('stores rendered output and updates the project final file/status', async () => {
    const project = await seedProject();
    const renderer = { renderScenePreview: vi.fn(), renderFullVideo: vi.fn().mockResolvedValue(Buffer.from('mp4')) };
    vi.spyOn(videoIndex, 'getVideoRenderer').mockReturnValue(renderer);
    const reportProgress = vi.fn();

    await renderFullProject(project.id, async () => undefined, reportProgress);

    const updated = await getProject(project.id);
    expect(updated).toMatchObject({ status: 'rendered', renderFileId: expect.any(String) });
    const files = await createFileStoreService(filesDir).listProjectFiles(project.id);
    expect(files).toContainEqual(expect.objectContaining({ purpose: 'render', mimeType: 'video/mp4' }));
    expect(renderer.renderFullVideo).toHaveBeenCalledOnce();
    expect(renderer.renderFullVideo).toHaveBeenCalledWith(expect.anything(), expect.any(Function), reportProgress);
  });
});

type VideoEnqueue = (input: { type: string; projectId: string; payload: unknown }) => Promise<{ id: string }>;

async function startVideoRouterServer(enqueueJob: VideoEnqueue): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use('/api/project', createVideoRouter({ enqueueJob }));
  app.use((error: { status?: number; code?: string; message?: string; name?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    void next;
    const status = error.status ?? (error.name === 'ZodError' ? 400 : 500);
    res.status(status).json({ error: { code: error.code ?? (status === 400 ? 'validation_error' : 'unknown_error'), message: error.message ?? 'error' } });
  });
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('video routes and worker handlers', () => {
  it('persists true and false keyword pop-up settings through the route', async () => {
    const project = await seedProject();
    const enqueueJob = vi.fn();
    const base = await startVideoRouterServer(enqueueJob as unknown as VideoEnqueue);

    expect(project.keywordPopupsEnabled).toBe(true);
    for (const enabled of [false, true]) {
      const response = await fetch(`${base}/api/project/${project.id}/keyword-popups`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).keywordPopupsEnabled).toBe(enabled);
      expect((await getProject(project.id)).keywordPopupsEnabled).toBe(enabled);
      if (!enabled) expect((await duplicateProject(project.id)).keywordPopupsEnabled).toBe(false);
    }

  });

  it('rejects malformed keyword pop-up settings through the route', async () => {
    const project = await seedProject();
    const enqueueJob = vi.fn();
    const base = await startVideoRouterServer(enqueueJob as unknown as VideoEnqueue);

    for (const body of [{ enabled: 'yes' }, { enabled: true, extra: true }]) {
      const response = await fetch(`${base}/api/project/${project.id}/keyword-popups`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });

  it('persists transition style through the strict route and rejects malformed bodies', async () => {
    const project = await seedProject();
    const enqueueJob = vi.fn();
    const base = await startVideoRouterServer(enqueueJob as unknown as VideoEnqueue);

    for (const style of ['crossfade', 'varied'] as const) {
      const response = await fetch(`${base}/api/project/${project.id}/transition-style`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ style }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).transitionStyle).toBe(style);
      expect((await getProject(project.id)).transitionStyle).toBe(style);
    }
    for (const body of [{ style: 'unknown' }, { style: 'varied', extra: true }]) {
      const response = await fetch(`${base}/api/project/${project.id}/transition-style`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect((await duplicateProject(project.id)).transitionStyle).toBe('varied');
  });

  it('persists film look through the strict route and copies it on duplicate', async () => {
    const project = await seedProject();
    const enqueueJob = vi.fn();
    const base = await startVideoRouterServer(enqueueJob as unknown as VideoEnqueue);

    for (const style of ['always', 'off', 'auto'] as const) {
      const response = await fetch(`${base}/api/project/${project.id}/film-look`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ style }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).filmLook).toBe(style);
      expect((await getProject(project.id)).filmLook).toBe(style);
    }
    for (const body of [{ style: 'unknown' }, { style: 'auto', extra: true }]) {
      const response = await fetch(`${base}/api/project/${project.id}/film-look`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect((await duplicateProject(project.id)).filmLook).toBe('auto');
  });

  it('persists parallax through a strict route, copies it on duplicate, and rejects malformed bodies', async () => {
    const project = await seedProject();
    const enqueueJob = vi.fn(async (input: { type: string; projectId: string; payload: unknown }) => insertJob(input));
    const base = await startVideoRouterServer(enqueueJob as unknown as VideoEnqueue);
    const response = await fetch(`${base}/api/project/${project.id}/parallax`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ style: 'auto' }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).parallax).toBe('auto');
    expect((await duplicateProject(project.id)).parallax).toBe('auto');
    for (const body of [{ style: 'bad' }, { style: 'auto', extra: true }]) {
      const invalid = await fetch(`${base}/api/project/${project.id}/parallax`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      expect(invalid.status).toBe(400);
    }
    const first = await fetch(`${base}/api/project/${project.id}/scenes/generate-depth-maps`, { method: 'POST' });
    const second = await fetch(`${base}/api/project/${project.id}/scenes/generate-depth-maps`, { method: 'POST' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(enqueueJob).toHaveBeenCalledOnce();
  });

  it('updates the render engine through the thin route and rejects invalid or missing projects', async () => {
    const project = await seedProject();
    const enqueueJob = vi.fn();
    const base = await startVideoRouterServer(enqueueJob as unknown as VideoEnqueue);

    const remotion = await fetch(`${base}/api/project/${project.id}/render-engine`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ engine: 'remotion' }),
    });
    expect(remotion.status).toBe(200);
    expect((await remotion.json())).toMatchObject({ renderEngine: 'remotion', version: project.version + 1 });

    const invalid = await fetch(`${base}/api/project/${project.id}/render-engine`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ engine: 'unknown' }),
    });
    expect(invalid.status).toBe(400);

    const missing = await fetch(`${base}/api/project/missing-project/render-engine`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ engine: 'ffmpeg' }),
    });
    expect(missing.status).toBe(404);
  });

  it('passes one configured Remotion public directory into both web and worker startup', async () => {
    const appSource = await readFile('src/server/app.ts', 'utf8');
    const workerSource = await readFile('src/worker/main.ts', 'utf8');
    expect(appSource).toContain('configureVideoModule(options.filesDir, options.remotionPublicDir)');
    expect(workerSource).toContain('configureVideoModule(config.FILES_DIR, config.REMOTION_PUBLIC_DIR)');
  });

  it('enqueues project voiceover and render jobs with the project payload', async () => {
    const project = await seedVoiceProject();
    const enqueueJob = vi.fn().mockResolvedValue({ id: 'job-1' });
    const base = await startVideoRouterServer(enqueueJob as unknown as VideoEnqueue);

    const voiceoverResponse = await fetch(`${base}/api/project/${project.id}/scenes/generate-voiceover`, { method: 'POST' });
    expect(voiceoverResponse.status).toBe(201);
    expect(await voiceoverResponse.json()).toEqual({ jobId: 'job-1' });
    const alignResponse = await fetch(`${base}/api/project/${project.id}/scenes/align-words`, { method: 'POST' });
    expect(alignResponse.status).toBe(201);
    const sfxResponse = await fetch(`${base}/api/project/${project.id}/scenes/generate-all-sfx`, { method: 'POST' });
    expect(sfxResponse.status).toBe(201);
    expect(await sfxResponse.json()).toEqual({ jobId: 'job-1' });
    await fetch(`${base}/api/project/${project.id}/render`, { method: 'POST' });
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'generate-voiceover', projectId: project.id, payload: { projectId: project.id } }));
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'align-word-timings', projectId: project.id, payload: { projectId: project.id } }));
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'generate-all-sfx', projectId: project.id, payload: { projectId: project.id } }));
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'render-full-video', projectId: project.id, payload: { projectId: project.id } }));
  });

  it('rejects an unready render before enqueueing a job', async () => {
    const project = await createProject(projectInput);
    await replaceProjectScenes(project.id, [{ id: 'scene-1', narration: 'Missing asset', visualPrompt: '', durationSec: 5, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', sfxFileId: null }]);
    const enqueueJob = vi.fn().mockResolvedValue({ id: 'job-1' });
    const base = await startVideoRouterServer(enqueueJob as unknown as VideoEnqueue);

    const response = await fetch(`${base}/api/project/${project.id}/render`, { method: 'POST' });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'SCENES_NOT_READY' } });
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('regenerates synchronously and serves a preview as video/mp4', async () => {
    const project = await seedVoiceProject();
    mocks.synthesize.mockResolvedValue(Buffer.from('voice'));
    mocks.masterAudio.mockImplementation(async (buffer: Buffer) => buffer);
    mocks.probeAudioDuration.mockResolvedValue(1.2);
    const renderer = { renderScenePreview: vi.fn().mockResolvedValue(Buffer.from('preview-mp4')), renderFullVideo: vi.fn() };
    vi.spyOn(videoIndex, 'getVideoRenderer').mockReturnValue(renderer);
    const enqueueJob = vi.fn();
    const base = await startVideoRouterServer(enqueueJob as unknown as VideoEnqueue);

    const regenerate = await fetch(`${base}/api/project/${project.id}/scenes/scene-1/regenerate-voiceover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ speed: 1.1 }) });
    expect(regenerate.status).toBe(200);
    expect((await regenerate.json()).scenes[0].audioFileId).toEqual(expect.any(String));

    const preview = await fetch(`${base}/api/project/${project.id}/scenes/scene-1/render-preview`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toContain('video/mp4');
    expect(Buffer.from(await preview.arrayBuffer()).toString()).toBe('preview-mp4');
  });

  it('handles SFX/BGM routes as successful project responses when providers miss', async () => {
    const project = await seedVoiceProject();
    mocks.searchAndDownloadSfx.mockResolvedValue(null);
    mocks.searchAndDownloadBgm.mockResolvedValue(null);
    const enqueueJob = vi.fn();
    const base = await startVideoRouterServer(enqueueJob as unknown as VideoEnqueue);

    const sfx = await fetch(`${base}/api/project/${project.id}/scenes/scene-1/generate-sfx`, { method: 'POST' });
    const bgm = await fetch(`${base}/api/project/${project.id}/generate-bgm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mood: 'calm' }) });
    expect(sfx.status).toBe(200);
    expect(bgm.status).toBe(200);
    expect((await bgm.json()).bgmFileId).toBeNull();
  });

  it('worker handlers honor cancellation before invoking services', async () => {
    const job = { payload: { projectId: 'project-1' } } as never;
    const context = {
      isCancelled: vi.fn().mockResolvedValue(true),
      appendLog: vi.fn(),
      reportProgress: vi.fn(),
    };

    await jobHandlers['generate-voiceover']!(job, context);
    await jobHandlers['align-word-timings']!(job, context);
    await jobHandlers['generate-depth-maps']!(job, context);
    await jobHandlers['render-full-video']!(job, context);

    expect(mocks.synthesize).not.toHaveBeenCalled();
    expect(context.isCancelled).toHaveBeenCalledTimes(4);
  });
});

describe('real FFmpeg integration', () => {
  it.skipIf(!ffmpegAvailable || !ffprobeAvailable)(`renders a scene and BGM mix with installed binaries${binarySkipReason ? ` [skipped: ${binarySkipReason}]` : ''}`, async () => {
    const releaseRenderLock = await acquireRenderResourceLock();
    try {
    const imagePath = path.join(filesDir, 'fixture.png');
    const bgmPath = path.join(filesDir, 'fixture.mp3');
    await writeFile(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    const generatedBgm = spawnSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-ac', '2', '-ar', '48000', bgmPath], { encoding: 'utf8' });
    expect(generatedBgm.status).toBe(0);
    const project = await seedProject();
    await setProjectBgm(project.id, 'test', 'bgm-1');
    const renderer = new FfmpegRenderer({
      ffmpegPath,
      resolveFilePath: async (_projectId, fileId) => fileId === 'bgm-1'
        ? { absolutePath: bgmPath, mimeType: 'audio/mpeg', purpose: 'bgm' }
        : { absolutePath: imagePath, mimeType: 'image/png', purpose: 'reference' },
    });

    const latest = await getProject(project.id);
    const preview = await renderer.renderScenePreview(latest, latest.scenes[0]!);
    const progress: number[] = [];
    const full = await renderer.renderFullVideo(latest, async () => undefined, async (percent) => { progress.push(percent); });

    expect(preview.byteLength).toBeGreaterThan(100);
    expect(full.byteLength).toBeGreaterThan(100);
    expect(progress).toEqual([90, 100]);

    const shortVideoPath = path.join(filesDir, 'short.mp4');
    const shortOutputPath = path.join(filesDir, 'short-preview.mp4');
    const generatedShort = spawnSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', shortVideoPath], { encoding: 'utf8' });
    expect(generatedShort.status).toBe(0);
    const videoProject = await createProject(projectInput);
    await replaceProjectScenes(videoProject.id, [{ id: 'video-scene', narration: 'Video', visualPrompt: '', durationSec: 2, assetType: 'video', assetFileId: 'video-1', audioFileId: null, sfxPrompt: '', sfxFileId: null }]);
    const videoRenderer = new FfmpegRenderer({ ffmpegPath, resolveFilePath: async () => ({ absolutePath: shortVideoPath, mimeType: 'video/mp4', purpose: 'reference' }) });
    const shortPreview = await videoRenderer.renderScenePreview(await getProject(videoProject.id), (await getProject(videoProject.id)).scenes[0]!);
    await writeFile(shortOutputPath, shortPreview);
    const probed = spawnSync(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', shortOutputPath], { encoding: 'utf8' });
    expect(probed.status).toBe(0);
    expect(Number.parseFloat(probed.stdout.trim())).toBeGreaterThanOrEqual(1.8);
    } finally {
      await releaseRenderLock();
    }
  });
});
