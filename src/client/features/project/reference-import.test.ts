import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendReferenceText, importProjectSeed, mergeProjectPrefill, readReferenceText } from './reference-import';

describe('reference imports', () => {
  afterEach(() => vi.restoreAllMocks());
  it('appends extracted text without replacing existing references', () => {
    expect(appendReferenceText('Existing notes', 'Imported notes')).toBe('Existing notes\n\nImported notes');
    expect(appendReferenceText('', 'Imported notes')).toBe('Imported notes');
    expect(appendReferenceText('Existing notes', '')).toBe('Existing notes');
  });

  it('reads plain text files locally', async () => {
    const file = new File(['Hello markdown'], 'notes.md', { type: 'text/markdown' });
    await expect(readReferenceText(file)).resolves.toBe('Hello markdown');
  });

  it('merges a ZIP seed into the current form and keeps existing references', () => {
    const current = {
      title: 'Current', language: 'vi' as const, brief: 'Current brief', referencesText: 'Existing', scriptPresetId: 'documentary' as const,
      visualStylePresetId: 'cinematic' as const, targetDurationSec: 180, chapterCount: null, voiceId: null, aiProvider: 'deepseek' as const,
      renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
    };
    expect(mergeProjectPrefill(current, { title: 'Imported', referencesText: 'From ZIP', renderSettings: { aspect: '9:16', fps: 24 } })).toMatchObject({
      title: 'Imported', referencesText: 'Existing\n\nFrom ZIP', renderSettings: { aspect: '9:16', width: 1080, height: 1920, fps: 24 },
    });
  });

  it('resets a model when an imported seed changes provider or names an unavailable model', () => {
    const current = {
      title: 'Current', language: 'vi' as const, brief: 'Current brief', referencesText: '', scriptPresetId: 'documentary' as const,
      visualStylePresetId: 'cinematic' as const, targetDurationSec: 180, chapterCount: null, voiceId: null,
      aiProvider: 'deepseek' as const, aiModel: 'deepseek-flash',
      renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
    };

    expect(mergeProjectPrefill(current, { aiProvider: 'claude' })).toMatchObject({ aiProvider: 'claude', aiModel: 'claude-opus-4-5' });
    expect(mergeProjectPrefill(current, { aiModel: 'deepseek-retired' })).toMatchObject({ aiProvider: 'deepseek', aiModel: 'deepseek-chat' });
  });

  it('posts ZIP seeds as multipart and parses the response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ title: 'Imported' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(importProjectSeed(new File(['zip'], 'seed.zip', { type: 'application/zip' }))).resolves.toEqual({ title: 'Imported' });
    expect(fetchMock).toHaveBeenCalledWith('/api/project/import-seed', expect.objectContaining({ method: 'POST', body: expect.any(FormData) }));
  });

  it('rejects a non-ZIP seed before changing any form state', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(importProjectSeed(new File(['bad'], 'seed.txt', { type: 'text/plain' }))).rejects.toThrow('ZIP');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
