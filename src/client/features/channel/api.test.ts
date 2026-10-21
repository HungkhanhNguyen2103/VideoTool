import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannel, deleteChannel, listChannels, updateChannel } from './api';

afterEach(() => vi.restoreAllMocks());

const channel = {
  id: 'channel-1', name: 'History', language: 'vi', links: [], defaultHashtags: [], descriptionFooter: '', publishSchedule: null,
  createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
};

describe('channel API', () => {
  it('lists and creates channels using the profile routes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([channel]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(channel), { status: 201 }));
    await expect(listChannels()).resolves.toMatchObject([{ id: 'channel-1' }]);
    await expect(createChannel({ name: 'History' })).resolves.toMatchObject({ id: 'channel-1' });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/channels', expect.objectContaining({ method: 'GET' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/channels', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'History', tagline: '', description: '', language: 'vi', links: [], defaultHashtags: [], descriptionFooter: '', publishSchedule: null }),
    }));
  });

  it('patches and deletes the encoded channel id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(channel), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await updateChannel('channel/1', { tagline: 'Stories' });
    await expect(deleteChannel('channel/1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/channels/channel%2F1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ tagline: 'Stories' }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/channels/channel%2F1', expect.objectContaining({ method: 'DELETE' }));
  });
});
