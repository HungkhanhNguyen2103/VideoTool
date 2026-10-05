import { describe, expect, it, vi } from 'vitest';
import { getFinalQaManualPrompt, getManualScriptPrompt, getRegenerationManualPrompt, importFinalQa, importManualScript, importRegeneratedChapter, parseSseFrames, QAResultSchema, runFinalQa, setAiProvider } from './api';

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
      const body = url.endsWith('manual-prompt') ? { prompt: 'SYSTEM\n...', promptVersion: 'script-prompt-v2/documentary@2' } : project;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    await expect(setAiProvider('project/1', 'claude')).resolves.toMatchObject({ aiProvider: 'claude' });
    await expect(getManualScriptPrompt('project/1')).resolves.toEqual({ prompt: 'SYSTEM\n...', promptVersion: 'script-prompt-v2/documentary@2' });
    await expect(importManualScript('project/1', 'raw text')).resolves.toMatchObject({ id: 'project-1' });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/project/project%2F1/ai-provider', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ provider: 'claude' }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/project/project%2F1/generate-script/manual-prompt', expect.objectContaining({ method: 'GET' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/project/project%2F1/generate-script/manual-import', expect.objectContaining({ method: 'POST', body: JSON.stringify({ raw: 'raw text' }) }));
  });
});

describe('final QA API', () => {
  it('accepts legacy QA results and reviewer metadata while rejecting unknown fields', () => {
    expect(QAResultSchema.parse({ issues: [] })).toEqual({ issues: [] });
    expect(QAResultSchema.parse({ issues: [], reviewedBy: { provider: 'claude', model: 'claude-opus-4-5' } })).toMatchObject({
      reviewedBy: { provider: 'claude', model: 'claude-opus-4-5' },
    });
    expect(QAResultSchema.parse({ issues: [], reviewedBy: { provider: 'manual', model: 'Dán thủ công' } })).toMatchObject({
      reviewedBy: { provider: 'manual', model: 'Dán thủ công' },
    });
    expect(() => QAResultSchema.parse({ issues: [], extra: true })).toThrow();
  });

  it('posts to the project QA route and returns the queued job id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ jobId: 'job-qa-1' }), { status: 201 }));

    await expect(runFinalQa('project/1')).resolves.toEqual({ jobId: 'job-qa-1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/qa', expect.objectContaining({ method: 'POST' }));
    fetchMock.mockRestore();
  });

  it('gets the manual prompt and imports the manual result', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt: 'SYSTEM\n...', promptVersion: 'qa-prompt-v2/documentary@3' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ issues: [], reviewedBy: { provider: 'manual', model: 'Dán thủ công' } }), { status: 200 }));

    await expect(getFinalQaManualPrompt('project/1')).resolves.toEqual({ prompt: 'SYSTEM\n...', promptVersion: 'qa-prompt-v2/documentary@3' });
    await expect(importFinalQa('project/1', '{"issues":[]}')).resolves.toEqual({ issues: [], reviewedBy: { provider: 'manual', model: 'Dán thủ công' } });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/project/project%2F1/qa/manual-prompt', expect.objectContaining({ method: 'GET' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/project/project%2F1/qa/manual-import', expect.objectContaining({ method: 'POST', body: JSON.stringify({ raw: '{"issues":[]}' }) }));
    fetchMock.mockRestore();
  });
});

describe('chapter regeneration manual API', () => {
  it('gets a chapter prompt and imports a parsed chapter through the dedicated routes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt: 'SYSTEM\n...', promptVersion: 'script-prompt-v2/documentary@2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Updated'], status: 'pending', scenesCount: null, durationSec: null }), { status: 200 }));

    await expect(getRegenerationManualPrompt('project/1', 'chapter/1', { instruction: 'Shorter', level: 'light' })).resolves.toEqual({ prompt: 'SYSTEM\n...', promptVersion: 'script-prompt-v2/documentary@2' });
    await expect(importRegeneratedChapter('project/1', 'chapter/1', '{"paragraphs":["Updated"]}')).resolves.toMatchObject({ id: 'chapter-1', paragraphs: ['Updated'] });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/project/project%2F1/chapters/chapter%2F1/regenerate/manual-prompt', expect.objectContaining({ method: 'POST', body: JSON.stringify({ instruction: 'Shorter', level: 'light' }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/project/project%2F1/chapters/chapter%2F1/regenerate/manual-import', expect.objectContaining({ method: 'POST', body: JSON.stringify({ raw: '{"paragraphs":["Updated"]}' }) }));
    fetchMock.mockRestore();
  });
});
