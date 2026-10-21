import { describe, expect, it } from 'vitest';
import { YoutubeConnectionSummarySchema } from './youtube';

describe('YouTube client connection contract', () => {
  it('does not accept token-shaped fields', () => {
    expect(() => YoutubeConnectionSummarySchema.parse({
      connected: true,
      youtubeChannelId: 'UC123',
      title: 'Channel',
      connectedAt: '2026-10-21T00:00:00.000Z',
      refreshToken: 'must-not-escape',
    })).toThrow();
  });
});
