import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEO_SECTIONS } from '../../../contracts/seo';
import { generateSeo, getSeoChannelTitles, getSeoManualPrompt } from './api';

afterEach(() => vi.restoreAllMocks());

describe('SEO channel-title API', () => {
  it('loads chosen titles through the project SEO route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ titles: ['Other chosen title'] }), { status: 200 }));

    await expect(getSeoChannelTitles('project one')).resolves.toEqual(['Other chosen title']);

    expect(fetchMock).toHaveBeenCalledWith('/api/project/project%20one/seo/channel-titles', expect.objectContaining({ method: 'GET' }));
  });
});

describe('SEO section API defaults', () => {
  it('includes Shorts in automatic generation but keeps manual default standalone-compatible', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt: 'manual prompt', promptVersion: 'v1' }), { status: 200 }));

    await generateSeo('project-1');
    await getSeoManualPrompt('project-1');

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ sections: [...SEO_SECTIONS] });
    expect(fetchMock.mock.calls[1]?.[0]).toContain('sections=titles%2Cdescription%2Ctags%2CpinnedComment%2Cthumbnail');
    expect(fetchMock.mock.calls[1]?.[0]).not.toContain('shorts');
  });
});
