import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, open, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { closeTestMongo, resetTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createApp } from '../../app';
import { AppError } from '../../shared/errors';
import { areNameCandidatesFresh, hashNarration } from '../../../contracts/name-keywords';
import {
  createProject,
  getProject,
  listProjects,
  duplicateProject,
  replaceProjectScenes,
  patchProjectScene,
  setProjectBgm,
  setProjectRenderEngine,
  setProjectParallax,
  setProjectDraftRenderFile,
  setProjectSceneTailSec,
  setProjectSfxVolume,
  setProjectVoiceSpeed,
  setProjectSceneDurations,
  setProjectSceneActive,
  replaceProjectChapters,
  setProjectRenderFile,
  setProjectLogo,
  setProjectSceneNameCandidates,
  setProjectScenePopupPlans,
  setSceneWordTimings,
  setSceneDepthMap,
} from '../project';
import { createFileStoreService } from '../file-store';
import { buildBgmFilterGraph, buildConcatArguments, buildSceneArguments, buildSceneFilterGraph, SFX_VOLUME, BGM_VOLUME } from './docs';
import { FfmpegRenderer, getVideoRenderer, RemotionRenderer } from './index';
import * as videoIndex from './index';
import { alignProjectWordTimings, assertProjectRenderReady, autoAnalyzeProjectNameKeywordsIfStale, configureVideoModule, generateProjectBgm, generateProjectDepthMaps, generateProjectSfx, generateProjectVoiceovers, generateSceneSfx, generateSceneVoiceover, recomputeProjectSceneDurations, renderFullProject, renderScenePreviewBuffer } from './index';
import { createVideoRouter } from './routes';
import type { NameKeywordAnalysisSummary } from './name-keyword-service';
import { enqueueJob as insertJob } from '../job';
import { jobHandlers } from '../../../worker/registry';

const mocks = vi.hoisted(() => ({
  synthesize: vi.fn(),
  masterAudio: vi.fn(),
  probeAudioDuration: vi.fn(),
  requestWhisperAlignment: vi.fn(),
  searchAndDownloadSfx: vi.fn(),
  searchSfx: vi.fn(),
  searchAndDownloadBgm: vi.fn(),
}));
vi.mock('../../shared/tts', () => ({
  getTtsClient: () => ({ synthesize: mocks.synthesize }),
  masterAudio: mocks.masterAudio,
  probeAudioDuration: mocks.probeAudioDuration,
}));
vi.mock('../../shared/tts/align', () => ({ requestWhisperAlignment: mocks.requestWhisperAlignment }));
vi.mock('../../shared/freesound', () => ({
  getFreesoundClient: () => ({ searchAndDownloadSfx: mocks.searchAndDownloadSfx, searchSfx: mocks.searchSfx, searchAndDownloadBgm: mocks.searchAndDownloadBgm }),
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
  mocks.searchSfx.mockReset();
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
    assetType: 'image', assetFileId: 'asset-1', audioFileId: null, sfxPrompt: 'wind', motionPrompt: '', sfxFileId: null,
  }]);
  return getProject(project.id);
}

async function seedVoiceProject() {
  const project = await createProject(projectInput);
  await replaceProjectScenes(project.id, [
    { id: 'scene-1', narration: 'First narration', visualPrompt: 'Visual 1', durationSec: 5, assetType: 'image', assetFileId: 'asset-1', audioFileId: null, sfxPrompt: 'wind', motionPrompt: '', sfxFileId: null },
    { id: 'scene-2', narration: 'Second narration', visualPrompt: 'Visual 2', durationSec: 7, assetType: 'image', assetFileId: 'asset-2', audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null },
  ]);
  return getProject(project.id);
}

