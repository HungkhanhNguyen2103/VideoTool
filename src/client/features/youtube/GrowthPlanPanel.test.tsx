import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YoutubeGrowthPlanSchema, YoutubeGrowthPlanStatusSchema } from '../../../contracts/youtube-plan';
import { GrowthPlanPanel } from './components/GrowthPlanPanel';

vi.mock('./hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks')>();
  return { ...actual, useYoutubeGrowthPlan: vi.fn(), useYoutubeGrowthPlanStatus: vi.fn(), useYoutubeVideos: vi.fn() };
});

import { useYoutubeGrowthPlan, useYoutubeGrowthPlanStatus, useYoutubeVideos } from './hooks';

const plan = YoutubeGrowthPlanSchema.parse({ channelProfileId: 'channel-1' });
const status = YoutubeGrowthPlanStatusSchema.parse({
  plan,
  eligibleVideoCount: 0,
  matureCount: 2,
  videos: [],
  pending: [],
  distribution: { measuredCount: 0, approximateCount: 0, unknownMatureCount: 0, median: null, mean: null, max: null, p25: null, p75: null, last10Median: null, weightedAvgViewDurationMin: null, avgViewDurationAssumed: true, subscribersPerThousandViews: null, earlyRetentionDropFraction: null, retentionMeasuredCount: 0 },
  hitRates: { first: { hits: 0, count: 2, rate: 0, low: 0, high: 1, videosUntilHit: null, ruleOfThreeUpperBound: 1, approximate: false, message: 'Chưa có video nào đạt mốc; ước lượng chưa có ý nghĩa' }, strong: { hits: 0, count: 2, rate: 0, low: 0, high: 1, videosUntilHit: null, ruleOfThreeUpperBound: 1, approximate: false, message: 'Chưa có video nào đạt mốc; ước lượng chưa có ý nghĩa' } },
  requiredViews: { watchHoursTarget: 4_000, plannedVideosPerYear: 182, avgViewDurationMin: 4, avgViewDurationAssumed: true, hoursViewsPerVideo: 329.67, subscribersViewsPerVideo: null, binding: 'unknown', bindingViewsPerVideo: null, gapToMedian: { absolute: null, ratio: null }, gapToP75: { absolute: null, ratio: null } },
  forecast: { status: 'insufficient-data', reason: 'Cần ít nhất 10 video trưởng thành để dự báo.' },
  stage: { current: 'A', next: 'B', label: 'A · Thu thập tín hiệu', unmetConditions: ['Cần 10 video trưởng thành; hiện có 2.'] },
  checkpoints: [
    { id: 'a_review', label: 'Rà soát đầu tiên', status: 'upcoming', estimatedDate: null, matureVideoTarget: 10, evaluate: 'Đánh giá mẫu.' },
    { id: 'warning', label: 'Điểm cảnh báo', status: 'upcoming', estimatedDate: null, matureVideoTarget: 15, evaluate: 'Đánh giá.' },
    { id: 'decision', label: 'Điểm quyết định', status: 'upcoming', estimatedDate: null, matureVideoTarget: 40, evaluate: 'Đánh giá.' },
    { id: 'hard_review', label: 'Rà soát bắt buộc', status: 'upcoming', estimatedDate: null, matureVideoTarget: null, evaluate: 'Đánh giá.' },
  ],
  verdict: { verdict: 'insufficient_data', reasons: [{ text: 'Đặt ngày bắt đầu ngách để xác định nhóm video.', metricIds: [] }], unknowns: ['CTR chưa biết.'], confidence: 'low', nextCheckpoint: null },
  metrics: { subscribers_current: { value: null, unit: 'subscribers', label: 'Người đăng ký hiện tại' }, public_long_watch_hours_365d: { value: null, unit: 'hours', label: 'Giờ xem video dài' } },
  assumptions: ['Dự báo từ ít video có sai số rất lớn.'],
  thresholds: { checkedOn: '2026-10-22', referenceLabel: 'mốc tham khảo', sourceUrls: ['https://support.google.com/youtube/answer/72851'], current: { entryTier: { subscribers: 500, longWatchHours: 3_000, shortViews: 3_000_000 }, ads: { subscribers: 1_000, longWatchHours: 4_000, shortViews: 10_000_000 } }, from2027_02_01: { entryTier: { subscribers: 500, longWatchHours: 3_000, shortViews: 3_000_000 }, ads: { subscribers: 1_000, longWatchHours: 8_000, shortViews: 20_000_000 } }, longWatchWindowDays: 365, shortsViewWindowDays: 90, qualifyingWatchHours: 'Chỉ video dài công khai.' },
  submittedForReviewAt: null,
});

function render() {
  const client = new QueryClient();
  return renderToStaticMarkup(<QueryClientProvider client={client}><GrowthPlanPanel channelId="channel-1" /></QueryClientProvider>);
}

afterEach(() => vi.clearAllMocks());

describe('GrowthPlanPanel states', () => {
  it('shows a loading state while plan and computed status are loading', () => {
    vi.mocked(useYoutubeGrowthPlan).mockReturnValue({ data: undefined, isLoading: true, error: null } as never);
    vi.mocked(useYoutubeGrowthPlanStatus).mockReturnValue({ data: undefined, isLoading: true, error: null } as never);
    expect(render()).toContain('Đang tải kế hoạch tăng trưởng');
  });

  it('shows a retryable error state', () => {
    vi.mocked(useYoutubeGrowthPlan).mockReturnValue({ data: undefined, isLoading: false, error: new Error('Không tải được kế hoạch.') } as never);
    vi.mocked(useYoutubeGrowthPlanStatus).mockReturnValue({ data: undefined, isLoading: false, error: new Error('Không tải được kế hoạch.') } as never);
    expect(render()).toContain('Không tải được kế hoạch.');
    expect(render()).toContain('Thử lại');
  });

  it('handles the expected two-video insufficient-data and empty-plan state', () => {
    vi.mocked(useYoutubeGrowthPlan).mockReturnValue({ data: plan, isLoading: false, error: null } as never);
    vi.mocked(useYoutubeGrowthPlanStatus).mockReturnValue({ data: status, isLoading: false, error: null } as never);
    vi.mocked(useYoutubeVideos).mockReturnValue({ data: [], isLoading: false, error: null } as never);
    const markup = render();
    expect(markup).toContain('Chưa đủ dữ liệu');
    expect(markup).toContain('Đặt ngày bắt đầu ngách');
    expect(markup).toContain('Chưa có video thuộc kế hoạch này');
    expect(markup).toContain('Kế hoạch &amp; mục tiêu');
  });
});
