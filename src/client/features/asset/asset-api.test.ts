import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { ProjectDetail } from '../../../contracts/project';
import { AI_PROVIDER_OPTIONS, VISUAL_STYLE_OPTIONS, alignWordTimings, analyzeProjectNameKeywords, applyVideoDistribution, fileUrlForSummary, filesByPurpose, fitSceneToClip, generateAllSfx, generateAllVoiceovers, generateBgm, generateDepthMaps, generateSceneSfx, generateVisualPrompts, getNameKeywordPreviews, isProjectJobActive, missingSceneNumbers, patchScene, previewScene, previewVideoDistribution, recomputeSceneDurations, regenerateVoiceover, removeProjectLogo, renderProject, mediaTypeForMime, selectedRenderEngine, setAiProvider, setFilmLook, setKeywordPopups, setParallax, setRenderEngine, setSceneTail, setSfxVolume, setTransitionStyle, setVisualStyle, setVoiceSpeed, splitScenes, uploadProjectLogo, voiceoverSummary } from './api';

const project = {
  id: 'project-1',
  scenes: [
    { id: 'scene-1', narration: 'One', visualPrompt: '', durationSec: 5, assetType: 'image', assetFileId: 'asset-1', audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null },
    { id: 'scene-2', narration: 'Two', visualPrompt: '', durationSec: 5, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null },
  ],
} as unknown as ProjectDetail;
const projectPayload = {
  id: 'project-1', title: 'Project', status: 'assets', language: 'vi', brief: 'Brief', referencesText: '', scriptPresetId: 'documentary', targetDurationSec: 60, chapterCount: 1, voiceId: null,
  aiProvider: 'deepseek', renderEngine: 'ffmpeg', voiceoverVoice: 'Truc Ly', renderFileId: null, draftRenderFileId: null, bgmMood: '', bgmFileId: null,
  customStyleReferenceFileId: null, logoFileId: null,
  renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 }, scenes: project.scenes, chapters: [], version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

afterEach(() => vi.restoreAllMocks());

