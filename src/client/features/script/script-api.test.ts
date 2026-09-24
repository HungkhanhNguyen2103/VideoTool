import { describe, expect, it, vi } from 'vitest';
import { getManualScriptPrompt, importManualScript, parseSseFrames, runFinalQa, setAiProvider } from './api';

describe('script SSE parser', () => {
  it('buffers incomplete frames and returns complete events in order', () => {
    const first = parseSseFrames('event: chunk\ndata: "one"\n\nevent: done\ndata: {"id":"c1"}\n\npartial');
    expect(first.frames).toEqual([
      { event: 'chunk', data: '"one"' },
      { event: 'done', data: '{"id":"c1"}' },
    ]);
    expect(first.remainder).toBe('partial');
  });

  it('ignores heartbeat comments and parses default message events', () => {
    const result = parseSseFrames(': heartbeat\n\ndata: {"status":"running"}\n\n');
    expect(result.frames).toEqual([{ event: 'message', data: '{"status":"running"}' }]);
  });
});

describe('script generation API', () => {
  it('uses the provider PATCH route and manual prompt/import contracts', async () => {
    const project = { id: 'project-1', title: 'Project', status: 'draft', language: 'vi', brief: 'A sufficiently long brief', referencesText: '', scriptPresetId: 'documentary', targetDurationSec: 60, chapterCount: 1, voiceId: null, aiProvider: 'claude', renderEngine: 'ffmpeg', voiceoverVoice: 'Truc Ly', renderFileId: null, bgmMood: '', bgmFileId: null, renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 }, scenes: [], chapters: [], openLoops: [], motif: null, version: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const body = url.endsWith('manual-prompt') ? { prompt: 'SYSTEM\n...', promptVersion: 'script-prompt-v1/documentary@2' } : project;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    await expect(setAiProvider('project/1', 'claude')).resolves.toMatchObject({ aiProvider: 'claude' });
    await expect(getManualScriptPrompt('project/1')).resolves.toEqual({ prompt: 'SYSTEM\n...', promptVersion: 'script-prompt-v1/documentary@2' });
    await expect(importManualScript('project/1', 'raw text')).resolves.toMatchObject({ id: 'project-1' });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/project/project%2F1/ai-provider', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ provider: 'claude' }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/project/project%2F1/generate-script/manual-prompt', expect.objectContaining({ method: 'GET' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/project/project%2F1/generate-script/manual-import', expect.objectContaining({ method: 'POST', body: JSON.stringify({ raw: 'raw text' }) }));
  });
});

describe('final QA API', () => {
  it('posts to the project QA route and returns the queued job id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ jobId: 'job-qa-1' }), { status: 201 }));

    await expect(runFinalQa('project/1')).resolves.toEqual({ jobId: 'job-qa-1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/qa', expect.objectContaining({ method: 'POST' }));
    fetchMock.mockRestore();
  });
});
