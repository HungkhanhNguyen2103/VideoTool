import { describe, expect, it } from 'vitest';
import { formatYoutubeReviewCitation, youtubeReviewCriterionText, youtubeReviewGroundingBadgeText, youtubeReviewIdeasGateText, youtubeReviewMappingLabel, youtubeReviewSceneRange, youtubeReviewStaleText } from './review-view';

describe('YouTube review display helpers', () => {
  it('formats citations and leaves missing targets as readable text', () => {
    expect(formatYoutubeReviewCitation({ ctr: { value: 0.125, unit: 'fraction', label: 'CTR' } }, 'ctr')).toMatchObject({ label: 'CTR', value: '12,5%', missing: false });
    expect(formatYoutubeReviewCitation({}, 'v:missing:first28_views')).toMatchObject({ label: 'v:missing:first28_views', value: 'Chưa có dữ liệu', missing: true });
  });

  it('formats stale, gated, criteria, and grounding messages in Vietnamese', () => {
    expect(youtubeReviewStaleText(true)).toBe('Dữ liệu đã thay đổi từ lúc phân tích.');
    expect(youtubeReviewStaleText(false)).toBeNull();
    expect(youtubeReviewIdeasGateText(9)).toBe('Cần ít nhất 10 video đã đủ 28 ngày; hiện có 9.');
    expect(youtubeReviewCriterionText({ metricId: 'median_first28_last10', comparator: '>=', value: 220, afterVideos: 5 }, { median_first28_last10: { value: 120, unit: 'views', label: 'Trung vị first-28' } })).toBe('Sau 5 video: Trung vị first-28 ≥ 220 lượt xem');
    expect(youtubeReviewGroundingBadgeText({ checked: 12, repaired: 2, dropped: [{ path: 'weaknesses[0]', reasons: ['unmatched'] }] })).toBe('Đã đối chiếu 12 nhận định với số liệu; bỏ 1 nhận định không có căn cứ');
  });

  it('formats retention ranges and mapping quality labels', () => {
    expect(youtubeReviewSceneRange(45, 70)).toBe('0:45–1:10');
    expect(youtubeReviewMappingLabel('approximate')).toContain('video đăng khác với bản dựng hiện tại');
    expect(youtubeReviewMappingLabel('none')).toBe('Không thể gán về cảnh');
  });
});
