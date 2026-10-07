import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFreesoundClient } from './client';
import { extractSearchQueries, normalizeKeyword } from './keyword-map';

afterEach(() => vi.restoreAllMocks());

describe('Freesound keyword mapping', () => {
  it('maps Vietnamese phrases using the reference dictionary before fallback cleaning', () => {
    expect(normalizeKeyword('Tiếng Tích Tắc Đồng Hồ')).toBe('clock ticking');
    expect(normalizeKeyword('tiếng súng')).toBe('gunshot');
    expect(extractSearchQueries('tiếng tích tắc đồng hồ')).toEqual(['clock ticking']);
    expect(extractSearchQueries('SFX tiếng gió')).toEqual(['wind blowing']);
  });

  it('splits prompts, adds the two-word prefix, and deduplicates in first-seen order', () => {
    expect(extractSearchQueries('sound effect forest ambience room, forest ambience room|forest ambience room'))
      .toEqual(['forest ambience room', 'forest ambience']);
  });

  it('keeps a cleaned generic fallback query', () => {
    expect(extractSearchQueries('  sound effect   forest ambience  ')).toEqual(['forest ambience']);
  });

  it('maps battle shouts to ambience and drops unknown Vietnamese phrases', () => {
    expect(extractSearchQueries('tiếng hô xung trận, tiếng súng, tiếng lửa không có trong map'))
      .toEqual(['war drums distant battle ambience', 'gunshot', 'war drums']);
    expect(extractSearchQueries('tiếng lửa không có trong map')).toEqual([]);
  });

  it('returns at most three distinct search queries in prompt order', () => {
    expect(extractSearchQueries('cannon fire, wooden ship creak, river water, night ambience'))
      .toEqual(['cannon fire', 'wooden ship creak', 'river water']);
  });
});

