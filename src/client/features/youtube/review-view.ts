import type { YoutubeReviewGroundingReport, YoutubeReviewSuccessCriterion, YoutubeReviewVideoContext } from '../../../contracts/youtube-review';

export type YoutubeReviewMetric = { value: number; unit: string; label: string; assumed?: boolean };
export type YoutubeReviewCitation = { metricId: string; label: string; value: string; missing: boolean };

const NUMBER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

export function formatYoutubeReviewMetric(metric: YoutubeReviewMetric | undefined): string {
  if (!metric) return 'Chưa có dữ liệu';
  if (metric.unit === 'fraction') return `${NUMBER.format(metric.value * 100)}%`;
  if (metric.unit === 'percent' || metric.unit === 'percentile') return `${NUMBER.format(metric.value)}%`;
  if (metric.unit === 'seconds') return formatYoutubeReviewTime(metric.value);
  return `${NUMBER.format(metric.value)}${metric.unit === 'views' ? ' lượt xem' : metric.unit === 'minutes' ? ' phút' : metric.unit === 'subscribers' ? ' người đăng ký' : ` ${metric.unit}`}`;
}

export function formatYoutubeReviewCitation(metricMap: Record<string, YoutubeReviewMetric>, metricId: string): YoutubeReviewCitation {
  const metric = metricMap[metricId];
  return { metricId, label: metric?.label ?? metricId, value: formatYoutubeReviewMetric(metric), missing: !metric };
}

export function youtubeReviewStaleText(stale: boolean): string | null {
  return stale ? 'Dữ liệu đã thay đổi từ lúc phân tích.' : null;
}

export function youtubeReviewIdeasGateText(matureCount: number, reason?: string): string {
  return reason ?? `Cần ít nhất 10 video đã đủ 28 ngày; hiện có ${matureCount}.`;
}

export function youtubeReviewCriterionText(criterion: YoutubeReviewSuccessCriterion, metricMap: Record<string, YoutubeReviewMetric>): string {
  const metric = metricMap[criterion.metricId];
  const label = metric?.label ?? criterion.metricId;
  const target = formatYoutubeReviewMetric(metric ? { ...metric, value: criterion.value } : { value: criterion.value, unit: '', label });
  const comparator = criterion.comparator === '>=' ? '≥' : '≤';
  return `Sau ${criterion.afterVideos} video: ${label} ${comparator} ${target}`;
}

export function youtubeReviewGroundingBadgeText(report: YoutubeReviewGroundingReport): string {
  return `Đã đối chiếu ${report.checked} nhận định với số liệu; bỏ ${report.dropped.length} nhận định không có căn cứ`;
}

export function formatYoutubeReviewTime(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

export function youtubeReviewSceneRange(fromSec: number, toSec: number): string {
  return `${formatYoutubeReviewTime(fromSec)}–${formatYoutubeReviewTime(toSec)}`;
}

export function youtubeReviewMappingLabel(quality: YoutubeReviewVideoContext['mappingQuality']): string {
  if (quality === 'exact') return 'Khớp thời gian';
  if (quality === 'approximate') return 'Khớp thời gian xấp xỉ: video đăng khác với bản dựng hiện tại';
  return 'Không thể gán về cảnh';
}
