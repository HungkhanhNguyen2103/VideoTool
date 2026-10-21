import { describe, expect, it } from 'vitest';
import { estimateDataApiUnits, parseIsoDuration, readUploadVideoIds } from './sync';

describe('YouTube sync helpers', () => {
  it('estimates one quota unit for each list request, without a search.list allowance', () => {
    expect(estimateDataApiUnits(100)).toBe(5);
    expect(estimateDataApiUnits(1_000)).toBe(41);
  });

  it('parses ISO-8601 video durations', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('PT45S')).toBe(45);
  });

  it('walks uploads playlist pages without using search.list', async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      const page = new URL(url).searchParams.get('pageToken');
      return new Response(JSON.stringify(page
        ? { items: [{ contentDetails: { videoId: 'video-2' } }] }
        : { nextPageToken: 'next', items: [{ contentDetails: { videoId: 'video-1' } }] }), { status: 200 });
    };
    const ids = await readUploadVideoIds('uploads-id', 'access-token', fetcher);
    expect(ids).toEqual(['video-1', 'video-2']);
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.includes('/playlistItems?'))).toBe(true);
    expect(urls.some((url) => url.includes('/search?'))).toBe(false);
  });
});
