import { describe, expect, it } from 'vitest';
import { YoutubeConnectionSummarySchema } from '../../../contracts/youtube';
import {
  formatYoutubeMetric,
  isTrustedYoutubeOauthMessage,
  isYoutubeSyncActive,
  lineChartPath,
  youtubeImportResultSummary,
  youtubeThresholdSourceLinks,
  YOUTUBE_CTR_UNAVAILABLE_TOOLTIP,
  youtubeConnectionLabel,
  youtubeConnectionState,
  youtubeSyncMessage,
} from './youtube-view';

const summary = (patch: Record<string, unknown> = {}) => YoutubeConnectionSummarySchema.parse({
  connected: false, youtubeChannelId: null, title: null, connectedAt: null, needsReconnect: false, setupConfigured: true, ...patch,
});

describe('YouTube analytics view helpers', () => {
  it('accepts OAuth completion from the local API popup across the Vite origin and rejects unrelated senders', () => {
    const popup = {} as Window;
    expect(isTrustedYoutubeOauthMessage({ origin: 'http://localhost:3000', source: popup } as MessageEvent, popup)).toBe(true);
    expect(isTrustedYoutubeOauthMessage({ origin: 'http://127.0.0.1:3000', source: popup } as MessageEvent, popup)).toBe(true);
    expect(isTrustedYoutubeOauthMessage({ origin: 'http://localhost:5173', source: popup } as MessageEvent, popup)).toBe(false);
    expect(isTrustedYoutubeOauthMessage({ origin: 'http://localhost:3000', source: {} } as MessageEvent, popup)).toBe(false);
  });

  it('summarizes imported, already-bound, and failed channels in Vietnamese', () => {
    expect(youtubeImportResultSummary({ imported: 2, alreadyBound: 1 })).toBe('Đã thêm 2 kênh, bỏ qua 1 kênh đã được gắn.');
    expect(youtubeImportResultSummary({ imported: 1, alreadyBound: 1, failed: 1 })).toBe('Đã thêm 1 kênh; 1 kênh đã được gắn và 1 kênh chưa thể thêm.');
  });

  it('preserves official YPP source URLs and gives them readable link labels', () => {
    expect(youtubeThresholdSourceLinks([
      'https://support.google.com/youtube/answer/72851',
      'https://support.google.com/youtube/answer/12843009',
    ])).toEqual([
      { href: 'https://support.google.com/youtube/answer/72851', label: 'Điều kiện tham gia YPP' },
      { href: 'https://support.google.com/youtube/answer/12843009', label: 'Chính sách kiếm tiền của YouTube' },
    ]);
  });

  it('labels setup, disconnected, connected, and expired-token states', () => {
    expect(youtubeConnectionState(null)).toBe('not-configured');
    expect(youtubeConnectionLabel(youtubeConnectionState(summary()))).toBe('Chưa kết nối');
    expect(youtubeConnectionLabel(youtubeConnectionState(summary({ connected: true, youtubeChannelId: 'yt-1', title: 'Hung' })))).toBe('Đã kết nối');
    expect(youtubeConnectionLabel(youtubeConnectionState(summary({ needsReconnect: true })))).toBe('Cần kết nối lại');
    expect(youtubeConnectionLabel(youtubeConnectionState(summary({ setupConfigured: false })))).toBe('Chưa cấu hình Google');
  });

  it('keeps missing metrics explicit and provides the approved CTR tooltip text', () => {
    expect(formatYoutubeMetric(null)).toEqual({ text: 'Chưa có dữ liệu', title: expect.any(String) });
    expect(YOUTUBE_CTR_UNAVAILABLE_TOOLTIP).toContain('YouTube Studio');
    expect(YOUTUBE_CTR_UNAVAILABLE_TOOLTIP).toContain('YouTube Reporting API');
    expect(formatYoutubeMetric(12.34, { style: 'percent' }).text).toMatch(/12,3%/);
  });

  it('reports sync terminal states and creates a bounded SVG path only with data', () => {
    expect(isYoutubeSyncActive('job-1', null)).toBe(true);
    expect(isYoutubeSyncActive('job-1', { status: 'done' })).toBe(false);
    expect(youtubeSyncMessage({ status: 'failed', error: 'Quota exceeded' })).toBe('Quota exceeded');
    expect(lineChartPath([], 280, 80)).toBe('');
    expect(lineChartPath([1, 4, 2], 100, 20)).toBe('M0.0,15.0 L50.0,0.0 L100.0,10.0');
  });
});
