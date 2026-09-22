import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFreesoundClient } from './client';
import { extractSearchQueries, normalizeKeyword } from './keyword-map';

afterEach(() => vi.restoreAllMocks());

describe('Freesound keyword mapping', () => {
  it('maps Vietnamese sound words and strips the tiếng prefix', () => {
    expect(normalizeKeyword('Tiếng Tích Tắc Đồng Hồ')).toBe('tieng tich tac dong ho');
    expect(extractSearchQueries('tiếng tích tắc đồng hồ')).toContain('ticking clock');
    expect(extractSearchQueries('SFX tiếng gió')).toContain('wind');
  });

  it('keeps a cleaned generic fallback query', () => {
    expect(extractSearchQueries('  sound effect   forest ambience  ')).toContain('forest ambience');
  });
});

describe('Freesound client', () => {
  it('does not request when the API key is missing', async () => {
    const fetchMock = vi.fn();
    const client = createFreesoundClient({ apiKey: '', fetchImpl: fetchMock });

    await expect(client.searchAndDownloadSfx('wind')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloads the first SFX preview, preferring HQ MP3', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ previews: { 'preview-hq-mp3': 'https://cdn.test/wind.mp3' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(Buffer.from('mp3'), { status: 200 }));
    const client = createFreesoundClient({ apiKey: 'key', fetchImpl: fetchMock });

    await expect(client.searchAndDownloadSfx('tiếng gió')).resolves.toEqual(Buffer.from('mp3'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('freesound.org/apiv2/search/text');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('query=wind');
  });

  it('returns null for no results and download failures', async () => {
    const noResult = createFreesoundClient({ apiKey: 'key', fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 })) });
    await expect(noResult.searchAndDownloadBgm('calm')).resolves.toBeNull();

    const failedDownload = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ previews: { 'preview-lq-mp3': 'https://cdn.test/bgm.mp3' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('offline', { status: 503 }));
    await expect(createFreesoundClient({ apiKey: 'key', fetchImpl: failedDownload }).searchAndDownloadBgm('calm')).resolves.toBeNull();
  });
});
