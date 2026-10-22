import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { YoutubeChannelsOverview } from '../../../contracts/youtube-overview';
import { youtubeChannelsOverviewKey, youtubeSetupStatusKey } from './hooks';
import { ChannelsOverviewPage } from './ChannelsOverviewPage';

const health = {
  subscribers: 1_000,
  publicLongWatchHours365d: 1_500,
  publicShortViews90d: 2_000,
  publicUploads90d: 3,
  current: {
    entryTier: { subscribers: 500, longWatchHours: 3_000, shortViews: 3_000_000, publicLongWatchHours: 1_500, publicShortViews: 2_000, subscribersProgress: 1, watchHoursProgress: 0.5, shortViewsProgress: 0.0007, eligible: false },
    ads: { subscribers: 1_000, longWatchHours: 4_000, shortViews: 10_000_000, publicLongWatchHours: 1_500, publicShortViews: 2_000, subscribersProgress: 1, watchHoursProgress: 0.375, shortViewsProgress: 0.0002, eligible: false },
  },
  from2027_02_01: {
    entryTier: { subscribers: 500, longWatchHours: 3_000, shortViews: 3_000_000, publicLongWatchHours: 1_500, publicShortViews: 2_000, subscribersProgress: 1, watchHoursProgress: 0.5, shortViewsProgress: 0.0007, eligible: false },
    ads: { subscribers: 1_000, longWatchHours: 8_000, shortViews: 20_000_000, publicLongWatchHours: 1_500, publicShortViews: 2_000, subscribersProgress: 1, watchHoursProgress: 0.1875, shortViewsProgress: 0.0001, eligible: false },
  },
  note: 'mốc tham khảo, kiểm tra lại trên YouTube Studio',
} as const;

function renderPage(data: YoutubeChannelsOverview, setup: { configured: boolean; message?: string } = { configured: true }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(youtubeChannelsOverviewKey, data);
  client.setQueryData(youtubeSetupStatusKey, setup);
  return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><ChannelsOverviewPage /></MemoryRouter></QueryClientProvider>);
}

describe('ChannelsOverviewPage', () => {
  it('renders channel totals, sorted cards, health progress, and the per-channel drilldown', () => {
    const data: YoutubeChannelsOverview = {
      channels: [{
        channelId: 'channel-1', name: 'Kênh thử nghiệm', handle: '@kenhthu', language: 'vi',
        connection: { connected: true, youtubeChannelId: 'UC-1', title: 'Kênh thử nghiệm', connectedAt: '2026-10-01T00:00:00.000Z', needsReconnect: false, setupConfigured: true },
        subscriberCount: 1_000, videoCount: 2, longCount: 1, shortCount: 1,
        stage: 'B', verdict: 'continue',
        last28: { views: 150, estimatedMinutesWatched: 1_500, subscribersGained: 12, subscribersLost: 2 },
        previous28: { views: 100, estimatedMinutesWatched: 1_000, subscribersGained: 10, subscribersLost: 1 },
        trend: { views: { current: 150, previous: 100, changePercent: 50 }, watchMinutes: { current: 1_500, previous: 1_000, changePercent: 50 }, subscribers: { current: 10, previous: 9, changePercent: 11.1 }, tooFewData: false },
        health,
        activeSyncJobId: null,
        topVideo: { videoId: 'video-1', title: 'Video đứng đầu', viewsPerDay: 10 },
      }],
      totals: { subscriberCount: 1_000, views28: 150, watchHours28: 25, subscribersGained28: 12, channelsConnected: 1, channelsNeedReconnect: 0 },
    };
    const markup = renderPage(data);
    expect(markup).toContain('Phân tích kênh');
    expect(markup).toContain('Chỉ tính kênh đã kết nối · 1 kênh');
    expect(markup).toContain('Kênh thử nghiệm');
    expect(markup).toContain('Mốc tham khảo');
    expect(markup).toContain('Video đứng đầu');
    expect(markup).toContain('B · Tìm mẫu lặp lại');
    expect(markup).toContain('Tiếp tục');
    expect(markup).toContain('href="/channels/channel-1/analytics"');
    expect(markup).toContain('↑ 50,0% so với 28 ngày trước');
  });

  it('renders the empty-channel action and Google setup guidance', () => {
    const empty: YoutubeChannelsOverview = {
      channels: [],
      totals: { subscriberCount: null, views28: null, watchHours28: null, subscribersGained28: null, channelsConnected: 0, channelsNeedReconnect: 0 },
    };
    const markup = renderPage(empty, { configured: false, message: 'Điền cấu hình Google OAuth trong .env.' });
    expect(markup).toContain('Chưa có hồ sơ kênh');
    expect(markup).toContain('Điền cấu hình Google OAuth trong .env.');
    expect(markup).toContain('Quản lý kênh');
  });
});