describe('Freesound client', () => {
  it('returns an empty-query result without making a request', async () => {
    const fetchMock = vi.fn();
    const result = await createFreesoundClient({ apiKey: 'key', fetchImpl: fetchMock }).searchSfx('tiếng lửa không có trong map');

    expect(result).toMatchObject({ audio: null, reason: 'empty-query', sound: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('scores 15 Freesound results, excludes voice terms, and returns selected metadata', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [
        { id: 1, name: 'War cry shout', tags: ['battle', 'shout'], duration: 4, avg_rating: 5, num_ratings: 40, previews: { 'preview-hq-mp3': 'https://cdn.test/shout.mp3' } },
        { id: 2, name: 'Distant war drums', tags: ['battle', 'drums', 'ambience'], duration: 4, avg_rating: 4.2, num_ratings: 8, previews: { 'preview-hq-mp3': 'https://cdn.test/drums.mp3' } },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(Buffer.from('drums'), { status: 200 }));
    const result = await createFreesoundClient({ apiKey: 'key', fetchImpl: fetchMock, now: () => 0, sleep: async () => undefined }).searchSfx('war drums distant battle');

    expect(result).toMatchObject({ reason: 'ok', audio: Buffer.from('drums'), sound: { id: 2, name: 'Distant war drums', tags: ['battle', 'drums', 'ambience'], duration: 4, avg_rating: 4.2 } });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe('/apiv2/search/text/');
    expect(url.searchParams.get('query')).toBe('war drums distant battle -speech -voice -vocal -talking -shout -scream -crowd -singing');
    expect(url.searchParams.get('filter')).toBe('license:"Creative Commons 0" duration:[0.3 TO 8.0]');
    expect(url.searchParams.get('page_size')).toBe('15');
    expect(url.searchParams.get('sort')).toBe('rating_desc');
    expect(url.searchParams.get('fields')).toBe('id,name,tags,duration,avg_rating,num_ratings,previews,license');
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://cdn.test/drums.mp3');
  });

  it('tries the next ranked candidate when the best match has no downloadable preview', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [
        { id: 3, name: 'Wind', tags: ['wind'], duration: 4, avg_rating: 4.8, num_ratings: 30, previews: {} },
        { id: 4, name: 'Wind blowing', tags: ['wind'], duration: 5, avg_rating: 4.1, num_ratings: 8, previews: { 'preview-hq-mp3': 'https://cdn.test/wind.mp3' } },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(Buffer.from('wind'), { status: 200 }));
    const result = await createFreesoundClient({ apiKey: 'key', fetchImpl: fetchMock, now: () => 0, sleep: async () => undefined }).searchSfx('wind blowing');
    expect(result).toMatchObject({ reason: 'ok', sound: { id: 4 } });
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://cdn.test/wind.mp3');
  });

  it('retries 429 using Retry-After and keeps API calls at least 1.1 seconds apart', async () => {
    let now = 0;
    const waits: number[] = [];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '5' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const result = await createFreesoundClient({ apiKey: 'key', fetchImpl: fetchMock, now: () => now, sleep: async (ms) => { waits.push(ms); now += ms; } }).searchSfx('wind blowing');

    expect(result.reason).toBe('no-results');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(waits).toContain(5000);
  });

  it('stops retrying persistent 429 after three attempts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }));
    const result = await createFreesoundClient({ apiKey: 'key', fetchImpl: fetchMock, now: () => 0, sleep: async () => undefined, random: () => 0 }).searchSfx('wind');

    expect(result.reason).toBe('rate-limited');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['HTTP 503', () => new Response('retry', { status: 503 })],
    ['network failure', () => Promise.reject(new Error('offline'))],
  ])('retries %s and returns a structured search result', async (_label, transientFailure) => {
    let now = 0;
    const waits: number[] = [];
    const fetchMock = vi.fn()
      .mockImplementationOnce(transientFailure)
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const result = await createFreesoundClient({
      apiKey: 'key', fetchImpl: fetchMock, now: () => now,
      sleep: async (milliseconds) => { waits.push(milliseconds); now += milliseconds; }, random: () => 0,
    }).searchSfx('wind');
    expect(result.reason).toBe('no-results');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(waits.length).toBeGreaterThan(0);
  });

  it('does not retry non-429 client errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }));
    const result = await createFreesoundClient({ apiKey: 'key', fetchImpl: fetchMock, sleep: async () => undefined }).searchSfx('wind');
    expect(result.reason).toBe('http-error');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('shares request spacing across concurrent SFX searches', async () => {
    let now = 0;
    const waits: number[] = [];
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });
    const client = createFreesoundClient({ apiKey: 'key', fetchImpl: fetchMock, now: () => now, sleep: async (ms) => { waits.push(ms); now += ms; } });
    const results = await Promise.all([client.searchSfx('river water'), client.searchSfx('night ambience')]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([1100]);
    expect(results.map((result) => result.reason)).toEqual(['no-results', 'no-results']);
  });

  it('does not exceed its injected daily API request budget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const client = createFreesoundClient({ apiKey: 'key', fetchImpl: fetchMock, now: () => 0, sleep: async () => undefined, dailyRequestLimit: 1 });

    expect((await client.searchSfx('river water')).reason).toBe('no-results');
    expect((await client.searchSfx('night ambience')).reason).toBe('rate-limited');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not request when the API key is missing', async () => {
    const fetchMock = vi.fn();
    const client = createFreesoundClient({ apiKey: '', fetchImpl: fetchMock });

    await expect(client.searchAndDownloadSfx('wind')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloads the first SFX preview, preferring HQ MP3', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: 11, name: 'Wind blowing', tags: ['wind'], duration: 4, avg_rating: 4, num_ratings: 4, previews: { 'preview-hq-mp3': 'https://cdn.test/wind.mp3' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(Buffer.from('mp3'), { status: 200 }));
    const client = createFreesoundClient({ apiKey: 'key', fetchImpl: fetchMock });

    await expect(client.searchAndDownloadSfx('tiếng gió')).resolves.toEqual(Buffer.from('mp3'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('freesound.org/apiv2/search/text');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('query=wind+blowing');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('fields=id%2Cname%2Ctags%2Cduration%2Cavg_rating%2Cnum_ratings%2Cpreviews%2Clicense');
  });

  it('returns null when a search result has no preview URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: 123, name: 'Wind' }] }), { status: 200 }));
    const client = createFreesoundClient({ apiKey: 'key', fetchImpl: fetchMock });

    await expect(client.searchAndDownloadSfx('wind')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
