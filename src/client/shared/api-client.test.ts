import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { apiRequest } from './api-client';

describe('apiRequest conflict metadata', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves a job id on an active-job conflict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'YOUTUBE_REVIEW_ALREADY_RUNNING', message: 'Đang chạy.', jobId: 'review-job' } }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(apiRequest('/api/youtube/reviews', z.object({ jobId: z.string() }))).rejects.toMatchObject({
      status: 409,
      code: 'YOUTUBE_REVIEW_ALREADY_RUNNING',
      jobId: 'review-job',
    });
  });
});