describe('asset API helpers', () => {
  it('sends the project voice speed to the setting route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ...projectPayload, voiceSpeed: 1.2 }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(setVoiceSpeed('project/1', 1.2)).resolves.toMatchObject({ voiceSpeed: 1.2 });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/voice-speed', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ voiceSpeed: 1.2 }) }));
  });
  it('previews and applies video distribution through the exact routes and bodies', async () => {
    const preview = { total: 2, videoCount: 1, imageCount: 1, lockedCount: 0, changes: [], videoSceneNumbers: [1], projectVersion: 7 };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(projectPayload), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(previewVideoDistribution('project/1', 20)).resolves.toEqual(preview);
    await expect(applyVideoDistribution('project/1', 20, 7)).resolves.toMatchObject({ id: 'project-1' });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/project/project%2F1/scenes/video-distribution/preview', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ targetPercent: 20 }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/project/project%2F1/scenes/video-distribution/apply', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ targetPercent: 20, expectedVersion: 7 }),
    }));
  });

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

  it('sends the draft flag to the render route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ jobId: 'job-draft' }), { status: 201, headers: { 'content-type': 'application/json' } }));

    await expect(renderProject('project/1', true)).resolves.toEqual({ jobId: 'job-draft' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/render', expect.objectContaining({ method: 'POST', body: JSON.stringify({ draft: true }) }));
  });

  it('uploads and removes a project logo through the dedicated routes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(projectPayload), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(projectPayload), { status: 200, headers: { 'content-type': 'application/json' } }));
    const file = new File(['png'], 'logo.png', { type: 'image/png' });
    await uploadProjectLogo('project/1', file);
    await removeProjectLogo('project/1');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/project/project%2F1/logo');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT' });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);
    expect(fetchMock.mock.calls[1]).toEqual(['/api/project/project%2F1/logo', { method: 'DELETE' }]);
  });

  it('fits a scene to its clip through the versioned route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(projectPayload), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(fitSceneToClip('project/1', 'scene/1', 7)).resolves.toMatchObject({ id: 'project-1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/scenes/scene%2F1/fit-to-clip', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ expectedVersion: 7 }),
    }));
  });

  it('queues bulk SFX generation through the project route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ jobId: 'job-1' }), { status: 201, headers: { 'content-type': 'application/json' } }));

    await expect(generateAllSfx('project/1')).resolves.toEqual({ jobId: 'job-1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/scenes/generate-all-sfx', expect.objectContaining({ method: 'POST', body: JSON.stringify({ onlyMissing: false }) }));
  });

  it('queues only missing SFX when retrying a failed batch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ jobId: 'job-2' }), { status: 201, headers: { 'content-type': 'application/json' } }));
    await expect(generateAllSfx('project/1', true)).resolves.toEqual({ jobId: 'job-2' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/scenes/generate-all-sfx', expect.objectContaining({ method: 'POST', body: JSON.stringify({ onlyMissing: true }) }));
  });

  it('persists the project SFX relative volume setting', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(projectPayload), { status: 200, headers: { 'content-type': 'application/json' } }));
    await setSfxVolume('project/1', 0.65);
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/sfx-volume', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ sfxVolume: 0.65 }) }));
  });

  it('queues the word-timing backfill through the project route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ jobId: 'job-1' }), { status: 201, headers: { 'content-type': 'application/json' } }));
    await expect(alignWordTimings('project/1')).resolves.toEqual({ jobId: 'job-1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/scenes/align-words', expect.objectContaining({ method: 'POST' }));
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

  it('updates keyword pop-ups with the exact PATCH route and body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(projectPayload), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job-1' }), { status: 201, headers: { 'content-type': 'application/json' } }));

    await setKeywordPopups('project/1', false);

    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/keyword-popups', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ enabled: false }),
    }));
  });

  it('analyzes name popups and fetches typed render-selected previews', async () => {
    const summary = { scenesAnalyzed: 1, scenesSkippedNoTimings: 0, scenesWithName: 1, rejectedCandidates: 0, provider: 'deepseek', model: 'deepseek-chat' };
    const previews = [{ sceneId: 'scene-1', popup: { text: 'Sông Tiền', type: 'place', source: 'ai' } }];
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(summary), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(previews), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(analyzeProjectNameKeywords('project/1')).resolves.toEqual(summary);
    await expect(getNameKeywordPreviews('project/1')).resolves.toEqual(previews);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/project/project%2F1/name-keywords/analyze', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/project/project%2F1/name-keywords/previews', expect.objectContaining({ method: 'GET' }));
  });

  it('patches a scene motion prompt with the exact route and body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(projectPayload), { status: 200, headers: { 'content-type': 'application/json' } }));

    await patchScene('project/1', 'scene/1', { motionPrompt: 'Slow camera push-in.' });

    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/scenes/scene%2F1', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ motionPrompt: 'Slow camera push-in.' }),
    }));
  });

  it('patches narration with the optimistic project version', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(projectPayload), { status: 200, headers: { 'content-type': 'application/json' } }));

    await patchScene('project/1', 'scene/1', { narration: 'Rewritten narration', expectedVersion: 7 });

    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/scenes/scene%2F1', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ narration: 'Rewritten narration', expectedVersion: 7 }),
    }));
  });

  it('formats the bulk voiceover skip summary for the Studio toast', () => {
    expect(voiceoverSummary({ generated: 4, skippedSceneNumbers: [1, 7], failedSceneNumbers: [] })).toBe('Voiceover done for 4 scenes; skipped 2 scenes with no narration (scene numbers 1, 7).');
  });

  it('marks empty-narration scenes and disables their voiceover action', async () => {
    const source = await readFile('src/client/features/asset/StudioPage.tsx', 'utf8');

    expect(source).toContain('Không có lời dẫn');
    expect(source).toContain('!expandedScene.narration.trim()');
  });

  it('exposes the draft render preview contract in Studio', async () => {
    const source = await readFile('src/client/features/asset/StudioPage.tsx', 'utf8');
    expect(source).toContain('Render nháp (nhanh)');
    expect(source).toContain('Chi co o engine Remotion');
    expect(source).toContain('Bản nháp');
    expect(source).toContain("purpose === 'render-draft'");
  });

  it('updates transition style with the exact PATCH route and body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(projectPayload), { status: 200, headers: { 'content-type': 'application/json' } }));

    await setTransitionStyle('project/1', 'crossfade');

    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/transition-style', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ style: 'crossfade' }),
    }));
  });

  it('updates film look with the exact PATCH route and body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(projectPayload), { status: 200, headers: { 'content-type': 'application/json' } }));

    await setFilmLook('project/1', 'always');

    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/film-look', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ style: 'always' }),
    }));
  });

  it('patches scene tail and requests stored-voiceover duration recompute', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(projectPayload), { status: 200, headers: { 'content-type': 'application/json' } }));

    await setSceneTail('project/1', 0.35);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/project/project%2F1/scene-tail', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ sceneTailSec: 0.35 }),
    }));

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ updated: 2, skippedSceneNumbers: [], failedSceneNumbers: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(recomputeSceneDurations('project/1')).resolves.toEqual({ updated: 2, skippedSceneNumbers: [], failedSceneNumbers: [] });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/project/project%2F1/scenes/recompute-durations', expect.objectContaining({ method: 'POST' }));
  });

  it('updates parallax and queues depth maps with exact routes and bodies', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(projectPayload), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job-1' }), { status: 201, headers: { 'content-type': 'application/json' } }));
    await setParallax('project/1', 'auto');
    await generateDepthMaps('project/1');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/project/project%2F1/parallax', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ style: 'auto' }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/project/project%2F1/scenes/generate-depth-maps', expect.objectContaining({ method: 'POST' }));
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
      { value: 'flat-cartoon', label: 'Flat Cartoon' },
      { value: 'strategic-map', label: 'Strategic Map (2D)' },
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
