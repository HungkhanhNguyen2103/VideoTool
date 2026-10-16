import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteVisualStylePackImage, getVisualStylePacks, getVisualStyleSamples, uploadVisualStylePackImage, uploadVisualStyleSample } from './api';
import { resolveVisualStylePreview } from './visual-style-preview';

afterEach(() => vi.restoreAllMocks());

describe('visual style sample API helpers', () => {
  it('uses a resolved sample first, then the bundled cinematic fallback, then the empty state', () => {
    const sample = { url: '/files/flat.png', filename: 'flat.png', source: 'project' as const, updatedAt: new Date().toISOString() };
    expect(resolveVisualStylePreview('flat-cartoon', sample)).toMatchObject({ src: '/files/flat.png', filename: 'flat.png' });
    expect(resolveVisualStylePreview('cinematic', undefined)).toMatchObject({ filename: 'cinematic-style-preview.jpg' });
    expect(resolveVisualStylePreview('flat-cartoon', undefined)).toBeUndefined();
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

describe('visual style pack API helpers', () => {
  it('loads, uploads and deletes a selected slot', async () => {
    const entry = { url: '/files/core.png', filename: 'core.png', source: 'shared', updatedAt: new Date().toISOString() };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ anime: { core: entry } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(entry), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    expect(await getVisualStylePacks()).toEqual({ anime: { core: entry } });
    expect(await uploadVisualStylePackImage('anime', 'core', new File(['image'], 'core.png', { type: 'image/png' }))).toEqual(entry);
    await expect(deleteVisualStylePackImage('anime', 'core')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/visual-style-packs', expect.objectContaining({ method: 'GET' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/visual-style-packs/anime/core', expect.objectContaining({ method: 'PUT' }));
    expect((fetchMock.mock.calls[1]?.[1]?.body as FormData).get('file')).toBeInstanceOf(File);
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/visual-style-packs/anime/core', expect.objectContaining({ method: 'DELETE' }));
  });

  it('maps upload and delete errors to ApiError', async () => {
    const body = JSON.stringify({ error: { code: 'INVALID_FILE_TYPE', message: 'Sai định dạng.' } });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body, { status: 400 }));
    await expect(uploadVisualStylePackImage('anime', 'core', new File(['bad'], 'bad.pdf'))).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE', message: 'Sai định dạng.' });
    await expect(deleteVisualStylePackImage('anime', 'core')).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE', message: 'Sai định dạng.' });
  });
});
