import { describe, expect, it } from 'vitest';
import type { YoutubeChannelOverviewRow } from '../../../contracts/youtube-overview';
import {
  CHANNEL_OVERVIEW_TOTALS_CAPTION,
  channelOverviewConnectionLabel,
  channelOverviewConnectionState,
  formatOverviewHours,
  formatOverviewNumber,
  sortChannelOverview,
  youtubeChannelChangeText,
  youtubeSyncAllResultSummary,
} from './channels-overview-view';

function row(channelId: string, name: string, views: number, subscribers: number, lastSyncAt: string | undefined = undefined): YoutubeChannelOverviewRow {
  return {
    channelId,
    name,
    language: 'vi',
    connection: {
      connected: true,
      youtubeChannelId: channelId,
      title: name,
      connectedAt: '2026-10-01T00:00:00.000Z',
      ...(lastSyncAt ? { lastSyncAt } : {}),
      needsReconnect: false,
      setupConfigured: true,
    },
    subscriberCount: subscribers,
    videoCount: 4,
    longCount: 3,
    shortCount: 1,
    last28: { views, estimatedMinutesWatched: 1_500, subscribersGained: 12, subscribersLost: 2 },
    previous28: { views: 100, estimatedMinutesWatched: 1_000, subscribersGained: 10, subscribersLost: 1 },
    trend: {
      views: { current: views, previous: 100, changePercent: views > 100 ? 50 : 0 },
      watchMinutes: { current: 1_500, previous: 1_000, changePercent: 50 },
      subscribers: { current: 10, previous: 9, changePercent: 11.1 },
      tooFewData: false,
    },
    health: {} as YoutubeChannelOverviewRow['health'],
    activeSyncJobId: null,
    topVideo: null,
  };
}

describe('channels overview view helpers', () => {
  it('sorts by 28-day views by default and supports subscribers, name, and last sync', () => {
    const rows = [row('a', 'Zulu', 100, 500), row('b', 'Alpha', 300, 100, '2026-10-20T00:00:00.000Z'), row('c', 'Beta', 200, 900, '2026-10-21T00:00:00.000Z')];
    expect(sortChannelOverview(rows).map((item) => item.channelId)).toEqual(['b', 'c', 'a']);
    expect(sortChannelOverview(rows, 'subscribers').map((item) => item.channelId)).toEqual(['c', 'a', 'b']);
    expect(sortChannelOverview(rows, 'name').map((item) => item.channelId)).toEqual(['b', 'c', 'a']);
    expect(sortChannelOverview(rows, 'lastSync').map((item) => item.channelId)).toEqual(['c', 'b', 'a']);
  });

  it('uses a neutral sample message and avoids invented percentages', () => {
    const enough = row('a', 'Kênh', 150, 20);
    const tooFew = { ...enough, trend: { ...enough.trend, tooFewData: true } };
    const unavailable = { ...enough, last28: { ...enough.last28, views: null }, previous28: { ...enough.previous28, views: null } };
    const zeroPrevious = {
      ...enough,
      previous28: { ...enough.previous28, views: 0 },
      trend: { ...enough.trend, views: { ...enough.trend.views, changePercent: null } },
    };
    expect(youtubeChannelChangeText(enough, 'views')).toBe('↑ 50,0%');
    expect(youtubeChannelChangeText(tooFew, 'views')).toBe('Quá ít dữ liệu');
    expect(youtubeChannelChangeText(unavailable, 'views')).toBe('Chưa có dữ liệu');
    expect(youtubeChannelChangeText(zeroPrevious, 'views')).toBe('Chưa có dữ liệu so sánh');
  });

  it('labels connection states and formats Vietnamese totals without changing values', () => {
    const connected = row('a', 'Kênh', 150, 20);
    expect(channelOverviewConnectionLabel(channelOverviewConnectionState(connected.connection))).toBe('Đã kết nối');
    expect(channelOverviewConnectionLabel(channelOverviewConnectionState({ ...connected.connection, needsReconnect: true, connected: false }))).toBe('Cần kết nối lại');
    expect(channelOverviewConnectionLabel(channelOverviewConnectionState({ ...connected.connection, connected: false, youtubeChannelId: null }))).toBe('Chưa kết nối');
    expect(channelOverviewConnectionLabel(channelOverviewConnectionState({ ...connected.connection, setupConfigured: false }))).toBe('Chưa cấu hình Google');
    expect(CHANNEL_OVERVIEW_TOTALS_CAPTION).toBe('Chỉ tính kênh đã kết nối');
    expect(formatOverviewNumber(1_234_567)).toBe('1.234.567');
    expect(formatOverviewHours(1_234.56)).toBe('1.234,6 giờ');
  });

  it('summarizes queued channels and explicit skip reasons in Vietnamese', () => {
    expect(youtubeSyncAllResultSummary([
      { channelId: 'a', jobId: 'job-a' },
      { channelId: 'b', jobId: 'job-b' },
      { channelId: 'c', jobId: null, skipped: 'needs-reconnect' },
    ])).toBe('Đã xếp hàng 2 kênh, bỏ qua 1: cần kết nối lại.');
    expect(youtubeSyncAllResultSummary([])).toBe('Không có kênh nào cần đồng bộ.');
  });
});
