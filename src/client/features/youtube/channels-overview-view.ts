import type { YoutubeConnectionSummary } from '../../../contracts/youtube';
import type { YoutubeChannelOverviewRow, YoutubeSyncAllResult } from '../../../contracts/youtube-overview';

export type YoutubeChannelsOverviewSort = 'views28' | 'subscribers' | 'name' | 'lastSync';
export type YoutubeOverviewMetric = 'views' | 'watchHours' | 'subscribersGained';
export type YoutubeOverviewConnectionState = 'not-configured' | 'reconnect' | 'connected' | 'disconnected';

export const CHANNEL_OVERVIEW_TOTALS_CAPTION = 'Chỉ tính kênh đã kết nối';

const NUMBER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function sortChannelOverview(rows: readonly YoutubeChannelOverviewRow[], sort: YoutubeChannelsOverviewSort = 'views28'): YoutubeChannelOverviewRow[] {
  return [...rows].sort((left, right) => {
    if (sort === 'name') return left.name.localeCompare(right.name, 'vi');
    if (sort === 'subscribers') return (right.subscriberCount ?? -1) - (left.subscriberCount ?? -1) || left.name.localeCompare(right.name, 'vi');
    if (sort === 'lastSync') {
      const leftTime = left.connection.lastSyncAt ? Date.parse(left.connection.lastSyncAt) : Number.NEGATIVE_INFINITY;
      const rightTime = right.connection.lastSyncAt ? Date.parse(right.connection.lastSyncAt) : Number.NEGATIVE_INFINITY;
      return rightTime - leftTime || left.name.localeCompare(right.name, 'vi');
    }
    return (right.last28.views ?? -1) - (left.last28.views ?? -1) || left.name.localeCompare(right.name, 'vi');
  });
}

export function youtubeChannelChangeText(row: YoutubeChannelOverviewRow, metric: YoutubeOverviewMetric): string {
  const current = metric === 'views' ? row.last28.views : metric === 'watchHours' ? row.last28.estimatedMinutesWatched : row.last28.subscribersGained;
  const previous = metric === 'views' ? row.previous28.views : metric === 'watchHours' ? row.previous28.estimatedMinutesWatched : row.previous28.subscribersGained;
  if (current === null || previous === null) return 'Chưa có dữ liệu';
  if (row.trend.tooFewData) return 'Quá ít dữ liệu';
  const change = metric === 'views'
    ? row.trend.views.changePercent
    : metric === 'watchHours'
      ? row.trend.watchMinutes.changePercent
      : previous === 0 ? null : (current - previous) / previous * 100;
  if (change === null) return 'Chưa có dữ liệu so sánh';
  const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '→';
  return `${arrow} ${DECIMAL.format(Math.abs(change))}%`;
}

export function channelOverviewConnectionState(connection: YoutubeConnectionSummary): YoutubeOverviewConnectionState {
  if (!connection.setupConfigured) return 'not-configured';
  if (connection.needsReconnect) return 'reconnect';
  return connection.connected ? 'connected' : 'disconnected';
}

export function channelOverviewConnectionLabel(state: YoutubeOverviewConnectionState): string {
  switch (state) {
    case 'not-configured': return 'Chưa cấu hình Google';
    case 'reconnect': return 'Cần kết nối lại';
    case 'connected': return 'Đã kết nối';
    case 'disconnected': return 'Chưa kết nối';
  }
}

export function formatOverviewNumber(value: number | null): string {
  return value === null ? 'Chưa có dữ liệu' : NUMBER.format(value);
}

export function formatOverviewHours(value: number | null): string {
  return value === null ? 'Chưa có dữ liệu' : `${DECIMAL.format(value)} giờ`;
}

export function youtubeSyncAllResultSummary(result: YoutubeSyncAllResult['results']): string {
  const queued = result.filter((row) => row.jobId !== null && row.skipped === undefined).length;
  const skippedRows = result.filter((row) => row.skipped !== undefined || row.jobId === null);
  if (queued === 0 && skippedRows.length === 0) return 'Không có kênh nào cần đồng bộ.';

  const labels: Record<NonNullable<YoutubeSyncAllResult['results'][number]['skipped']>, string> = {
    'not-connected': 'chưa kết nối',
    'needs-reconnect': 'cần kết nối lại',
    'already-running': 'đã có lượt chạy',
    quota: 'vượt ngưỡng quota',
  };
  const reasonCounts = new Map<string, number>();
  for (const row of skippedRows) {
    const label = row.skipped ? labels[row.skipped] : 'chưa thể xếp hàng';
    reasonCounts.set(label, (reasonCounts.get(label) ?? 0) + 1);
  }
  const reason = [...reasonCounts].map(([label, count]) => reasonCounts.size === 1 ? label : `${count} ${label}`).join(', ');
  if (queued === 0) return `Không xếp hàng thêm; ${skippedRows.length} kênh: ${reason}.`;
  return `Đã xếp hàng ${queued} kênh${skippedRows.length ? `, bỏ qua ${skippedRows.length}: ${reason}` : ''}.`;
}
