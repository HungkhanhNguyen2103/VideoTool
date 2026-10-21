import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSeoChannelTitles } from './api';

afterEach(() => vi.restoreAllMocks());

describe('SEO channel-title API', () => {
  it('loads chosen titles through the project SEO route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ titles: ['Other chosen title'] }), { status: 200 }));

    await expect(getSeoChannelTitles('project one')).resolves.toEqual(['Other chosen title']);

    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%20one/seo/channel-titles', expect.objectContaining({ method: 'GET' }));
  });
});
