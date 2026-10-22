import { describe, expect, it } from 'vitest';
import { YoutubeGrowthPlanSchema } from '../../../contracts/youtube-plan';
import { YoutubeVideoStatsSchema, type YoutubeChannelDaily, type YoutubeVideoStats } from '../../../contracts/youtube';
import { buildYoutubeGrowthPlan, computeHitRate, computeRequiredViews, computeWilsonInterval } from './growth-plan';

const now = new Date('2026-10-22T00:00:00.000Z');
const daily: YoutubeChannelDaily[] = [{ date: '2026-10-21', views: 100, estimatedMinutesWatched: 200, subscribersGained: 1, subscribersLost: 0 }];

function dayAgo(days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

function video(index: number, views: number, values: Partial<YoutubeVideoStats> = {}): YoutubeVideoStats & { removed?: boolean; retentionCurve?: { ratio: number; watchRatio: number }[] | null } {
  return YoutubeVideoStatsSchema.parse({
    videoId: `video-${index}`,
    title: `Video ${index}`,
    publishedAt: dayAgo(100 + (100 - index)),
    durationSec: 600,
    isShort: false,
    privacy: 'public',
    viewCount: views,
    likeCount: null,
    commentCount: null,
    fetchedAt: now.toISOString(),
    analytics: { lifetime: { views: views * 2 }, '365d': { estimatedMinutesWatched: views * 4 } },
    first28d: { capturedAt: now.toISOString(), views, estimatedMinutesWatched: views * 4, averageViewDurationSec: 240, averageViewPercentage: 40, subscribersGained: Math.floor(views / 500), subscribersLost: 0 },
    ...values,
  }) as YoutubeVideoStats & { removed?: boolean; retentionCurve?: { ratio: number; watchRatio: number }[] | null };
}

function plan(nicheStartDate: string | null = '2026-01-01', values: Record<string, unknown> = {}) {
  return YoutubeGrowthPlanSchema.parse({ channelProfileId: 'channel-1', nicheStartDate, ...values });
}

function input(videos: (YoutubeVideoStats & { removed?: boolean; retentionCurve?: { ratio: number; watchRatio: number }[] | null })[], overrides: Record<string, unknown> = {}) {
  return {
    plan: plan(),
    videos,
    daily,
    subscriberCount: 100,
    channelTraffic: null,
    now,
    ...overrides,
  };
}

describe('growth plan probability and arithmetic', () => {
  it('computes Wilson intervals and rule-of-three edge cases', () => {
    const wilson = computeWilsonInterval(5, 10);
    expect(wilson!.low).toBeCloseTo(0.2366, 3);
    expect(wilson!.high).toBeCloseTo(0.7634, 3);
    expect(computeWilsonInterval(10, 10)!.high).toBe(1);
    expect(computeHitRate(0, 20)).toMatchObject({ hits: 0, count: 20, rate: 0, low: 0, ruleOfThreeUpperBound: 0.15, videosUntilHit: null });
    expect(computeHitRate(0, 5).message).toContain('chưa có video nào đạt mốc; ước lượng chưa có ý nghĩa');
    expect(computeHitRate(5, 5).rate).toBe(1);
    expect(computeHitRate(5, 0).rate).toBeNull();
  });

  it('matches hand-calculated required views for three and four videos per week', () => {
    expect(computeRequiredViews({ cadencePerWeek: 3, watchHoursTarget: 8_000, avgViewDurationMin: 3, subscribersPerThousandViews: null }).hoursViewsPerVideo).toBeCloseTo(1_025.64, 1);
    expect(computeRequiredViews({ cadencePerWeek: 3, watchHoursTarget: 8_000, avgViewDurationMin: 4, subscribersPerThousandViews: null }).hoursViewsPerVideo).toBeCloseTo(769.23, 1);
    expect(computeRequiredViews({ cadencePerWeek: 4, watchHoursTarget: 8_000, avgViewDurationMin: 3, subscribersPerThousandViews: null }).hoursViewsPerVideo).toBeCloseTo(769.23, 1);
    expect(computeRequiredViews({ cadencePerWeek: 4, watchHoursTarget: 8_000, avgViewDurationMin: 4, subscribersPerThousandViews: null }).hoursViewsPerVideo).toBeCloseTo(576.92, 1);
    expect(computeRequiredViews({ cadencePerWeek: 3.5, watchHoursTarget: 8_000, avgViewDurationMin: 4, subscribersPerThousandViews: 5 })).toMatchObject({ binding: 'subscribers', subscribersViewsPerVideo: expect.any(Number) });
  });
});

describe('pure YouTube growth plan engine', () => {
  it('keeps private, short, removed and excluded videos out and uses only the labelled 28–45 day fallback', () => {
    const eligible = video(1, 600);
    const fallback = video(2, 999, { publishedAt: dayAgo(35), first28d: null, analytics: { lifetime: { views: 700 } } });
    const result = buildYoutubeGrowthPlan(input([
      eligible,
      fallback,
      video(3, 900, { privacy: 'private' }),
      video(4, 900, { isShort: true }),
      video(5, 900, { excludedFromPlan: true }),
      { ...video(6, 900), removed: true },
    ]));
    expect(result.eligibleVideoCount).toBe(2);
    expect(result.matureCount).toBe(2);
    expect(result.distribution).toMatchObject({ approximateCount: 1, measuredCount: 1, median: 650 });
    expect(result.metrics.first28_approximate_count?.value).toBe(1);
    expect(result.assumptions.join(' ')).toContain('xấp xỉ');
  });

  it('reports younger videos as pending and refuses date-based decisions without a niche date', () => {
    const young = video(1, 10, { publishedAt: dayAgo(20), first28d: null });
    const pendingResult = buildYoutubeGrowthPlan(input([young]));
    expect(pendingResult.pending).toMatchObject([{ videoId: 'video-1', maturesOn: '2026-11-02' }]);
    const result = buildYoutubeGrowthPlan(input([young], { plan: plan(null) }));
    expect(result.eligibleVideoCount).toBe(0);
    expect(result.verdict.verdict).toBe('insufficient_data');
    expect(result.checkpoints.every((checkpoint) => checkpoint.estimatedDate === null && checkpoint.status === 'upcoming')).toBe(true);
  });

  it('produces A–E stage boundaries and checkpoint state from mature data and channel figures', () => {
    expect(buildYoutubeGrowthPlan(input(Array.from({ length: 2 }, (_, i) => video(i, 600)))).stage.current).toBe('A');
    expect(buildYoutubeGrowthPlan(input(Array.from({ length: 2 }, (_, i) => video(i, 600)))).stage.unmetConditions.join(' ')).toContain('10 video trưởng thành');
    expect(buildYoutubeGrowthPlan(input(Array.from({ length: 5 }, (_, i) => video(i, 600)))).stage.current).toBe('A');
    expect(buildYoutubeGrowthPlan(input(Array.from({ length: 12 }, (_, i) => video(i, 600)))).stage.current).toBe('B');
    expect(buildYoutubeGrowthPlan(input(Array.from({ length: 12 }, (_, i) => video(i, 100)))).stage.unmetConditions.join(' ')).toContain('300 lượt xem');
    expect(buildYoutubeGrowthPlan(input(Array.from({ length: 20 }, (_, i) => video(i, 600)))).stage.current).toBe('B');
    const stageC = buildYoutubeGrowthPlan(input(Array.from({ length: 12 }, (_, i) => video(i, i === 11 ? 1_000 : 600)), { subscriberCount: 200 }));
    expect(stageC.stage.current).toBe('C');
    const highHours = (index: number, views: number) => video(index, views, { analytics: { '365d': { estimatedMinutesWatched: 20_000 } } });
    const stageD = buildYoutubeGrowthPlan(input(Array.from({ length: 12 }, (_, index) => highHours(index, 800)), { subscriberCount: 500 }));
    expect(stageD.stage.current).toBe('D');
    const stageE = buildYoutubeGrowthPlan(input(Array.from({ length: 12 }, (_, index) => highHours(index, 1_200)), { subscriberCount: 1_000 }));
    expect(stageE.stage.current).toBe('E');
    expect(stageC.checkpoints.find((checkpoint) => checkpoint.id === 'a_review')?.status).toBe('reached');
  });

  it('keeps forecasts bounded, deterministic, and scenario ordered', () => {
    const videos = Array.from({ length: 12 }, (_, index) => video(index, 100 + index * 20));
    const result = buildYoutubeGrowthPlan(input(videos));
    expect(result.forecast.status).toBe('ready');
    if (result.forecast.status === 'ready') {
      const { optimistic, central, pessimistic } = result.forecast;
      expect(optimistic.week ?? Infinity).toBeLessThanOrEqual(central.week ?? Infinity);
      expect(central.week ?? Infinity).toBeLessThanOrEqual(pessimistic.week ?? Infinity);
      expect(result.forecast.tailFactorAssumed).toBe(false);
      expect(result.forecast.tailFactor).toBe(2);
      expect(Math.abs(optimistic.slopeViewsPerVideo)).toBeLessThanOrEqual(10 * (result.distribution.p75 ?? 0));
    }
    expect(buildYoutubeGrowthPlan(input(videos))).toEqual(result);
    expect(result.assumptions).toContain('Dự báo từ ít video có sai số rất lớn.');
  });

  it('marks the tail factor assumed with fewer than three older videos and handles flat or declining trends', () => {
    const fewerOld = Array.from({ length: 12 }, (_, index) => video(index, 100, { publishedAt: dayAgo(index < 2 ? 120 : 60), first28d: { capturedAt: now.toISOString(), views: 100, estimatedMinutesWatched: 400, averageViewDurationSec: 240, averageViewPercentage: 40, subscribersGained: 1, subscribersLost: 0 }, analytics: { '365d': { estimatedMinutesWatched: 0 } } }));
    const assumed = buildYoutubeGrowthPlan(input(fewerOld, { subscriberCount: 0, plan: plan('2026-01-01', { toleranceMonths: 1 }) }));
    expect(assumed.forecast).toMatchObject({ status: 'ready', tailFactor: 1, tailFactorAssumed: true });
    if (assumed.forecast.status === 'ready') expect(assumed.forecast.central.week).toBeNull();

    const declining = Array.from({ length: 12 }, (_, index) => video(index, 1_200 - index * 100));
    const decliningResult = buildYoutubeGrowthPlan(input(declining, { plan: plan('2026-01-01', { toleranceMonths: 1 }) }));
    expect(decliningResult.forecast.status).toBe('ready');
    if (decliningResult.forecast.status === 'ready') {
      expect(decliningResult.forecast.optimistic.slopeViewsPerVideo).toBeLessThan(0);
      expect(decliningResult.forecast.central.week).toBeNull();
      expect(decliningResult.forecast.optimistic.week ?? Infinity).toBeLessThanOrEqual(decliningResult.forecast.central.week ?? Infinity);
      expect(decliningResult.forecast.central.week ?? Infinity).toBeLessThanOrEqual(decliningResult.forecast.pessimistic.week ?? Infinity);
    }
  });

  it('routes warning and stop decisions through named evidence and the experiment guard', () => {
    const declining = Array.from({ length: 20 }, (_, index) => video(index, 90 - index * 3));
    const warning = buildYoutubeGrowthPlan(input(declining));
    expect(warning.verdict.verdict).toBe('change_one_variable');
    expect(warning.verdict.reasons.map((reason) => reason.text).join(' ')).toContain('topic');
    expect(warning.verdict.reasons.flatMap((reason) => reason.metricIds).every((id) => Object.hasOwn(warning.metrics, id))).toBe(true);
    const halfCtrKnown = declining.map((item, index) => index < 10 ? { ...item, manualReach: { impressions: 1_000, ctrPercent: 1, enteredAt: now.toISOString() } } : item);
    const halfCoverage = buildYoutubeGrowthPlan(input(halfCtrKnown));
    expect(halfCoverage.verdict.reasons.map((reason) => reason.text).join(' ')).toContain('topic');
    const majorityCtrKnown = declining.map((item, index) => index < 11 ? { ...item, manualReach: { impressions: 1_000, ctrPercent: 1, enteredAt: now.toISOString() } } : item);
    expect(buildYoutubeGrowthPlan(input(majorityCtrKnown)).verdict.reasons.map((reason) => reason.text).join(' ')).toContain('thumbnail');

    const stopped = Array.from({ length: 45 }, (_, index) => video(index, 20 + index % 3));
    const stopPlan = plan('2026-01-01', { toleranceMonths: 1, experiments: [
      { id: 'exp-1', date: '2026-02-01', variable: 'topic', note: 'A' },
      { id: 'exp-2', date: '2026-03-01', variable: 'title', note: 'B' },
    ] });
    const stop = buildYoutubeGrowthPlan(input(stopped, { plan: stopPlan }));
    expect(stop.verdict.verdict).toBe('consider_stop');
    expect(stop.verdict.reasons.map((reason) => reason.text).join(' ')).toContain('Cân nhắc dừng ngách theo tiêu chí đã đặt');
    expect(stop.verdict.reasons.flatMap((reason) => reason.metricIds).every((id) => Object.hasOwn(stop.metrics, id))).toBe(true);
    const missingExperiments = buildYoutubeGrowthPlan(input(stopped, { plan: plan('2026-01-01', { toleranceMonths: 1 }) }));
    expect(missingExperiments.verdict.verdict).toBe('change_one_variable');
    expect(missingExperiments.verdict.reasons.map((reason) => reason.text).join(' ')).toContain('chưa thử đủ thay đổi trước khi dừng');
  });

  it('returns the expected insufficient-data state for Hung’s current two-video cohort', () => {
    const result = buildYoutubeGrowthPlan(input([video(1, 10), video(2, 20)]));
    expect(result.matureCount).toBe(2);
    expect(result.verdict.verdict).toBe('insufficient_data');
    expect(result.forecast).toMatchObject({ status: 'insufficient-data' });
  });
});
