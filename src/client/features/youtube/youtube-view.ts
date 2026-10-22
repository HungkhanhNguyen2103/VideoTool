import type { YoutubeConnectionSummary } from '../../../contracts/youtube';
import type { JobProgressState } from '../../shared/hooks/use-job-progress';

export const YOUTUBE_CTR_UNAVAILABLE_TOOLTIP = 'CTR có trong YouTube Studio và YouTube Reporting API; YouTube Reporting API chưa được triển khai ở giai đoạn này.';
export const YOUTUBE_METRIC_UNAVAILABLE_TOOLTIP = 'YouTube Analytics chưa trả chỉ số này cho kênh, video hoặc khoảng thời gian đã chọn.';

const YOUTUBE_OAUTH_CALLBACK_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
const YOUTUBE_THRESHOLD_SOURCE_LABELS = new Map([
  ['https://support.google.com/youtube/answer/72851', 'Điều kiện tham gia YPP'],
  ['https://support.google.com/youtube/answer/12843009', 'Chính sách kiếm tiền của YouTube'],
]);

export function isTrustedYoutubeOauthMessage(event: Pick<MessageEvent, 'origin' | 'source'>, popup: Window | null): boolean {
  return popup !== null && event.source === popup && YOUTUBE_OAUTH_CALLBACK_ORIGINS.has(event.origin);
}

export function youtubeImportResultSummary(input: { imported: number; alreadyBound?: number; failed?: number }): string {
  const alreadyBound = input.alreadyBound ?? 0;
  const failed = input.failed ?? 0;
  if (failed > 0) return `Đã thêm ${input.imported} kênh; ${alreadyBound} kênh đã được gắn và ${failed} kênh chưa thể thêm.`;
  if (alreadyBound > 0) return `Đã thêm ${input.imported} kênh, bỏ qua ${alreadyBound} kênh đã được gắn.`;
  return `Đã thêm ${input.imported} kênh từ YouTube.`;
}

export function youtubeThresholdSourceLinks(sourceUrls: readonly string[]): { href: string; label: string }[] {
  return sourceUrls.map((href, index) => ({ href, label: YOUTUBE_THRESHOLD_SOURCE_LABELS.get(href) ?? `Nguồn YouTube ${index + 1}` }));
}

export type YoutubeConnectionState = 'not-configured' | 'reconnect' | 'connected' | 'disconnected';

export function youtubeConnectionState(connection: YoutubeConnectionSummary | null | undefined): YoutubeConnectionState {
  if (!connection?.setupConfigured) return 'not-configured';
  if (connection.needsReconnect) return 'reconnect';
  return connection.connected ? 'connected' : 'disconnected';
}

export function youtubeConnectionLabel(state: YoutubeConnectionState): string {
  switch (state) {
    case 'not-configured': return 'Chưa cấu hình Google';
    case 'reconnect': return 'Cần kết nối lại';
    case 'connected': return 'Đã kết nối';
    case 'disconnected': return 'Chưa kết nối';
  }
}

export function formatYoutubeMetric(value: number | null | undefined, options: { style?: 'number' | 'percent' | 'hours' | 'date'; maximumFractionDigits?: number } = {}): { text: string; title?: string } {
  if (value === null || value === undefined || !Number.isFinite(value)) return { text: 'Chưa có dữ liệu', title: YOUTUBE_METRIC_UNAVAILABLE_TOOLTIP };
  const style = options.style ?? 'number';
  if (style === 'date') return { text: new Date(value).toLocaleDateString('vi-VN') };
  const formatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: options.maximumFractionDigits ?? 1 });
  if (style === 'percent') return { text: `${formatter.format(value)}%` };
  if (style === 'hours') return { text: `${formatter.format(value)} giờ` };
  return { text: formatter.format(value) };
}

export function isYoutubeSyncActive(jobId: string | null, progress: Pick<JobProgressState, 'status'> | null): boolean {
  return Boolean(jobId) && (!progress || progress.status === 'queued' || progress.status === 'running');
}

export function youtubeSyncMessage(progress: Pick<JobProgressState, 'status' | 'error'> | null): string | null {
  if (!progress) return null;
  if (progress.status === 'done') return 'Đồng bộ YouTube hoàn tất.';
  if (progress.status === 'failed') return progress.error || 'Đồng bộ YouTube không thành công.';
  if (progress.status === 'cancelled') return 'Đồng bộ YouTube đã bị hủy.';
  return null;
}

export function lineChartPath(values: readonly (number | null)[], width: number, height: number): string {
  const available = values.flatMap((value) => value === null || !Number.isFinite(value) ? [] : [value]);
  if (available.length < 2 || width <= 0 || height <= 0) return '';
  const min = Math.min(0, ...available);
  const max = Math.max(...available);
  const range = Math.max(1, max - min);
  return values.flatMap((value, index) => {
    if (value === null || !Number.isFinite(value)) return [];
    const x = index * width / Math.max(1, values.length - 1);
    const y = height - ((value - min) / range) * height;
    return [`${index === 0 || values.slice(0, index).every((item) => item === null) ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`];
  }).join(' ');
}
