import { describe, expect, it, vi } from 'vitest';
import { generateScript, getClaudeCliStatus, getFinalQaManualPrompt, getManualScriptPrompt, getRegenerationManualPrompt, importFinalQa, importManualScript, importRegeneratedChapter, isHardStopRegenerationError, parseSseFrames, QAResultSchema, regenerateChapter, regenerateWithClaudeCli, runFinalQa, setAiProvider } from './api';

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

  it('keeps legacy error messages per-chapter and classifies only explicit provider outages as hard stops', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('event: error\ndata: "Provider unavailable"\n\n', { status: 200 }))
      .mockResolvedValueOnce(new Response('event: error\ndata: "Legacy failure"\n\nevent: error-details\ndata: {"code":"AI_REQUEST_FAILED","status":503}\n\n', { status: 200 }));
    const request = (historyBatchId: string) => regenerateChapter('project-1', 'chapter-1', { instruction: 'Improve', level: 'medium', historyBatchId }, vi.fn(), new AbortController().signal);
    try {
      const legacyError = await request('legacy-batch').catch((error: unknown) => error);
      expect(legacyError).toMatchObject({ message: 'Provider unavailable' });
      expect(isHardStopRegenerationError(legacyError)).toBe(false);
      const structuredError = await request('structured-batch').catch((error: unknown) => error);
      expect(structuredError).toMatchObject({ message: 'Legacy failure', code: 'AI_REQUEST_FAILED', status: 503 });
      expect(isHardStopRegenerationError(structuredError)).toBe(true);
      expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/project/project-1/chapters/chapter-1/regenerate', expect.objectContaining({ body: JSON.stringify({ instruction: 'Improve', level: 'medium', historyBatchId: 'legacy-batch' }) }));
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('covers six hard-stop and five ordinary chapter-failure classifications', () => {
    const error = (code?: string, status?: number) => Object.assign(new Error('failure'), { code, status });
    const hardStops = [
      error('AI_KEY_MISSING', 400),
      error('AI_REQUEST_FAILED', 401),
      error('AI_REQUEST_FAILED', 403),
      error('AI_REQUEST_FAILED', 429),
      error('AI_REQUEST_FAILED', 502),
      error('AI_REQUEST_FAILED', 503),
    ];
    const chapterFailures = [error(), error('AI_REQUEST_FAILED', 400), error('AI_REQUEST_FAILED', 402), error('conflict', 409), error('AI_REQUEST_FAILED')];
    expect(hardStops.map(isHardStopRegenerationError)).toEqual([true, true, true, true, true, true]);
    expect(chapterFailures.map(isHardStopRegenerationError)).toEqual([false, false, false, false, false]);
  });
});