describe('video project mutations', () => {
  const candidateRecord = (audioFileId = 'voice-1') => ({
    narrationHash: hashNarration('Narration'),
    audioFileId,
    provider: 'deepseek' as const,
    model: 'deepseek-chat',
    generatedAt: '2026-10-07T00:00:00.000Z',
    candidates: [{ phrase: 'Nguyễn Ánh', kind: 'person' as const }],
  });

  it('defaults legacy timings to null and conditionally invalidates them when audio or narration changes', async () => {
    const project = await seedProject();
    expect(project.scenes[0]!.wordTimings).toBeNull();
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-1', voiceoverDurationSec: 1.2 });
    const timing = { audioFileId: 'voice-1', words: [{ text: 'Narration', startSec: 0, endSec: 1 }] };
    expect(await setSceneWordTimings(project.id, 'scene-1', 'voice-1', 'Narration', timing)).toBe(true);
    expect(await setSceneWordTimings(project.id, 'scene-1', 'wrong-voice', 'Narration', timing)).toBe(false);
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-2' });
    expect((await getProject(project.id)).scenes[0]!.wordTimings).toBeNull();
    expect((await getProject(project.id)).scenes[0]!.voiceoverDurationSec).toBeNull();
    expect(await setSceneWordTimings(project.id, 'scene-1', 'voice-1', 'Narration', timing)).toBe(false);
    await replaceProjectScenes(project.id, [{ ...(await getProject(project.id)).scenes[0]!, narration: 'Rewritten narration' }]);
    expect((await getProject(project.id)).scenes[0]!.wordTimings).toBeNull();
  });

  it('toggles scene activity with version control and preserves all stored scene data', async () => {
    const project = await seedProject();
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-1', voiceoverDurationSec: 4.8, sfxFileId: 'sfx-1' });
    const timings = { audioFileId: 'voice-1', words: [{ text: 'Narration', startSec: 0, endSec: 1 }] };
    await setSceneWordTimings(project.id, 'scene-1', 'voice-1', 'Narration', timings);
    await setSceneDepthMap(project.id, 'scene-1', 'asset-1', { assetFileId: 'asset-1', fileId: 'depth-1', score: 0.95 });
    await setProjectScenePopupPlans(project.id, [{
      sceneId: 'scene-1', expectedNarration: 'Narration', expectedAudioFileId: 'voice-1',
      popupPlan: { narrationHash: hashNarration('Narration'), audioFileId: 'voice-1', provider: 'deepseek', model: 'deepseek-chat', backend: 'api', density: 'low', generatedAt: '2026-10-13T00:00:00.000Z', needed: false, reason: 'KhÃ´ng cáº§n popup.', popups: [], dropped: [] },
    }]);
    const before = await getProject(project.id);

    const inactive = await setProjectSceneActive(project.id, 'scene-1', false, before.version);

    expect(inactive.version).toBe(before.version + 1);
    expect(inactive.scenes[0]).toMatchObject({
      active: false,
      assetFileId: 'asset-1',
      audioFileId: 'voice-1',
      voiceoverDurationSec: 4.8,
      wordTimings: timings,
      popupPlan: before.scenes[0]!.popupPlan,
      sfxFileId: 'sfx-1',
      depthMap: { assetFileId: 'asset-1', fileId: 'depth-1', score: 0.95 },
    });

    const unchanged = await setProjectSceneActive(project.id, 'scene-1', false, inactive.version);
    expect(unchanged.version).toBe(inactive.version);
    await expect(setProjectSceneActive(project.id, 'scene-1', true, before.version)).rejects.toMatchObject({ status: 409, code: 'PROJECT_CHANGED' });
    await expect(setProjectSceneActive(project.id, 'missing', false)).rejects.toMatchObject({ status: 404 });
  });

  it('lists only active scenes and their duration while treating missing flags as active', async () => {
    const project = await createProject(projectInput);
    await replaceProjectScenes(project.id, [
      { id: 'scene-1', narration: 'One', visualPrompt: '', durationSec: 3, active: true },
      { id: 'scene-2', narration: 'Off', visualPrompt: '', durationSec: 50, active: false },
      { id: 'scene-3', narration: 'Legacy', visualPrompt: '', durationSec: 7 },
    ]);

    expect(await listProjects({})).toContainEqual(expect.objectContaining({ id: project.id, scenesCount: 2, durationSec: 10 }));

    await setProjectSceneActive(project.id, 'scene-1', false);
    await setProjectSceneActive(project.id, 'scene-3', false);
    expect(await listProjects({})).toContainEqual(expect.objectContaining({ id: project.id, scenesCount: 0, durationSec: 0 }));
  });

  it('recomputes chapter durations from active scenes for toggles, edits, and duration batches', async () => {
    const project = await createProject(projectInput);
    await replaceProjectScenes(project.id, [
      { id: 'scene-1', narration: 'One', visualPrompt: '', durationSec: 3, audioFileId: 'voice-1' },
      { id: 'scene-2', narration: 'Two', visualPrompt: '', durationSec: 50, audioFileId: 'voice-2' },
      { id: 'scene-3', narration: 'Three', visualPrompt: '', durationSec: 7, audioFileId: 'voice-3' },
    ]);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Chapter', paragraphs: ['One', 'Two', 'Three'], status: 'approved', scenesCount: 3, durationSec: 60 }], null);

    let current = await getProject(project.id);
    current = await setProjectSceneActive(project.id, 'scene-2', false, current.version);
    expect(current.chapters[0]?.durationSec).toBe(10);

    current = await patchProjectScene(project.id, 'scene-1', { durationSec: 4 }, current.version);
    expect(current.chapters[0]?.durationSec).toBe(11);
    current = await patchProjectScene(project.id, 'scene-2', { durationSec: 100 }, current.version);
    expect(current.chapters[0]?.durationSec).toBe(11);

    current = await setProjectSceneDurations(project.id, current.version, [
      { sceneId: 'scene-1', audioFileId: 'voice-1', voiceoverDurationSec: 5.8, durationSec: 6 },
      { sceneId: 'scene-2', audioFileId: 'voice-2', voiceoverDurationSec: 200, durationSec: 200.2 },
    ]);
    expect(current.chapters[0]?.durationSec).toBe(13);
    expect(current.scenes.find((scene) => scene.id === 'scene-2')?.durationSec).toBe(100);
  });
  it('clears all cross-project media references when duplicating a project', async () => {
    const project = await seedProject();
    await setProjectSceneActive(project.id, 'scene-1', false);
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-1', voiceoverDurationSec: 2.2, sfxFileId: 'sfx-1' });
    await setProjectSceneNameCandidates(project.id, [{ sceneId: 'scene-1', expectedNarration: 'Narration', expectedAudioFileId: 'voice-1', nameCandidates: candidateRecord() }]);
    await setProjectBgm(project.id, 'calm', 'bgm-1');
    await setProjectRenderFile(project.id, 'render-1');
    await setProjectDraftRenderFile(project.id, 'draft-1');
    await setProjectLogo(project.id, 'logo-1');

    const duplicate = await duplicateProject(project.id);

    expect(duplicate.renderFileId).toBeNull();
    expect(duplicate.draftRenderFileId).toBeNull();
    expect(duplicate.bgmFileId).toBeNull();
    expect(duplicate.logoFileId).toBeNull();
    expect(duplicate.scenes[0]).toMatchObject({ active: false, assetFileId: null, audioFileId: null, voiceoverDurationSec: null, sfxFileId: null, nameCandidates: null, popupPlan: null });
  });

  it('retains stale name candidates through narration edits and voiceover regeneration, then clears them on bulk reset', async () => {
    const project = await seedProject();
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-1', voiceoverDurationSec: 1.2 });
    const storedCandidates = candidateRecord();
    await setProjectSceneNameCandidates(project.id, [{ sceneId: 'scene-1', expectedNarration: 'Narration', expectedAudioFileId: 'voice-1', nameCandidates: storedCandidates }]);

    await patchProjectScene(project.id, 'scene-1', { narration: 'Rewritten narration' });
    const afterNarrationEdit = (await getProject(project.id)).scenes[0]!;
    expect(afterNarrationEdit.voiceoverDurationSec).toBeNull();
    expect(afterNarrationEdit.nameCandidates).toEqual(storedCandidates);
    expect(areNameCandidatesFresh(afterNarrationEdit.nameCandidates, afterNarrationEdit.narration, afterNarrationEdit.audioFileId)).toBe(false);

    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-2', voiceoverDurationSec: 2.4 });
    const afterVoiceoverRegeneration = (await getProject(project.id)).scenes[0]!;
    expect(afterVoiceoverRegeneration.voiceoverDurationSec).toBe(2.4);
    expect(afterVoiceoverRegeneration.nameCandidates).toEqual(storedCandidates);
    expect(areNameCandidatesFresh(afterVoiceoverRegeneration.nameCandidates, afterVoiceoverRegeneration.narration, afterVoiceoverRegeneration.audioFileId)).toBe(false);

    await replaceProjectScenes(project.id, [{ ...afterVoiceoverRegeneration, audioFileId: null }]);
    expect((await getProject(project.id)).scenes[0]).toMatchObject({ nameCandidates: null, voiceoverDurationSec: null });
  });

  it('does not apply a name-candidate batch update after narration or audio changed', async () => {
    const project = await seedProject();
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-1' });
    await setProjectSceneNameCandidates(project.id, [{ sceneId: 'scene-1', expectedNarration: 'Narration', expectedAudioFileId: 'voice-1', nameCandidates: candidateRecord() }]);

    const applied = await setProjectSceneNameCandidates(project.id, [{
      sceneId: 'scene-1', expectedNarration: 'Old narration', expectedAudioFileId: 'voice-1',
      nameCandidates: { ...candidateRecord(), generatedAt: '2026-10-07T00:01:00.000Z', candidates: [{ phrase: 'stale', kind: 'place' }] },
    }]);

    expect(applied).toBe(0);
    expect((await getProject(project.id)).scenes[0]!.nameCandidates).toEqual(candidateRecord());
  });

  it('stores a popup plan atomically and keeps it stale-safe across scene edits', async () => {
    const project = await seedProject();
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-1' });
    const plan = {
      narrationHash: hashNarration('Narration'), audioFileId: 'voice-1', provider: 'deepseek' as const, model: 'deepseek-chat', backend: 'api' as const,
      density: 'low' as const, generatedAt: '2026-10-13T00:00:00.000Z', needed: true, reason: 'Cần hiển thị mốc chính.',
      popups: [{ kind: 'number' as const, anchor: 'Narration', display: '1', importance: 5, reason: 'Mốc chính.', startSec: 0, endSec: 1, status: 'kept' as const, dropReason: null, pinned: false, suppressed: false }], dropped: [],
    };
    const beforeVersion = (await getProject(project.id)).version;
    expect(await setProjectScenePopupPlans(project.id, [{ sceneId: 'scene-1', expectedNarration: 'Narration', expectedAudioFileId: 'voice-1', popupPlan: plan }])).toBe(1);
    const stored = (await getProject(project.id)).scenes[0]!;
    expect(stored.popupPlan).toEqual(plan);
    expect((await getProject(project.id)).version).toBe(beforeVersion + 1);
    await patchProjectScene(project.id, 'scene-1', { narration: 'Changed narration' });
    expect((await getProject(project.id)).scenes[0]!.popupPlan).toEqual(plan);
  });

  it('patches scene audio, duration, and SFX fields with one version increment', async () => {
    const project = await seedProject();

    const updated = await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-1', durationSec: 8, sfxPrompt: 'clock', sfxFileId: 'sfx-1' });

    expect(updated.scenes[0]).toMatchObject({ audioFileId: 'voice-1', durationSec: 8, sfxPrompt: 'clock', sfxFileId: 'sfx-1' });
    expect(updated.version).toBe(project.version + 1);
  });

  it('applies a duration batch with one version increment and rejects a stale project version', async () => {
    const project = await seedVoiceProject();
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-1' });
    const snapshot = await getProject(project.id);

    const updated = await setProjectSceneDurations(project.id, snapshot.version, [{
      sceneId: 'scene-1', audioFileId: 'voice-1', voiceoverDurationSec: 1.237, durationSec: 1.44,
    }]);

    expect(updated.version).toBe(snapshot.version + 1);
    expect(updated.scenes[0]).toMatchObject({ durationSec: 1.44, voiceoverDurationSec: 1.237, wordTimings: null });
    await expect(setProjectSceneDurations(project.id, snapshot.version, [])).rejects.toMatchObject({ status: 409, code: 'PROJECT_CHANGED' });
  });

  it('updates BGM mood and file reference atomically', async () => {
    const project = await seedProject();

    const updated = await setProjectBgm(project.id, 'epic cinematic', 'bgm-1');

    expect(updated).toMatchObject({ bgmMood: 'epic cinematic', bgmFileId: 'bgm-1' });
    expect(updated.version).toBe(project.version + 1);
  });

  it('updates the project logo reference with one version increment', async () => {
    const project = await seedProject();
    const updated = await setProjectLogo(project.id, 'logo-1');
    expect(updated).toMatchObject({ logoFileId: 'logo-1', version: project.version + 1 });
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
    expect(graph).toContain('amix=inputs=2:duration=first:dropout_transition=0:normalize=0');
    expect(buildSceneFilterGraph({ durationSec: 5, width: 1920, height: 1080, fps: 30, sfxVolume: 0.35 })).toContain('volume=0.35[sfxD]');
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
    const videoArgs = buildSceneArguments({ assetType: 'video', videoPath: 'scene.mp4', outputPath: 'video-segment.mp4', durationSec: 5, videoDurationSec: 2, width: 1920, height: 1080, fps: 30 });
    expect(videoArgs.join(' ')).toContain('tpad=start_mode=clone:start_duration=3');
    expect(videoArgs.join(' ')).toContain('trim=duration=5');
    expect(videoArgs.join(' ')).not.toContain('stop_mode=clone');

    const longVideoArgs = buildSceneArguments({ assetType: 'video', videoPath: 'long-scene.mp4', outputPath: 'long-segment.mp4', durationSec: 5, videoDurationSec: 8, width: 1920, height: 1080, fps: 30 });
    expect(longVideoArgs.join(' ')).not.toContain('tpad=');
  });

  it('aligns fractional scene seconds to one shared whole-frame duration for FFmpeg', () => {
    const args = buildSceneArguments({ assetType: 'image', videoPath: 'scene.png', outputPath: 'segment.mp4', durationSec: 1.24, width: 1920, height: 1080, fps: 24 });

    expect(args).toContain('30');
    expect(args).toContain('1.25');
    expect(args.join(' ')).toContain('atrim=0:1.25');
    expect(args[args.indexOf('-frames:v') + 1]).toBe('30');
  });

  it('does not silently use a keyframe when a video scene has no visual asset', async () => {
    const project = await seedProject();
    const scene = { ...project.scenes[0]!, assetType: 'video' as const, assetFileId: null, videoKeyframeFileId: 'keyframe-1' };
    const renderer = new FfmpegRenderer({ resolveFilePath: async () => ({ absolutePath: 'keyframe.png', mimeType: 'image/png', purpose: 'reference' }) });

    await expect(renderer.renderScenePreview(project, scene)).rejects.toThrow('has no visual asset');
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
  it('auto-analyzes only eligible scenes with stale candidates and swallows analyzer failures', async () => {
    const project = await seedVoiceProject();
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-1' });
    const firstNarration = 'First narration';
    const timings = { audioFileId: 'voice-1', words: [
      { text: 'First', startSec: 0, endSec: .3 }, { text: 'narration', startSec: 2, endSec: 2.3 },
    ] };
    await setSceneWordTimings(project.id, 'scene-1', 'voice-1', firstNarration, timings);
    await setProjectSceneNameCandidates(project.id, [{
      sceneId: 'scene-1', expectedNarration: firstNarration, expectedAudioFileId: 'voice-1',
      nameCandidates: { narrationHash: hashNarration(firstNarration), audioFileId: 'voice-1', provider: 'deepseek', model: 'deepseek-chat', generatedAt: '2026-10-07T00:00:00.000Z', candidates: [] },
    }]);
    const analyze = vi.fn().mockResolvedValue({ scenesAnalyzed: 1, scenesSkippedNoTimings: 1, scenesWithName: 0, rejectedCandidates: 0, provider: 'deepseek', model: 'deepseek-chat' });

    expect(await autoAnalyzeProjectNameKeywordsIfStale(project.id, vi.fn(), analyze)).toBe(false);
    expect(analyze).not.toHaveBeenCalled();

    const changedNarration = 'Rewritten first narration';
    await patchProjectScene(project.id, 'scene-1', { narration: changedNarration });
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-2' });
    const refreshedTimings = { ...timings, audioFileId: 'voice-2' };
    expect(await setSceneWordTimings(project.id, 'scene-1', 'voice-2', changedNarration, refreshedTimings)).toBe(true);
    expect((await getProject(project.id)).scenes[0]).toMatchObject({ narration: changedNarration, audioFileId: 'voice-2', wordTimings: refreshedTimings, nameCandidates: expect.objectContaining({ narrationHash: hashNarration(firstNarration), audioFileId: 'voice-1' }) });
    const appendLog = vi.fn();
    analyze.mockRejectedValueOnce(new Error('Fake provider failure'));

    expect(await autoAnalyzeProjectNameKeywordsIfStale(project.id, appendLog, analyze)).toBe(false);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('Name popup auto-analysis skipped: Fake provider failure'));
    expect((await getProject(project.id)).scenes[0]!.nameCandidates).toMatchObject({ narrationHash: hashNarration(firstNarration), audioFileId: 'voice-1' });
  });

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
    expect(counts).toEqual({ aligned: 1, rejected: 0, failed: 0, stale: 0, skipped: 1, skippedInactive: 0 });
    expect((await getProject(project.id)).scenes[0]!.wordTimings?.words.map((word) => word.text)).toEqual(['First', 'narration']);
    expect(logs.at(-1)).toContain('"aligned":1');
    expect((await alignProjectWordTimings(project.id, async () => {}, async () => {}, async () => false)).skipped).toBe(2);
  });

  it('aligns only active scenes and reports inactive scenes separately', async () => {
    const project = await seedVoiceProject();
    const store = createFileStoreService(filesDir);
    const voice = await store.storeFile({ projectId: project.id, originalName: 'active.wav', mimeType: 'audio/wav', buffer: Buffer.from('voice'), purpose: 'voiceover' });
    await patchProjectScene(project.id, 'scene-1', { audioFileId: voice.id });
    await setProjectSceneActive(project.id, 'scene-2', false);
    mocks.probeAudioDuration.mockResolvedValue(2);
    mocks.requestWhisperAlignment.mockResolvedValue([
      { word: 'First', start: 0, end: 0.8, probability: 0.9 },
      { word: 'narration', start: 1, end: 1.8, probability: 0.9 },
    ]);
    const logs: string[] = [];
    const progress: number[] = [];

    const result = await alignProjectWordTimings(project.id, async (line) => { logs.push(line); }, async (percent) => { progress.push(percent); }, async () => false);

    expect(result).toMatchObject({ aligned: 1, skippedInactive: 1 });
    expect(mocks.requestWhisperAlignment).toHaveBeenCalledTimes(1);
    expect((await getProject(project.id)).scenes[1]!.wordTimings).toBeNull();
    expect(progress).toEqual([100]);
    expect(logs.at(-1)).toContain('"skippedInactive":1');
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

  it('rejects empty narration before calling TTS', async () => {
    const project = await seedVoiceProject();
    await patchProjectScene(project.id, 'scene-1', { narration: '  ' });

    await expect(generateSceneVoiceover(project.id, 'scene-1')).rejects.toMatchObject({
      status: 422,
      code: 'EMPTY_NARRATION',
      message: 'Scene 1 has no narration text, so no voiceover can be generated.',
    });
    expect(mocks.synthesize).not.toHaveBeenCalled();
  });
  it('stores a mastered voiceover and patches the probed duration', async () => {
    const project = await seedVoiceProject();
    mocks.synthesize.mockResolvedValue(Buffer.from('voice')); 
    mocks.masterAudio.mockImplementation(async (buffer: Buffer) => buffer);
    mocks.probeAudioDuration.mockResolvedValue(2.2);

    const updated = await generateSceneVoiceover(project.id, 'scene-1');

    expect(updated).toMatchObject({ audioFileId: expect.any(String), voiceoverDurationSec: 2.2, durationSec: 2.4 });
    const files = await createFileStoreService(filesDir).listProjectFiles(project.id);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ purpose: 'voiceover', mimeType: 'audio/wav' });
  });

  it('passes the project voice speed to TTS and mastering and stores the effective input', async () => {
    const project = await seedVoiceProject();
    await setProjectVoiceSpeed(project.id, 1.2);
    mocks.synthesize.mockResolvedValue(Buffer.from('voice'));
    mocks.masterAudio.mockImplementation(async (buffer: Buffer) => buffer);
    mocks.probeAudioDuration.mockResolvedValue(2.2);

    const updated = await generateSceneVoiceover(project.id, 'scene-1');

    expect(mocks.synthesize).toHaveBeenCalledWith('First narration', expect.objectContaining({ voice: 'Truc Ly', speed: 1.2 }));
    expect(mocks.masterAudio).toHaveBeenCalledWith(Buffer.from('voice'), 1.2);
    expect(updated.voiceoverInput).toEqual({ voice: 'Truc Ly', speed: 1.2, narrationHash: hashNarration('First narration') });
    expect(updated).toMatchObject({ durationSec: 2.4, voiceoverDurationSec: 2.2 });
  });

  it('marks a voiceover stale after changing the project speed', async () => {
    const project = await seedVoiceProject();
    mocks.synthesize.mockResolvedValue(Buffer.from('voice'));
    mocks.masterAudio.mockImplementation(async (buffer: Buffer) => buffer);
    mocks.probeAudioDuration.mockResolvedValue(2);

    const generated = await generateSceneVoiceover(project.id, 'scene-1');
    expect(generated.voiceoverInput).toEqual({ voice: 'Truc Ly', speed: 1, narrationHash: hashNarration('First narration') });
    expect((await getProject(project.id)).scenes[0]!.voiceoverInput).toEqual({ voice: 'Truc Ly', speed: 1, narrationHash: hashNarration('First narration') });

    await setProjectVoiceSpeed(project.id, 1.2);
    const changed = await getProject(project.id);
    expect(changed.voiceSpeed).toBe(1.2);
    expect(changed.scenes[0]!.audioFileId).toBe(generated.audioFileId);
    expect(changed.scenes[0]!.voiceoverInput).not.toEqual({ voice: changed.voiceoverVoice, speed: changed.voiceSpeed });
  });

  it('does not attach audio synthesized from narration that changed in flight', async () => {
    const project = await seedVoiceProject();
    mocks.synthesize.mockImplementation(async () => {
      await patchProjectScene(project.id, 'scene-1', { narration: 'Edited while TTS was running' });
      return Buffer.from('voice');
    });
    mocks.masterAudio.mockImplementation(async (buffer: Buffer) => buffer);
    mocks.probeAudioDuration.mockResolvedValue(2);

    await expect(generateSceneVoiceover(project.id, 'scene-1')).rejects.toMatchObject({ status: 409, code: 'PROJECT_CHANGED' });
    const changed = (await getProject(project.id)).scenes[0]!;
    expect(changed.narration).toBe('Edited while TTS was running');
    expect(changed.audioFileId).toBeNull();
    expect(changed.voiceoverInput).toBeNull();
  });

  it('recomputes durations from stored voiceovers, skips missing audio, and leaves failed probes unchanged', async () => {
    const project = await createProject(projectInput);
    await replaceProjectScenes(project.id, [
      { id: 'one', narration: 'One', visualPrompt: '', durationSec: 8, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null },
      { id: 'two', narration: 'Two', visualPrompt: '', durationSec: 9, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null },
      { id: 'three', narration: 'Three', visualPrompt: '', durationSec: 4, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null },
    ]);
    const store = createFileStoreService(filesDir);
    const firstFile = await store.storeFile({ projectId: project.id, originalName: 'one.wav', mimeType: 'audio/wav', buffer: Buffer.from('one'), purpose: 'voiceover' });
    const secondFile = await store.storeFile({ projectId: project.id, originalName: 'two.wav', mimeType: 'audio/wav', buffer: Buffer.from('two'), purpose: 'voiceover' });
    await patchProjectScene(project.id, 'one', { audioFileId: firstFile.id });
    await patchProjectScene(project.id, 'two', { audioFileId: secondFile.id });
    mocks.probeAudioDuration.mockResolvedValueOnce(2.237).mockRejectedValueOnce(new Error('corrupt WAV'));
    const logs: string[] = [];
    const progress: number[] = [];

    const result = await recomputeProjectSceneDurations(project.id, async (line) => { logs.push(line); }, async (percent) => { progress.push(percent); });

    expect(result).toEqual({ updated: 1, skippedSceneNumbers: [3], failedSceneNumbers: [2], skippedInactive: 0 });
    expect((await getProject(project.id)).scenes.map((scene) => [scene.durationSec, scene.voiceoverDurationSec])).toEqual([[2.44, 2.237], [9, null], [4, null]]);
    expect(mocks.probeAudioDuration).toHaveBeenCalledTimes(2);
    expect(progress).toEqual([33, 67, 100]);
    expect(logs.join('\n')).toContain('Scene 2');
  });

  it('recomputes stored voiceover durations through the route without running TTS', async () => {
    const project = await seedProject();
    const voice = await createFileStoreService(filesDir).storeFile({ projectId: project.id, originalName: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from('stored voice'), purpose: 'voiceover' });
    await patchProjectScene(project.id, 'scene-1', { audioFileId: voice.id });
    mocks.probeAudioDuration.mockResolvedValue(1.237);
    const base = await startVideoRouterServer(vi.fn() as unknown as VideoEnqueue);

    const response = await fetch(`${base}/api/project/${project.id}/scenes/recompute-durations`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 1, skippedSceneNumbers: [], failedSceneNumbers: [], skippedInactive: 0 });
    expect((await getProject(project.id)).scenes[0]).toMatchObject({ durationSec: 1.44, voiceoverDurationSec: 1.237 });
    expect(mocks.probeAudioDuration).toHaveBeenCalledOnce();
    expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  it('rejects voiceover-duration recompute while a render job is active', async () => {
    const project = await seedProject();
    await insertJob({ type: 'render-full-video', projectId: project.id, payload: { projectId: project.id } });
    const base = await startVideoRouterServer(vi.fn() as unknown as VideoEnqueue);

    const response = await fetch(`${base}/api/project/${project.id}/scenes/recompute-durations`, { method: 'POST' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'RENDER_IN_PROGRESS' } });
    expect(mocks.probeAudioDuration).not.toHaveBeenCalled();
  });

  it('retains the prior name analysis as stale when a scene voiceover is regenerated', async () => {
    const project = await seedVoiceProject();
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'old-voice' });
    const oldCandidates = {
      narrationHash: hashNarration('First narration'), audioFileId: 'old-voice', provider: 'deepseek' as const,
      model: 'deepseek-chat', generatedAt: '2026-10-07T00:00:00.000Z', candidates: [{ phrase: 'First', kind: 'person' as const }],
    };
    await setProjectSceneNameCandidates(project.id, [{ sceneId: 'scene-1', expectedNarration: 'First narration', expectedAudioFileId: 'old-voice', nameCandidates: oldCandidates }]);
    mocks.synthesize.mockResolvedValue(Buffer.from('new voice'));
    mocks.masterAudio.mockImplementation(async (buffer: Buffer) => buffer);
    mocks.probeAudioDuration.mockResolvedValue(2);

    const updated = await generateSceneVoiceover(project.id, 'scene-1');

    expect(updated.audioFileId).not.toBe('old-voice');
    expect(updated.nameCandidates).toEqual(oldCandidates);
    expect(areNameCandidatesFresh(updated.nameCandidates, updated.narration, updated.audioFileId)).toBe(false);
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

  it('starts batch voiceover generation at a requested scene and skips earlier scenes', async () => {
    const project = await seedVoiceProject();
    mocks.synthesize.mockResolvedValue(Buffer.from('voice'));
    mocks.masterAudio.mockImplementation(async (buffer: Buffer) => buffer);
    mocks.probeAudioDuration.mockResolvedValue(1.1);

    const result = await generateProjectVoiceovers(project.id, async () => {}, async () => {}, { startSceneId: 'scene-2' });

    expect(result).toEqual({ generated: 1, skippedSceneNumbers: [], failedSceneNumbers: [], skippedInactive: 0 });
    expect(mocks.synthesize).toHaveBeenCalledTimes(1);
    expect(mocks.synthesize).toHaveBeenCalledWith('Second narration', expect.anything());
    expect((await getProject(project.id)).scenes.map((scene) => scene.audioFileId)).toEqual([null, expect.any(String)]);
  });

  it('stops starting later voiceover scenes after cooperative cancellation', async () => {
    const project = await seedVoiceProject();
    mocks.synthesize.mockResolvedValue(Buffer.from('voice'));
    mocks.masterAudio.mockImplementation(async (buffer: Buffer) => buffer);
    mocks.probeAudioDuration.mockResolvedValue(1.1);
    const isCancelled = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const logs: string[] = [];

    const result = await generateProjectVoiceovers(project.id, async (message) => { logs.push(message); }, async () => {}, { isCancelled });

    expect(result.generated).toBe(1);
    expect(mocks.synthesize).toHaveBeenCalledTimes(1);
    expect((await getProject(project.id)).scenes[1]!.audioFileId).toBeNull();
    expect(logs.at(-1)).toContain('skippedInactive: 0');
  });

  it('skips empty scenes in the batch and reports their scene numbers', async () => {
    const project = await seedVoiceProject();
    await patchProjectScene(project.id, 'scene-1', { narration: '  ' });
    mocks.synthesize.mockResolvedValue(Buffer.from('voice'));
    mocks.masterAudio.mockImplementation(async (buffer: Buffer) => buffer);
    mocks.probeAudioDuration.mockResolvedValue(1.1);
    const logs: string[] = [];

    await expect(generateProjectVoiceovers(project.id, async (message) => { logs.push(message); }, async () => {})).resolves.toEqual({
      generated: 1,
      skippedSceneNumbers: [1],
      failedSceneNumbers: [],
      skippedInactive: 0,
    });

    expect(mocks.synthesize).toHaveBeenCalledTimes(1);
    expect(logs.at(-1)).toBe('Voiceover done for 1 scenes; skipped 1 scenes with no narration (scene numbers 1). skippedInactive: 0.');
  });

  it('rejects voiceover, SFX, and preview actions for inactive scenes before external work', async () => {
    const project = await seedProject();
    await setProjectSceneActive(project.id, 'scene-1', false);
    const renderer = { renderScenePreview: vi.fn(), renderFullVideo: vi.fn() };
    vi.spyOn(videoIndex, 'getVideoRenderer').mockReturnValue(renderer);

    await expect(generateSceneVoiceover(project.id, 'scene-1')).rejects.toMatchObject({ status: 409, code: 'SCENE_INACTIVE' });
    await expect(generateSceneSfx(project.id, 'scene-1')).rejects.toMatchObject({ status: 409, code: 'SCENE_INACTIVE' });
    await expect(renderScenePreviewBuffer(project.id, 'scene-1')).rejects.toMatchObject({ status: 409, code: 'SCENE_INACTIVE' });
    expect(mocks.synthesize).not.toHaveBeenCalled();
    expect(mocks.searchSfx).not.toHaveBeenCalled();
    expect(renderer.renderScenePreview).not.toHaveBeenCalled();
  });

  it('skips inactive voiceover scenes, reports the count, and rejects an inactive start scene', async () => {
    const project = await seedVoiceProject();
    const before = await getProject(project.id);
    await setProjectSceneActive(project.id, 'scene-1', false, before.version);
    mocks.synthesize.mockResolvedValue(Buffer.from('voice'));
    mocks.masterAudio.mockImplementation(async (buffer: Buffer) => buffer);
    mocks.probeAudioDuration.mockResolvedValue(1.1);
    const logs: string[] = [];

    const result = await generateProjectVoiceovers(project.id, async (message) => { logs.push(message); }, async () => {});

    expect(result).toMatchObject({ generated: 1, skippedInactive: 1, skippedSceneNumbers: [], failedSceneNumbers: [] });
    expect(mocks.synthesize).toHaveBeenCalledTimes(1);
    expect(mocks.synthesize).toHaveBeenCalledWith('Second narration', expect.anything());
    expect(logs.at(-1)).toContain('skippedInactive: 1');
    await expect(generateProjectVoiceovers(project.id, async () => {}, async () => {}, { startSceneId: 'scene-1' })).rejects.toMatchObject({ status: 409, code: 'SCENE_INACTIVE' });
  });

  it('finishes an all-inactive voiceover batch without calling TTS', async () => {
    const project = await seedVoiceProject();
    const before = await getProject(project.id);
    await setProjectSceneActive(project.id, 'scene-1', false, before.version);
    await setProjectSceneActive(project.id, 'scene-2', false);
    const logs: string[] = [];
    const progress: number[] = [];

    const result = await generateProjectVoiceovers(project.id, async (message) => { logs.push(message); }, async (percent) => { progress.push(percent); });

    expect(result).toMatchObject({ generated: 0, skippedInactive: 2 });
    expect(mocks.synthesize).not.toHaveBeenCalled();
    expect(progress).toEqual([100]);
    expect(logs.at(-1)?.toLocaleLowerCase('vi')).toContain('không có scene nào đang bật');
    expect(logs.at(-1)).toContain('skippedInactive: 2');
  });

  it('finishes an all-inactive SFX batch with a clear log and no external work', async () => {
    const project = await seedVoiceProject();
    await setProjectSceneActive(project.id, 'scene-1', false);
    await setProjectSceneActive(project.id, 'scene-2', false);
    const logs: string[] = [];
    const progress: number[] = [];

    const result = await generateProjectSfx(project.id, async (message) => { logs.push(message); }, async (percent) => { progress.push(percent); });

    expect(result).toMatchObject({ generated: 0, skippedInactive: 2 });
    expect(mocks.searchSfx).not.toHaveBeenCalled();
    expect(progress).toEqual([100]);
    expect(logs[0]?.toLocaleLowerCase('vi')).toContain('không có scene nào đang bật');
  });

  it('finishes all-inactive alignment and duration batches without probing or aligning', async () => {
    const project = await seedVoiceProject();
    await setProjectSceneActive(project.id, 'scene-1', false);
    await setProjectSceneActive(project.id, 'scene-2', false);
    const alignmentLogs: string[] = [];
    const alignmentProgress: number[] = [];
    const durationLogs: string[] = [];
    const durationProgress: number[] = [];

    const alignment = await alignProjectWordTimings(project.id, async (message) => { alignmentLogs.push(message); }, async (percent) => { alignmentProgress.push(percent); }, async () => false);
    const durations = await recomputeProjectSceneDurations(project.id, async (message) => { durationLogs.push(message); }, async (percent) => { durationProgress.push(percent); });

    expect(alignment).toMatchObject({ aligned: 0, skippedInactive: 2 });
    expect(mocks.requestWhisperAlignment).not.toHaveBeenCalled();
    expect(alignmentProgress).toEqual([100]);
    expect(alignmentLogs.join('\n').toLocaleLowerCase('vi')).toContain('không có scene nào đang bật');
    expect(durations).toMatchObject({ updated: 0, skippedInactive: 2 });
    expect(mocks.probeAudioDuration).not.toHaveBeenCalled();
    expect(durationProgress).toEqual([100]);
    expect(durationLogs.join('\n').toLocaleLowerCase('vi')).toContain('không có scene nào đang bật');
  });

  it('generates project SFX sequentially and reports progress for every scene', async () => {
    const project = await seedVoiceProject();
    mocks.searchSfx.mockResolvedValue({ audio: Buffer.from('sfx'), reason: 'ok', sound: { id: 12, name: 'Wind', tags: ['wind'], duration: 4, avg_rating: 4, num_ratings: 6, previews: { 'preview-hq-mp3': 'https://cdn.test/wind.mp3' } }, query: 'wind' });
    const logs: string[] = [];
    const progress: number[] = [];

    const summary = await generateProjectSfx(project.id, async (message) => { logs.push(message); }, async (percent) => { progress.push(percent); });

    const updated = await getProject(project.id);
    expect(updated.scenes[0]!.sfxFileId).toEqual(expect.any(String));
    expect(updated.scenes[1]!.sfxFileId).toBeNull();
    expect(summary).toMatchObject({ generated: 1, skippedNoPrompt: 1, failed: 0, rateLimitedStop: false });
    expect(logs.some((line) => line.includes('SFX Scene 01: generated') && line.includes('Freesound #12'))).toBe(true);
    expect(logs.at(-1)).toContain('SFX: 1 ok');
    expect(progress).toEqual([50, 100]);
  });

  it('reports structured scene failures in the batch result and log', async () => {
    const project = await seedVoiceProject();
    mocks.searchSfx.mockResolvedValueOnce({ audio: null, reason: 'http-error', sound: null, detail: 'HTTP 503 after three attempts.' });
    const logs: string[] = [];
    const progress: number[] = [];

    const summary = await generateProjectSfx(project.id, async (message) => { logs.push(message); }, async (percent) => { progress.push(percent); });

    expect((await getProject(project.id)).scenes[0]!.sfxFileId).toBeNull();
    expect(summary).toMatchObject({ generated: 0, failed: 1, counts: { 'http-error': 1 } });
    expect(logs.some((line) => line.includes('SFX Scene 01: failed:http-error'))).toBe(true);
    expect(logs.at(-1)).toContain('1 lỗi HTTP');
    expect(progress).toEqual([50, 100]);
  });

  it('retries only missing scenes and excludes no-prompt scenes', async () => {
    const project = await seedVoiceProject();
    const store = createFileStoreService(filesDir);
    const existing = await store.storeFile({ projectId: project.id, originalName: 'existing.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('existing'), purpose: 'sfx' });
    await patchProjectScene(project.id, 'scene-1', { sfxFileId: existing.id });
    await patchProjectScene(project.id, 'scene-2', { sfxPrompt: 'rain falling' });
    mocks.searchSfx.mockResolvedValue({ audio: Buffer.from('sfx'), reason: 'ok', sound: { id: 7, name: 'Rain', tags: ['rain'], duration: 4, avg_rating: 4.5, num_ratings: 10, previews: {} }, query: 'rain falling' });
    const logs: string[] = [];

    const summary = await generateProjectSfx(project.id, async (message) => { logs.push(message); }, async () => {}, { onlyMissing: true });

    expect(mocks.searchSfx).toHaveBeenCalledTimes(1);
    expect(mocks.searchSfx).toHaveBeenCalledWith('rain falling');
    expect(summary).toMatchObject({ generated: 1, skippedExisting: 1, skippedNoPrompt: 0 });
    expect((await getProject(project.id)).scenes.map((scene) => scene.sfxFileId)).toEqual([existing.id, expect.any(String)]);
    expect(logs.some((line) => line.includes('SFX Scene 01: skipped-existing'))).toBe(true);
  });

  it('stops after three consecutive scene-level persistent 429 outcomes', async () => {
    const project = await createProject(projectInput);
    await replaceProjectScenes(project.id, Array.from({ length: 5 }, (_, index) => ({
      id: `sfx-scene-${index + 1}`, narration: `Narration ${index + 1}`, visualPrompt: `Visual ${index + 1}`, durationSec: 5,
      assetType: 'image' as const, assetFileId: `asset-${index + 1}`, audioFileId: null, sfxPrompt: 'war drums', motionPrompt: '', sfxFileId: null,
    })));
    mocks.searchSfx.mockResolvedValue({ audio: null, reason: 'rate-limited', sound: null, detail: 'HTTP 429 after three attempts.' });
    const logs: string[] = [];
    const progress: number[] = [];

    const summary = await generateProjectSfx(project.id, async (message) => { logs.push(message); }, async (percent) => { progress.push(percent); });

    expect(mocks.searchSfx).toHaveBeenCalledTimes(3);
    expect(summary).toMatchObject({ failed: 3, rateLimitedStop: true, counts: { 'rate-limited': 3 } });
    expect(summary.outcomes).toHaveLength(3);
    expect(logs).toContain('Freesound đã chặn tạm thời — thử lại sau');
    expect(progress.at(-1)).toBe(100);
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
    await replaceProjectScenes(project.id, [{ id: 'scene-1', narration: 'Missing', visualPrompt: 'Visual', durationSec: 5, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null }]);

    await expect(renderFullProject(project.id, async () => undefined, async () => undefined)).rejects.toMatchObject({ code: 'SCENES_NOT_READY', status: 422 });
  });

  it('checks only active scenes for render readiness and preserves original scene numbers', async () => {
    const project = await createProject(projectInput);
    await replaceProjectScenes(project.id, [
      { id: 'scene-1', narration: 'Off', visualPrompt: '', durationSec: 5, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null, active: false },
      { id: 'scene-2', narration: 'On', visualPrompt: '', durationSec: 5, assetType: 'image', assetFileId: 'asset-2', audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null },
      { id: 'scene-3', narration: 'On but missing', visualPrompt: '', durationSec: 5, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null },
    ]);
    const loaded = await getProject(project.id);

    expect(() => assertProjectRenderReady({ scenes: loaded.scenes.slice(0, 2) })).not.toThrow();
    expect(() => assertProjectRenderReady(loaded)).toThrow(expect.objectContaining({ code: 'SCENES_NOT_READY', message: expect.stringContaining('3') }));
    await setProjectSceneActive(project.id, 'scene-2', false);
    await setProjectSceneActive(project.id, 'scene-3', false);
    await expect(renderFullProject(project.id, async () => undefined, async () => undefined)).rejects.toMatchObject({ code: 'SCENES_NOT_READY', message: 'Không có scene nào đang bật để render.' });
  });

  it('recomputes only active scene durations and reports inactive skips', async () => {
    const project = await seedVoiceProject();
    const store = createFileStoreService(filesDir);
    const activeVoice = await store.storeFile({ projectId: project.id, originalName: 'active.wav', mimeType: 'audio/wav', buffer: Buffer.from('active'), purpose: 'voiceover' });
    const inactiveVoice = await store.storeFile({ projectId: project.id, originalName: 'inactive.wav', mimeType: 'audio/wav', buffer: Buffer.from('inactive'), purpose: 'voiceover' });
    await patchProjectScene(project.id, 'scene-1', { audioFileId: activeVoice.id });
    await patchProjectScene(project.id, 'scene-2', { audioFileId: inactiveVoice.id, durationSec: 7 });
    await setProjectSceneActive(project.id, 'scene-2', false);
    mocks.probeAudioDuration.mockResolvedValue(2.237);
    const logs: string[] = [];

    const result = await recomputeProjectSceneDurations(project.id, async (line) => { logs.push(line); }, async () => {});

    expect(result).toMatchObject({ updated: 1, skippedInactive: 1 });
    expect(mocks.probeAudioDuration).toHaveBeenCalledTimes(1);
    expect((await getProject(project.id)).scenes[1]).toMatchObject({ audioFileId: inactiveVoice.id, durationSec: 7, voiceoverDurationSec: null, active: false });
    expect(logs.at(-1)).toContain('skippedInactive');
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

  it('stores draft output separately without changing final render metadata or status', async () => {
    const project = await seedProject();
    await setProjectRenderFile(project.id, 'existing-final-render');
    await setProjectRenderEngine(project.id, 'remotion');
    const renderer = { renderScenePreview: vi.fn(), renderFullVideo: vi.fn().mockResolvedValue(Buffer.from('draft-mp4')) };
    vi.spyOn(videoIndex, 'getVideoRenderer').mockReturnValue(renderer);

    await renderFullProject(project.id, async () => undefined, async () => undefined, { draft: true });

    const updated = await getProject(project.id);
    expect(updated).toMatchObject({ status: 'rendered', renderFileId: 'existing-final-render', draftRenderFileId: expect.any(String) });
    expect(await createFileStoreService(filesDir).listProjectFiles(project.id)).toContainEqual(expect.objectContaining({ purpose: 'render-draft', originalName: 'render-draft.mp4' }));
    expect(renderer.renderFullVideo).toHaveBeenCalledWith(expect.anything(), expect.any(Function), expect.any(Function), { draft: true });
  });
});

type VideoEnqueue = (input: { type: string; projectId: string; payload: unknown }) => Promise<{ id: string }>;

async function startVideoRouterServer(enqueueJob: VideoEnqueue, analyzeNameKeywords?: (projectId: string) => Promise<NameKeywordAnalysisSummary>, options: { getActiveJob?: (projectId: string, type: string) => Promise<{ id: string; payload: unknown } | null>; getClaudeCliStatus?: () => Promise<{ available: boolean; version?: string; reason?: string; authPathLikely: 'api-key' | 'subscription' }> } = {}): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use('/api/project', createVideoRouter({ enqueueJob, analyzeNameKeywords, ...options }));
  app.use((error: { status?: number; code?: string; message?: string; name?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    void next;
    const status = error.status ?? (error.name === 'ZodError' ? 400 : 500);
    res.status(status).json({ error: { code: error.code ?? (status === 400 ? 'validation_error' : 'unknown_error'), message: error.message ?? 'error' } });
  });
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('video routes and worker handlers', () => {
  async function seedPopupPlanProject() {
    const project = await seedProject();
    const narration = 'Sông Tiền, quân ta tiến.';
    await patchProjectScene(project.id, 'scene-1', { narration });
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-1', voiceoverDurationSec: 5 });
    const words = [
      { text: 'Sông', startSec: 0, endSec: 0.2 },
      { text: 'Tiền,', startSec: 0.2, endSec: 0.4 },
      { text: 'quân', startSec: 1, endSec: 1.2 },
      { text: 'ta', startSec: 1.2, endSec: 1.4 },
      { text: 'tiến.', startSec: 1.4, endSec: 1.6 },
    ];
    await setSceneWordTimings(project.id, 'scene-1', 'voice-1', narration, { audioFileId: 'voice-1', words });
    await setProjectScenePopupPlans(project.id, [{
      sceneId: 'scene-1',
      expectedNarration: narration,
      expectedAudioFileId: 'voice-1',
      popupPlan: {
        narrationHash: hashNarration(narration), audioFileId: 'voice-1', provider: 'deepseek', model: 'deepseek-chat', backend: 'api', density: 'low', generatedAt: '2026-10-13T00:00:00.000Z', needed: true, reason: 'Địa danh chính.',
        popups: [{ kind: 'place', anchor: 'Sông Tiền', display: 'Sông Tiền', importance: 4, reason: 'Địa danh chính.', startSec: 0, endSec: 3.3, status: 'kept', dropReason: null, pinned: true, suppressed: false }], dropped: [],
      },
    }]);
    return getProject(project.id);
  }

  it('enqueues popup analysis with the project density', async () => {
    const project = await seedProject();
    const enqueueJob = vi.fn().mockResolvedValue({ id: 'job-popup-1' });
    const base = await startVideoRouterServer(enqueueJob as unknown as VideoEnqueue);
    const api = await fetch(`${base}/api/project/${project.id}/popup-analysis`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ backend: 'api' }),
    });
    expect(api.status).toBe(201);
    expect(enqueueJob).toHaveBeenCalledWith({ type: 'analyze-popups', projectId: project.id, payload: { projectId: project.id, backend: 'api', density: 'low' }, maxAttempts: 1 });
  });

  it('rejects unavailable CLI before queueing popup analysis', async () => {
    const project = await seedProject();
    const enqueueJob = vi.fn();
    const cliBase = await startVideoRouterServer(enqueueJob as unknown as VideoEnqueue, undefined, {
      getClaudeCliStatus: async () => ({ available: false, reason: 'not installed', authPathLikely: 'subscription' }),
    });
    const cli = await fetch(`${cliBase}/api/project/${project.id}/popup-analysis`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ backend: 'cli', cliModel: 'claude-haiku-4-5-20251001', density: 'medium' }),
    });
    expect(cli.status).toBe(503);
    expect(await cli.json()).toMatchObject({ error: { code: 'CLAUDE_CLI_UNAVAILABLE' } });
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('does not enqueue popup analysis while a render job is active', async () => {
    const project = await seedProject();
    await insertJob({ type: 'render-full-video', projectId: project.id, payload: { projectId: project.id, draft: false } });
    const enqueueJob = vi.fn();
    const base = await startVideoRouterServer(enqueueJob as unknown as VideoEnqueue);
    const response = await fetch(`${base}/api/project/${project.id}/popup-analysis`, { method: 'POST' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'RENDER_IN_PROGRESS' } });
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('persists popup density and deduplicates a matching active popup-analysis job', async () => {
    const project = await seedProject();
    const enqueueJob = vi.fn();
    const getActiveJob = vi.fn().mockResolvedValue({ id: 'job-popup-existing', payload: { backend: 'cli', density: 'high', cliModel: 'claude-haiku-4-5-20251001' } });
    const base = await startVideoRouterServer(enqueueJob as unknown as VideoEnqueue, undefined, {
      getActiveJob,
      getClaudeCliStatus: async () => ({ available: true, version: 'Claude Code 2.1.294', authPathLikely: 'subscription' }),
    });
    const updated = await fetch(`${base}/api/project/${project.id}/popup-density`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ density: 'high' }),
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()).popupDensity).toBe('high');
    const response = await fetch(`${base}/api/project/${project.id}/popup-analysis`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ backend: 'cli', cliModel: 'claude-haiku-4-5-20251001' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobId: 'job-popup-existing' });
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('blocks render while popup analysis is writing scene plans', async () => {
    const project = await seedProject();
    await insertJob({ type: 'analyze-popups', projectId: project.id, payload: { projectId: project.id, backend: 'api', density: 'low' } });
    const base = await startVideoRouterServer(vi.fn() as unknown as VideoEnqueue);
    const response = await fetch(`${base}/api/project/${project.id}/render`, { method: 'POST' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'POPUP_ANALYSIS_IN_PROGRESS' } });
  });

  it('pins a stored popup through a project-owned flags route and reports conflicts', async () => {
    const project = await seedPopupPlanProject();
    const base = await startVideoRouterServer(vi.fn() as unknown as VideoEnqueue);
    const response = await fetch(`${base}/api/project/${project.id}/scenes/scene-1/popup-plan/flags`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anchor: 'Sông Tiền', pinned: true }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { project: { version: number; scenes: Array<{ popupPlan: { popups: Array<{ pinned: boolean }> } | null }> }; conflicts: unknown[] };
    expect(body.project.version).toBe(project.version + 1);
    expect(body.project.scenes[0]!.popupPlan?.popups[0]!.pinned).toBe(true);
    expect(body.conflicts).toEqual([]);
  });

  it.each([
    ['popup flags', '/popup-plan/flags', { anchor: 'Sông Tiền', pinned: false }],
    ['popup edit', '/popup-plan', { kind: 'place', anchor: 'Sông Tiền', display: 'Dòng Tiền', importance: 4, reason: 'Địa danh trong lời dẫn.' }],
  ])('rejects %s updates while its scene is inactive', async (_name, suffix, body) => {
    const project = await seedPopupPlanProject();
    const beforePlan = project.scenes[0]!.popupPlan;
    await setProjectSceneActive(project.id, 'scene-1', false);
    const base = await startVideoRouterServer(vi.fn() as unknown as VideoEnqueue);

    const response = await fetch(`${base}/api/project/${project.id}/scenes/scene-1${suffix}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'SCENE_INACTIVE' } });
    expect((await getProject(project.id)).scenes[0]!.popupPlan).toEqual(beforePlan);
  });

  it.each([false, true])('skips inactive SFX scenes when onlyMissing=%s', async (onlyMissing) => {
    const project = await seedVoiceProject();
    await patchProjectScene(project.id, 'scene-1', { sfxPrompt: 'wind' });
    await patchProjectScene(project.id, 'scene-2', { sfxPrompt: 'rain' });
    await setProjectSceneActive(project.id, 'scene-1', false);
    mocks.searchSfx.mockResolvedValue({ audio: Buffer.from('sfx'), reason: 'ok', sound: null, query: 'rain' });
    const logs: string[] = [];

    const summary = await generateProjectSfx(project.id, async (message) => { logs.push(message); }, async () => {}, { onlyMissing });

    expect(summary).toMatchObject({ generated: 1, skippedInactive: 1 });
    expect(mocks.searchSfx).toHaveBeenCalledTimes(1);
    expect(mocks.searchSfx).toHaveBeenCalledWith('rain');
    expect((await getProject(project.id)).scenes[0]!.sfxFileId).toBeNull();
    expect(logs.at(-1)).toContain('skippedInactive: 1');
  });

  it('finishes an all-inactive depth-map batch without calling the service', async () => {
    const project = await seedVoiceProject();
    await setProjectSceneActive(project.id, 'scene-1', false);
    await setProjectSceneActive(project.id, 'scene-2', false);
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const logs: string[] = [];
    const progress: number[] = [];

    const result = await generateProjectDepthMaps(project.id, async (line) => { logs.push(line); }, async (percent) => { progress.push(percent); }, async () => false);

    expect(result).toMatchObject({ skippedInactive: 2 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(progress).toEqual([100]);
    expect(logs.some((line) => line.includes('skippedInactive: 2'))).toBe(true);
  });

  it('toggles a scene through the version-guarded route and rejects stale or missing targets', async () => {
    const project = await seedProject();
    const base = await startVideoRouterServer(vi.fn() as unknown as VideoEnqueue);
    const toggle = await fetch(`${base}/api/project/${project.id}/scenes/scene-1/active`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: false, expectedVersion: project.version }),
    });
    expect(toggle.status).toBe(200);
    expect(await toggle.json()).toMatchObject({ version: project.version + 1, scenes: [{ active: false }] });

    const stale = await fetch(`${base}/api/project/${project.id}/scenes/scene-1/active`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: true, expectedVersion: project.version }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: 'PROJECT_CHANGED' } });

    const missing = await fetch(`${base}/api/project/${project.id}/scenes/missing/active`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: false }),
    });
    expect(missing.status).toBe(404);
  });

  it.each([
    ['render-full-video', 'RENDER_IN_PROGRESS'],
    ['generate-voiceover', 'PROJECT_JOB_IN_PROGRESS'],
    ['align-word-timings', 'PROJECT_JOB_IN_PROGRESS'],
    ['analyze-popups', 'POPUP_ANALYSIS_IN_PROGRESS'],
    ['generate-all-sfx', 'PROJECT_JOB_IN_PROGRESS'],
    ['generate-depth-maps', 'PROJECT_JOB_IN_PROGRESS'],
    ['generate-depth-map', 'PROJECT_JOB_IN_PROGRESS'],
    ['generate-visual-prompts', 'PROJECT_JOB_IN_PROGRESS'],
    ['split-scenes', 'PROJECT_JOB_IN_PROGRESS'],
    ['generate-script', 'PROJECT_JOB_IN_PROGRESS'],
    ['final-qa', 'PROJECT_JOB_IN_PROGRESS'],
    ['regenerate-chapters-claude-cli', 'PROJECT_JOB_IN_PROGRESS'],
  ])('refuses a scene toggle while %s is active', async (jobType, code) => {
    const project = await seedProject();
    const getActiveJob = vi.fn(async (_projectId: string, type: string) => type === jobType ? { id: 'job-active', payload: {} } : null);
    const base = await startVideoRouterServer(vi.fn() as unknown as VideoEnqueue, undefined, { getActiveJob });

    const response = await fetch(`${base}/api/project/${project.id}/scenes/scene-1/active`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: false }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code, message: expect.any(String) } });
    expect((await getProject(project.id)).scenes[0]?.active).toBe(true);
    expect(getActiveJob).toHaveBeenCalledWith(project.id, jobType);
  });

  it('records the losing popup when a pin creates a same-scene conflict', async () => {
    const project = await seedPopupPlanProject();
    const stored = (await getProject(project.id)).scenes[0]!;
    const existing = stored.popupPlan!;
    await setProjectScenePopupPlans(project.id, [{
      sceneId: 'scene-1',
      expectedNarration: stored.narration,
      expectedAudioFileId: stored.audioFileId!,
      popupPlan: {
        ...existing,
        popups: [...existing.popups, { kind: 'event', anchor: 'quân', display: 'Quân ta', importance: 5, reason: 'Cùng đoạn lời dẫn.', startSec: 0.3, endSec: 3.4, status: 'kept', dropReason: null, pinned: false, suppressed: false }],
      },
    }]);
    const base = await startVideoRouterServer(vi.fn() as unknown as VideoEnqueue);
    const response = await fetch(`${base}/api/project/${project.id}/scenes/scene-1/popup-plan/flags`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anchor: 'Sông Tiền', pinned: true }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { project: { scenes: Array<{ popupPlan: { generatedAt: string; popups: Array<{ anchor: string }>; dropped: Array<{ anchor: string; dropReason: string | null }> } | null }> }; conflicts: Array<{ anchor: string; reason: string }> };
    expect(body.conflicts).toEqual([{ sceneId: 'scene-1', sceneNumber: 1, anchor: 'quân', reason: 'gần popup khác' }]);
    expect(body.project.scenes[0]!.popupPlan?.dropped).toEqual(expect.arrayContaining([expect.objectContaining({ anchor: 'quân', dropReason: 'gần popup khác' })]));
    expect(body.project.scenes[0]!.popupPlan?.generatedAt).toBe('2026-10-13T00:00:00.000Z');

    const repeat = await fetch(`${base}/api/project/${project.id}/scenes/scene-1/popup-plan/flags`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anchor: 'Sông Tiền', pinned: true }),
    });
    expect((await repeat.json()).conflicts).toEqual([]);
  });

  it('validates an inline popup edit and preserves the stored flags', async () => {
    const project = await seedPopupPlanProject();
    const base = await startVideoRouterServer(vi.fn() as unknown as VideoEnqueue);
    const response = await fetch(`${base}/api/project/${project.id}/scenes/scene-1/popup-plan`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'place', anchor: 'Sông Tiền', display: 'Sông Tiền — địa danh', importance: 5, reason: 'Tên địa danh cần nhớ.' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { project: { scenes: Array<{ popupPlan: { popups: Array<{ display: string; pinned: boolean }> } | null }> } };
    expect(body.project.scenes[0]!.popupPlan?.popups[0]).toMatchObject({ display: 'Sông Tiền — địa danh', pinned: true });
  });

  it('validates and enqueues an optional voiceover start scene while preserving the default payload', async () => {
    const project = await seedVoiceProject();
    const enqueueJob = vi.fn().mockResolvedValue({ id: 'job-1' });
    const base = await startVideoRouterServer(enqueueJob as unknown as VideoEnqueue);

    const valid = await fetch(`${base}/api/project/${project.id}/scenes/generate-voiceover`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startSceneId: 'scene-2' }),
    });
    expect(valid.status).toBe(201);
    expect(enqueueJob).toHaveBeenCalledWith({ type: 'generate-voiceover', projectId: project.id, payload: { projectId: project.id, startSceneId: 'scene-2' } });

    enqueueJob.mockClear();
    const defaultResponse = await fetch(`${base}/api/project/${project.id}/scenes/generate-voiceover`, { method: 'POST' });
    expect(defaultResponse.status).toBe(201);
    expect(enqueueJob).toHaveBeenCalledWith({ type: 'generate-voiceover', projectId: project.id, payload: { projectId: project.id } });

    enqueueJob.mockClear();
    const invalid = await fetch(`${base}/api/project/${project.id}/scenes/generate-voiceover`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startSceneId: 'unknown' }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { message: expect.stringContaining('scene') } });
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('persists the validated voice speed through its setting route', async () => {
    const project = await seedProject();
    const base = await startVideoRouterServer(vi.fn() as unknown as VideoEnqueue);
    const response = await fetch(`${base}/api/project/${project.id}/voice-speed`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voiceSpeed: 1.2 }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).voiceSpeed).toBe(1.2);

    const invalid = await fetch(`${base}/api/project/${project.id}/voice-speed`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voiceSpeed: 1.11 }),
    });
    expect(invalid.status).toBe(400);
  });

  it('rejects a voiceover batch start scene when it is inactive', async () => {
    const project = await seedVoiceProject();
    await setProjectSceneActive(project.id, 'scene-2', false);
    const enqueueJob = vi.fn().mockResolvedValue({ id: 'job-inactive-start' });
    const base = await startVideoRouterServer(enqueueJob);

    const response = await fetch(`${base}/api/project/${project.id}/scenes/generate-voiceover`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startSceneId: 'scene-2' }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'SCENE_INACTIVE' } });
    expect(enqueueJob).not.toHaveBeenCalled();
  });
  it('serves project scene popup previews from the same selector used by Remotion', async () => {
    const project = await seedProject();
    const narration = 'Trên sông Tiền hôm nay.';
    await patchProjectScene(project.id, 'scene-1', { narration });
    await patchProjectScene(project.id, 'scene-1', { audioFileId: 'voice-1' });
    const words = [
      { text: 'Trên', startSec: 0, endSec: .2 }, { text: 'sông', startSec: .3, endSec: .5 },
      { text: 'Tiền', startSec: .5, endSec: .8 }, { text: 'hôm', startSec: 2, endSec: 2.2 }, { text: 'nay.', startSec: 4, endSec: 4.3 },
    ];
    await setSceneWordTimings(project.id, 'scene-1', 'voice-1', narration, { audioFileId: 'voice-1', words });
    await setProjectSceneNameCandidates(project.id, [{
      sceneId: 'scene-1', expectedNarration: narration, expectedAudioFileId: 'voice-1',
      nameCandidates: { narrationHash: hashNarration(narration), audioFileId: 'voice-1', provider: 'deepseek', model: 'deepseek-chat', generatedAt: '2026-10-07T00:00:00.000Z', candidates: [{ phrase: 'Sông Tiền', kind: 'place' }] },
    }]);
    expect(await getProject(project.id)).toMatchObject({ keywordPopupsEnabled: true, scenes: [{ narration, audioFileId: 'voice-1', nameCandidates: { candidates: [{ phrase: 'Sông Tiền' }] } }] });
    const base = await startVideoRouterServer(vi.fn() as unknown as VideoEnqueue);

    const response = await fetch(`${base}/api/project/${project.id}/name-keywords/previews`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ sceneId: 'scene-1', popup: null }]);

    await setProjectScenePopupPlans(project.id, [{
      sceneId: 'scene-1', expectedNarration: narration, expectedAudioFileId: 'voice-1',
      popupPlan: {
        narrationHash: hashNarration(narration), audioFileId: 'voice-1', provider: 'deepseek', model: 'deepseek-chat', backend: 'api', density: 'low', generatedAt: '2026-10-13T00:00:00.000Z', needed: true, reason: 'Cần hiển thị địa danh chính.',
        popups: [{ kind: 'place', anchor: words.slice(1, 3).map((word) => word.text).join(' '), display: 'Sông Tiền', importance: 4, reason: 'Địa danh chính.', startSec: .3, endSec: 3.8, status: 'kept', dropReason: null, pinned: false, suppressed: false }], dropped: [],
      },
    }]);
    const freshResponse = await fetch(`${base}/api/project/${project.id}/name-keywords/previews`);
    expect(await freshResponse.json()).toEqual([{ sceneId: 'scene-1', popup: { text: 'Sông Tiền', type: 'place', source: 'ai' } }]);
  });

  it('returns the manual name-popup analysis summary', async () => {
    const project = await seedProject();
    const summary = { scenesAnalyzed: 3, scenesSkippedNoTimings: 1, scenesWithName: 2, rejectedCandidates: 1, provider: 'deepseek', model: 'deepseek-chat', skippedInactive: 0 } satisfies NameKeywordAnalysisSummary;
    const analyzeNameKeywords = vi.fn().mockResolvedValue(summary);
    const base = await startVideoRouterServer(vi.fn() as unknown as VideoEnqueue, analyzeNameKeywords);

    const response = await fetch(`${base}/api/project/${project.id}/name-keywords/analyze`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(summary);
    expect(analyzeNameKeywords).toHaveBeenCalledWith(project.id);
  });

  it('rejects name-popup analysis while a full render is active', async () => {
    const project = await seedProject();
    await insertJob({ type: 'render-full-video', projectId: project.id, payload: { projectId: project.id } });
    const analyzeNameKeywords = vi.fn();
    const base = await startVideoRouterServer(vi.fn() as unknown as VideoEnqueue, analyzeNameKeywords);

    const response = await fetch(`${base}/api/project/${project.id}/name-keywords/analyze`, { method: 'POST' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'RENDER_IN_PROGRESS' } });
    expect(analyzeNameKeywords).not.toHaveBeenCalled();
  });

  it('maps analysis service failures without changing their status or code', async () => {
    const project = await seedProject();
    const analyzeNameKeywords = vi.fn().mockRejectedValue(new AppError('AI không trả về tên hợp lệ.', 422, 'NAME_CANDIDATES_REJECTED'));
    const base = await startVideoRouterServer(vi.fn() as unknown as VideoEnqueue, analyzeNameKeywords);

    const response = await fetch(`${base}/api/project/${project.id}/name-keywords/analyze`, { method: 'POST' });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'NAME_CANDIDATES_REJECTED', message: 'AI không trả về tên hợp lệ.' } });
  });

  it('uploads, replaces, and removes the project logo through the dedicated routes', async () => {
    const project = await seedProject();
    const base = await startVideoRouterServer(vi.fn().mockResolvedValue({ id: 'job-1' }) as unknown as VideoEnqueue);
    const form = () => { const value = new FormData(); value.append('file', new Blob([Buffer.from('png')], { type: 'image/png' }), 'logo.png'); return value; };

    const uploaded = await fetch(`${base}/api/project/${project.id}/logo`, { method: 'PUT', body: form() });
    expect(uploaded.status).toBe(200);
    const first = await uploaded.json() as { logoFileId: string };
    expect(first.logoFileId).toEqual(expect.any(String));
    const store = createFileStoreService(filesDir);
    expect(await store.listProjectFiles(project.id)).toContainEqual(expect.objectContaining({ id: first.logoFileId, purpose: 'logo' }));

    const replaced = await fetch(`${base}/api/project/${project.id}/logo`, { method: 'PUT', body: form() });
    const second = await replaced.json() as { logoFileId: string };
    expect(second.logoFileId).not.toBe(first.logoFileId);
    const filesAfterReplace = await store.listProjectFiles(project.id);
    expect(filesAfterReplace.filter((file) => file.purpose === 'logo')).toHaveLength(1);
    expect(filesAfterReplace.find((file) => file.id === first.logoFileId)).toBeUndefined();

    const removed = await fetch(`${base}/api/project/${project.id}/logo`, { method: 'DELETE' });
    expect((await removed.json()).logoFileId).toBeNull();
    expect((await store.listProjectFiles(project.id)).filter((file) => file.purpose === 'logo')).toHaveLength(0);
    const removedAgain = await fetch(`${base}/api/project/${project.id}/logo`, { method: 'DELETE' });
    expect(removedAgain.status).toBe(200);
  });

  it('rejects missing and non-image logos with Vietnamese 4xx errors', async () => {
    const project = await seedProject();
    const base = await startVideoRouterServer(vi.fn().mockResolvedValue({ id: 'job-1' }) as unknown as VideoEnqueue);
    const missing = await fetch(`${base}/api/project/${project.id}/logo`, { method: 'PUT' });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: { code: 'FILE_REQUIRED' } });
    const pdf = new FormData();
    pdf.append('file', new Blob([Buffer.from('pdf')], { type: 'application/pdf' }), 'logo.pdf');
    const invalid = await fetch(`${base}/api/project/${project.id}/logo`, { method: 'PUT', body: pdf });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: 'INVALID_FILE_TYPE' } });
  });

  it('maps an oversized logo upload to a Vietnamese 4xx error', async () => {
    const project = await seedProject();
    const app = createApp({ filesDir, clientDir: null });
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    const form = new FormData();
    form.append('file', new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: 'image/png' }), 'large.png');
    const response = await fetch(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/project/${project.id}/logo`, { method: 'PUT', body: form });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'FILE_TOO_LARGE', message: expect.stringContaining('vượt quá') } });
  }, 30_000);

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

  it('persists a validated scene-tail setting and copies it on duplicate', async () => {
    const project = await seedProject();
    const base = await startVideoRouterServer(vi.fn() as unknown as VideoEnqueue);
    expect(project.sceneTailSec).toBe(0.2);
    expect((await setProjectSceneTailSec(project.id, 0.35)).sceneTailSec).toBe(0.35);

    for (const sceneTailSec of [0, 0.2, 2]) {
      const response = await fetch(`${base}/api/project/${project.id}/scene-tail`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sceneTailSec }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).sceneTailSec).toBe(sceneTailSec);
    }
    expect((await duplicateProject(project.id)).sceneTailSec).toBe(2);

    for (const body of [{ sceneTailSec: -0.01 }, { sceneTailSec: 2.01 }, { sceneTailSec: 0.005 }, { sceneTailSec: 0.2, extra: true }]) {
      const invalid = await fetch(`${base}/api/project/${project.id}/scene-tail`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      expect(invalid.status).toBe(400);
    }
  });

  it('defaults, persists, validates, and duplicates the project SFX volume', async () => {
    const project = await seedProject();
    const base = await startVideoRouterServer(vi.fn() as unknown as VideoEnqueue);
    expect(project.sfxVolume).toBe(0.5);
    expect((await setProjectSfxVolume(project.id, 0.65)).sfxVolume).toBe(0.65);

    const valid = await fetch(`${base}/api/project/${project.id}/sfx-volume`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sfxVolume: 0.7 }),
    });
    expect(valid.status).toBe(200);
    expect((await valid.json()).sfxVolume).toBe(0.7);
    expect((await duplicateProject(project.id)).sfxVolume).toBe(0.7);

    for (const body of [{ sfxVolume: -0.01 }, { sfxVolume: 1.01 }, { sfxVolume: 0.555 }, { sfxVolume: 0.5, extra: true }]) {
      const invalid = await fetch(`${base}/api/project/${project.id}/sfx-volume`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      expect(invalid.status).toBe(400);
    }
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
    expect(appSource).toContain('configureVideoModule(options.filesDir, options.remotionPublicDir, options.remotionConcurrency)');
    expect(workerSource).toContain('configureVideoModule(config.FILES_DIR, config.REMOTION_PUBLIC_DIR, config.REMOTION_CONCURRENCY)');
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
    const retrySfxResponse = await fetch(`${base}/api/project/${project.id}/scenes/generate-all-sfx`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ onlyMissing: true }) });
    expect(retrySfxResponse.status).toBe(201);
    const strictSfx = await fetch(`${base}/api/project/${project.id}/scenes/generate-all-sfx`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ onlyMissing: true, extra: true }) });
    expect(strictSfx.status).toBe(400);
    await fetch(`${base}/api/project/${project.id}/render`, { method: 'POST' });
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'generate-voiceover', projectId: project.id, payload: { projectId: project.id } }));
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'align-word-timings', projectId: project.id, payload: { projectId: project.id } }));
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'generate-all-sfx', projectId: project.id, payload: { projectId: project.id, onlyMissing: false } }));
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'generate-all-sfx', projectId: project.id, payload: { projectId: project.id, onlyMissing: true } }));
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'render-full-video', projectId: project.id, payload: { projectId: project.id, draft: false } }));

    const strictDraft = await fetch(`${base}/api/project/${project.id}/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft: true, unexpected: true }) });
    expect(strictDraft.status).toBe(400);

    const ffmpegDraft = await fetch(`${base}/api/project/${project.id}/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft: true }) });
    expect(ffmpegDraft.status).toBe(422);
    expect(await ffmpegDraft.json()).toMatchObject({ error: { code: 'DRAFT_REQUIRES_REMOTION' } });
  });

  it('enqueues a Remotion draft flag and worker carries it to render service', async () => {
    const project = await seedProject();
    await setProjectRenderEngine(project.id, 'remotion');
    const enqueueJob = vi.fn().mockResolvedValue({ id: 'job-draft' });
    const base = await startVideoRouterServer(enqueueJob as unknown as VideoEnqueue);

    const response = await fetch(`${base}/api/project/${project.id}/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft: true }) });
    expect(response.status).toBe(201);
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'render-full-video', payload: { projectId: project.id, draft: true } }));
  });

  it('rejects an unready render before enqueueing a job', async () => {
    const project = await createProject(projectInput);
    await replaceProjectScenes(project.id, [{ id: 'scene-1', narration: 'Missing asset', visualPrompt: '', durationSec: 5, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null }]);
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
    mocks.searchSfx.mockResolvedValue({ audio: null, reason: 'no-results', sound: null });
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

  it('silently skips an inactive single-scene depth-map job and reports its count', async () => {
    const project = await seedProject();
    await setProjectSceneActive(project.id, 'scene-1', false);
    const context = {
      isCancelled: vi.fn().mockResolvedValue(false),
      appendLog: vi.fn().mockResolvedValue(undefined),
      reportProgress: vi.fn().mockResolvedValue(undefined),
    };

    const result = await jobHandlers['generate-depth-map']!({ payload: { projectId: project.id, sceneId: 'scene-1' } } as never, context);

    expect(result).toEqual({ skipped: 1, skippedInactive: 1 });
    expect(context.appendLog).toHaveBeenCalledWith(expect.stringContaining('skippedInactive: 1'));
    expect(context.reportProgress).toHaveBeenCalledWith(100);
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
    await replaceProjectScenes(videoProject.id, [{ id: 'video-scene', narration: 'Video', visualPrompt: '', durationSec: 2, assetType: 'video', assetFileId: 'video-1', audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null }]);
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
