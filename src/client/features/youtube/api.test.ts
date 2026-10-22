import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginYoutubeConnection,
  beginYoutubeImport,
  disconnectYoutube,
  generateYoutubeChannelReview,
  getActiveYoutubeSync,
  getYoutubeConnection,
  getYoutubeSetupStatus,
  getYoutubeVideos,
  linkProjectToYoutubeVideo,
  startYoutubeSync,
  refreshYoutubeProfile,
  unlinkProjectFromYoutubeVideo,
} from './api';

afterEach(() => vi.restoreAllMocks());

describe('YouTube analytics client API', () => {
  it('starts account import and sends refresh selection to the profile route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ configured: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authorizationUrl: 'https://accounts.google.com/auth' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ updated: ['description'], skipped: ['name', 'handle', 'language'] }), { status: 200 }));
    await expect(getYoutubeSetupStatus()).resolves.toEqual({ configured: true });
    await expect(beginYoutubeImport()).resolves.toMatchObject({ authorizationUrl: expect.stringContaining('accounts.google.com') });
    await expect(refreshYoutubeProfile('channel/one', { overwrite: true, fields: ['description'] })).resolves.toMatchObject({ updated: ['description'] });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/youtube/setup', expect.objectContaining({ method: 'GET' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/youtube/import/start', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/youtube/channels/channel%2Fone/refresh-profile', expect.objectContaining({ method: 'POST', body: JSON.stringify({ overwrite: true, fields: ['description'] }) }));
  });

  it('starts OAuth and reads token-free connection summaries using encoded channel ids', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=x' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ connected: false, youtubeChannelId: null, title: null, connectedAt: null, needsReconnect: false, setupConfigured: true }), { status: 200 }));
    await expect(beginYoutubeConnection('channel/one')).resolves.toMatchObject({ authorizationUrl: expect.stringContaining('accounts.google.com') });
    await expect(getYoutubeConnection('channel/one')).resolves.toMatchObject({ connected: false, setupConfigured: true });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/youtube/connect/channel%2Fone', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/youtube/connection/channel%2Fone', expect.objectContaining({ method: 'GET' }));
  });

  it('queues sync, rejoins an active sync, and sends list filters as query parameters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job-youtube-1' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job-youtube-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }));
    await expect(startYoutubeSync('channel-1')).resolves.toEqual({ jobId: 'job-youtube-1' });
    await expect(getActiveYoutubeSync('channel-1')).resolves.toEqual({ jobId: 'job-youtube-1' });
    await expect(getYoutubeVideos('channel-1', { sort: 'averageViewPercentage', window: '90d', type: 'short', q: 'Việt Nam' })).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/youtube/sync/channel-1', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/youtube/channels/channel-1/sync-job', expect.objectContaining({ method: 'GET' }));
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('sort=averageViewPercentage');
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('window=90d');
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('type=short');
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('q=Vi%E1%BB%87t+Nam');
  });

  it('keeps disconnect local data by default and links or unlinks a project through project routes', async () => {
    const project = { id: 'project-1', title: 'Project', channelId: 'channel-1', youtubeVideoId: 'video-1' };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(project), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...project, youtubeVideoId: null }), { status: 200 }));
    await expect(disconnectYoutube('channel-1')).resolves.toBeUndefined();
    await expect(linkProjectToYoutubeVideo('project 1', 'video-1')).resolves.toMatchObject({ youtubeVideoId: 'video-1' });
    await expect(unlinkProjectFromYoutubeVideo('project 1')).resolves.toMatchObject({ youtubeVideoId: null });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/youtube/disconnect/channel-1', expect.objectContaining({ method: 'POST', body: JSON.stringify({ deleteSyncedData: false }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/project/project%201/youtube-video', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ videoId: 'video-1' }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/project/project%201/youtube-video', expect.objectContaining({ method: 'DELETE' }));
  });

  it('maps review errors to the shared Vietnamese API error shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'YOUTUBE_REVIEW_NO_DATA', message: 'Đồng bộ ít nhất một video trước khi nhận xét bằng AI.' } }), { status: 409 }));
    await expect(generateYoutubeChannelReview('channel-1')).rejects.toMatchObject({ status: 409, code: 'YOUTUBE_REVIEW_NO_DATA', message: 'Đồng bộ ít nhất một video trước khi nhận xét bằng AI.' });
  });

  it('maps refresh-profile errors through the shared API error contract', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'YOUTUBE_NOT_CONNECTED', message: 'Kênh YouTube chưa được kết nối.' } }), { status: 409 }));
    await expect(refreshYoutubeProfile('channel-1')).rejects.toMatchObject({ status: 409, code: 'YOUTUBE_NOT_CONNECTED', message: 'Kênh YouTube chưa được kết nối.' });
  });
});