describe('script generation API', () => {
  it('posts resume mode to the existing script-generation route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ jobId: 'job-script-1' }), { status: 201 }));

    await expect(generateScript('project/1', { resume: true })).resolves.toEqual({ jobId: 'job-script-1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/generate-script', expect.objectContaining({ method: 'POST', body: JSON.stringify({ resume: true }) }));
    fetchMock.mockRestore();
  });

  it('posts the local Claude CLI backend and selected model to the shared script-generation route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ jobId: 'job-script-cli' }), { status: 201 }));

    await expect(generateScript('project/1', { backend: 'cli', cliModel: null })).resolves.toEqual({ jobId: 'job-script-cli' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/generate-script', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ backend: 'cli', cliModel: null }),
    }));
    fetchMock.mockRestore();
  });

  it('uses the provider PATCH route and manual prompt/import contracts', async () => {
    const project = { id: 'project-1', title: 'Project', status: 'draft', language: 'vi', brief: 'A sufficiently long brief', referencesText: '', scriptPresetId: 'documentary', targetDurationSec: 60, chapterCount: 1, voiceId: null, aiProvider: 'claude', renderEngine: 'ffmpeg', voiceoverVoice: 'Truc Ly', renderFileId: null, bgmMood: '', bgmFileId: null, renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 }, scenes: [], chapters: [], openLoops: [], motif: null, version: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const quality = { totalWords: 70, targetWords: 150, differenceWords: -80, targetPercent: 46.7, outsideLengthRange: true, plannedWords: 150, plannedDifferenceWords: 0, plannedDeviationPct: 0, plannedBudgetWarning: false, actShares: [], chapters: [], warnings: ['Total narration is outside 85–115% of the target word budget.'] };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const body = url.endsWith('manual-prompt') ? { prompt: 'SYSTEM\n...', promptVersion: 'script-prompt-v2/documentary@2' } : url.endsWith('manual-import') ? { project, quality } : project;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    await expect(setAiProvider('project/1', 'claude')).resolves.toMatchObject({ aiProvider: 'claude' });
    await expect(getManualScriptPrompt('project/1')).resolves.toEqual({ prompt: 'SYSTEM\n...', promptVersion: 'script-prompt-v2/documentary@2' });
    await expect(importManualScript('project/1', 'raw text')).resolves.toMatchObject({ project: { id: 'project-1' }, quality: { totalWords: 70, outsideLengthRange: true } });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/project/project%2F1/ai-provider', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ provider: 'claude' }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/project/project%2F1/generate-script/manual-prompt', expect.objectContaining({ method: 'GET' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/project/project%2F1/generate-script/manual-import', expect.objectContaining({ method: 'POST', body: JSON.stringify({ raw: 'raw text' }) }));
  });

  it('sends a selected model through the existing provider PATCH route', async () => {
    const project = { id: 'project-1', title: 'Project', status: 'draft', language: 'vi', brief: 'A sufficiently long brief', referencesText: '', scriptPresetId: 'documentary', targetDurationSec: 60, chapterCount: 1, voiceId: null, aiProvider: 'deepseek', aiModel: 'deepseek-flash', renderEngine: 'ffmpeg', voiceoverVoice: 'Truc Ly', renderFileId: null, bgmMood: '', bgmFileId: null, renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 }, scenes: [], chapters: [], openLoops: [], motif: null, version: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(project), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(setAiProvider('project/1', 'deepseek', 'deepseek-flash')).resolves.toMatchObject({ aiModel: 'deepseek-flash' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%2F1/ai-provider', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ provider: 'deepseek', aiModel: 'deepseek-flash' }),
    }));
  });
});

describe('Claude CLI regeneration API', () => {
  it('reads CLI availability and enqueues a chapter batch with its local model selection', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ available: true, version: 'Claude Code 2.1.294', authPathLikely: 'subscription' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job-cli-1' }), { status: 201 }));

    await expect(getClaudeCliStatus()).resolves.toMatchObject({ available: true, version: 'Claude Code 2.1.294' });
    await expect(regenerateWithClaudeCli('project/1', {
      chapterIds: ['chapter-1', 'chapter-2'], instruction: 'Tighten the opening', level: 'medium', model: 'claude-sonnet-5-5',
    })).resolves.toEqual({ jobId: 'job-cli-1' });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/script/cli-status', expect.objectContaining({ method: 'GET' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/project/project%2F1/chapters/regenerate/cli', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ chapterIds: ['chapter-1', 'chapter-2'], instruction: 'Tighten the opening', level: 'medium', model: 'claude-sonnet-5-5' }),
    }));
    fetchMock.mockRestore();
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
    const quality = { totalWords: 70, targetWords: 150, differenceWords: -80, targetPercent: 46.7, outsideLengthRange: true, plannedWords: 150, plannedDifferenceWords: 0, plannedDeviationPct: 0, plannedBudgetWarning: false, actShares: [], chapters: [], warnings: [] };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt: 'SYSTEM\n...', promptVersion: 'script-prompt-v2/documentary@2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ chapter: { id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Updated'], status: 'pending', scenesCount: null, durationSec: null }, quality }), { status: 200 }));

    await expect(getRegenerationManualPrompt('project/1', 'chapter/1', { instruction: 'Shorter', level: 'light' })).resolves.toEqual({ prompt: 'SYSTEM\n...', promptVersion: 'script-prompt-v2/documentary@2' });
    await expect(importRegeneratedChapter('project/1', 'chapter/1', '{"paragraphs":["Updated"]}')).resolves.toMatchObject({ chapter: { id: 'chapter-1', paragraphs: ['Updated'] }, quality: { totalWords: 70 } });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/project/project%2F1/chapters/chapter%2F1/regenerate/manual-prompt', expect.objectContaining({ method: 'POST', body: JSON.stringify({ instruction: 'Shorter', level: 'light' }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/project/project%2F1/chapters/chapter%2F1/regenerate/manual-import', expect.objectContaining({ method: 'POST', body: JSON.stringify({ raw: '{"paragraphs":["Updated"]}' }) }));
    fetchMock.mockRestore();
  });
});
