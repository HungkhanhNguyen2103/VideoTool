import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../../../contracts/project';
import { AI_PROVIDER_OPTIONS, VISUAL_STYLE_OPTIONS, fileUrlForSummary, filesByPurpose, generateAllSfx, generateAllVoiceovers, generateBgm, generateSceneSfx, generateVisualPrompts, isProjectJobActive, missingSceneNumbers, previewScene, regenerateVoiceover, renderProject, mediaTypeForMime, selectedRenderEngine, setAiProvider, setRenderEngine, setVisualStyle, splitScenes } from './api';

const project = {
  id: 'project-1',
  scenes: [
    { id: 'scene-1', narration: 'One', visualPrompt: '', durationSec: 5, assetType: 'image', assetFileId: 'asset-1', audioFileId: null, sfxPrompt: '', sfxFileId: null },
    { id: 'scene-2', narration: 'Two', visualPrompt: '', durationSec: 5, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', sfxFileId: null },
  ],
} as unknown as ProjectDetail;
const projectPayload = {
  id: 'project-1', title: 'Project', status: 'assets', language: 'vi', brief: 'Brief', referencesText: '', scriptPresetId: 'documentary', targetDurationSec: 60, chapterCount: 1, voiceId: null,
  aiProvider: 'deepseek', renderEngine: 'ffmpeg', voiceoverVoice: 'Truc Ly', renderFileId: null, bgmMood: '', bgmFileId: null,
  renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 }, scenes: project.scenes, chapters: [], version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

afterEach(() => vi.restoreAllMocks());

describe('asset API helpers', () => {
  it('builds a files URL from the generated relative stored path', () => {
    expect(fileUrlForSummary({ storedPath: '01ARZ3NDEKTSV4RRFFQ69G5FAV.png' })).toBe('/files/01ARZ3NDEKTSV4RRFFQ69G5FAV.png');
  });

  it('rejects a path that could escape the files root', () => {
    expect(() => fileUrlForSummary({ storedPath: '../secret.png' })).toThrow('Invalid stored path');
  });

  it('classifies media previews from the stored file MIME type', () => {
    expect(mediaTypeForMime('image/png')).toBe('image');
    expect(mediaTypeForMime('video/mp4')).toBe('video');
    expect(mediaTypeForMime('application/pdf')).toBeNull();
  });

  it('uses typed video routes for jobs and synchronous scene actions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const payload = url.includes('regenerate-voiceover') || url.includes('generate-sfx') || url.includes('generate-bgm') ? projectPayload : { jobId: 'job-1' };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    await generateAllVoiceovers('project/1');
    await regenerateVoiceover('project/1', 'scene/1', { speed: 1.1 });
    await generateSceneSfx('project/1', 'scene/1');
    await generateBgm('project/1', 'calm');
    await renderProject('project/1');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/project/project%2F1/scenes/generate-voiceover', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/project/project%2F1/scenes/scene%2F1/regenerate-voiceover', expect.objectContaining({ body: JSON.stringify({ speed: 1.1 }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/project/project%2F1/scenes/scene%2F1/generate-sfx', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/project/project%2F1/generate-bgm', expect.objectContaining({ body: JSON.stringify({ mood: 'calm' }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/project/project%2F1/render', expect.objectContaining({ method: 'POST' }));
  });

  it('queues visual prompt generation through the project route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ jobId: 'job-1' }), { status: 201, headers: { 'content-type': 'application/json' } }));

    await expect(generateVisualPrompts('project/1')).resolves.toEqual({ jobId: 'job-1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/scenes/generate-visual-prompts', expect.objectContaining({ method: 'POST' }));
  });

  it('queues bulk SFX generation through the project route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ jobId: 'job-1' }), { status: 201, headers: { 'content-type': 'application/json' } }));

    await expect(generateAllSfx('project/1')).resolves.toEqual({ jobId: 'job-1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/scenes/generate-all-sfx', expect.objectContaining({ method: 'POST' }));
  });

  it('queues semantic scene splitting through the project route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ jobId: 'job-1' }), { status: 201, headers: { 'content-type': 'application/json' } }));

    await expect(splitScenes('project/1')).resolves.toEqual({ jobId: 'job-1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/scenes/split', expect.objectContaining({ method: 'POST' }));
  });

  it('keeps a queued project job active through the enqueue-to-progress gap', () => {
    expect(isProjectJobActive(null, null)).toBe(false);
    expect(isProjectJobActive('job-1', null)).toBe(true);
    expect(isProjectJobActive('job-1', { status: 'done' })).toBe(false);
    expect(isProjectJobActive('job-1', { status: 'failed' })).toBe(false);
    expect(isProjectJobActive('job-1', { status: 'cancelled' })).toBe(false);
  });

  it('updates the render engine with the exact PATCH route and body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(projectPayload), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(setRenderEngine('project/1', 'remotion')).resolves.toMatchObject({ renderEngine: 'ffmpeg' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/render-engine', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ engine: 'remotion' }),
    }));
    expect(selectedRenderEngine('remotion')).toBe('remotion');
    expect(selectedRenderEngine('ffmpeg')).toBe('ffmpeg');
  });

  it('exposes AI provider options and updates the provider with the exact PATCH route and body', async () => {
    expect(AI_PROVIDER_OPTIONS).toEqual([
      { value: 'deepseek', label: 'DeepSeek' },
      { value: 'claude', label: 'Claude' },
    ]);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(projectPayload), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(setAiProvider('project/1', 'claude')).resolves.toMatchObject({ aiProvider: 'deepseek' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/ai-provider', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ provider: 'claude' }),
    }));
  });

  it('exposes visual style options and updates the style with the exact PATCH route and body', async () => {
    expect(VISUAL_STYLE_OPTIONS).toEqual([
      { value: 'cinematic', label: 'Cinematic (điện ảnh)' },
      { value: 'anime', label: 'Anime' },
      { value: 'watercolor', label: 'Watercolor (màu nước)' },
      { value: 'photorealistic', label: 'Photorealistic (ảnh thực)' },
    ]);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(projectPayload), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(setVisualStyle('project/1', 'watercolor')).resolves.toMatchObject({ visualStylePresetId: 'cinematic' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/visual-style', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ visualStylePresetId: 'watercolor' }),
    }));
  });

  it('reads video/mp4 previews as blobs and computes file/readiness helpers', async () => {
    const blob = new Blob(['mp4'], { type: 'video/mp4' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(blob, { status: 200, headers: { 'content-type': 'video/mp4' } }));

    await expect(previewScene('project-1', 'scene-1')).resolves.toMatchObject({ type: 'video/mp4' });
    expect(filesByPurpose([
      { purpose: 'voiceover' }, { purpose: 'bgm' }, { purpose: 'render' },
    ] as never, 'voiceover')).toHaveLength(1);
    expect(missingSceneNumbers(project)).toEqual([2]);
  });
});
