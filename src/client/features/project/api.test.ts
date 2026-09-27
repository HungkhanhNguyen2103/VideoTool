import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVisualStyleSamples, uploadVisualStyleSample } from './api';
import { resolveVisualStylePreview } from './visual-style-preview';

afterEach(() => vi.restoreAllMocks());

describe('visual style sample API helpers', () => {
  it('uses a resolved sample first, then the bundled cinematic fallback, then the empty state', () => {
    const sample = { url: '/files/flat.png', filename: 'flat.png', source: 'project' as const, updatedAt: new Date().toISOString() };
    expect(resolveVisualStylePreview('flat-cartoon', { 'flat-cartoon': sample })).toMatchObject({ src: '/files/flat.png', filename: 'flat.png' });
    expect(resolveVisualStylePreview('cinematic', {})).toMatchObject({ filename: 'cinematic-style-preview.jpg' });
    expect(resolveVisualStylePreview('flat-cartoon', {})).toBeUndefined();
  });

  it('loads resolved samples and uploads to the encoded style route', async () => {
    const entry = { url: '/files/sample.png', filename: 'sample.png', source: 'shared', updatedAt: new Date().toISOString() };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ 'flat-cartoon': entry }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(entry), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(getVisualStyleSamples()).resolves.toEqual({ 'flat-cartoon': entry });
    await expect(uploadVisualStyleSample('flat-cartoon', new File(['image'], 'sample.png', { type: 'image/png' }))).resolves.toEqual(entry);

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/visual-style-samples', expect.objectContaining({ method: 'GET' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/visual-style-samples/flat-cartoon', expect.objectContaining({ method: 'PUT' }));
    const body = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    expect(body.get('file')).toBeInstanceOf(File);
  });
});
