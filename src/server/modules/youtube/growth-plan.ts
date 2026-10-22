import type { YoutubeChannelDaily, YoutubeRetentionCurve, YoutubeTrafficBreakdown, YoutubeVideoStats } from '../../../contracts/youtube';
import {
  MIN_IMPRESSIONS_FOR_CTR,
  YoutubeGrowthPlanStatusSchema,
  type YoutubeGrowthPlan,
  type YoutubeGrowthPlanStatus,
} from '../../../contracts/youtube-plan';
import { getRetentionDropSegments, YOUTUBE_PARTNER_PROGRAM_THRESHOLDS } from './analysis';

export const YOUTUBE_GROWTH_PLAN_HEURISTICS = {
  matureAgeDays: 31,
  fallbackMinimumAgeDays: 28,
  fallbackMaximumAgeDays: 45,
  wilsonZ: 1.96,
  ruleOfThreeNumerator: 3,
  noHitSmallSampleLimit: 10,
  expectedHitVideoCap: 1_000,
  trendVideoLimit: 20,
  optimisticSlopePercentile: 0.8,
  pessimisticSlopePercentile: 0.2,
  projectedViewsCapP75Multiple: 10,
  tailFactorMinimumVideos: 3,
  forecastWeeksPerYear: 52,
  forecastDaysPerWeek: 7,
  forecastWeeksPerMonth: 52 / 12,
  forecastExtraMonths: 6,
  stopMaximumFirstTargetHits: 2,
  stopLowUpperBound: 0.05,
  confidenceLowMaximumMatureVideos: 14,
  confidenceHighMinimumMatureVideos: 40,
  confidenceMediumMaximumMatureVideos: 39,
  earlyRetentionDropFractionThreshold: 0.5,
  lowCtrHeuristicPercent: 2,
  lowCtrKnownCoverageFraction: 0.5,
  dominantTrafficSourceFraction: 0.7,
  warningMedianViews: 100,
  stageCMedianViews: 300,
  stageCSubscribers: 200,
  stageCWatchHours: 500,
  stageDMedianViews: 700,
  stageDSubscribers: 500,
  stageDWatchHours: 3_000,
  targetSubscribers: 1_000,
  thresholdChangeDate: '2027-02-01',
} as const;

export type YoutubeGrowthVideo = YoutubeVideoStats & {
  removed?: boolean;
};

export type BuildYoutubeGrowthPlanInput = {
  plan: YoutubeGrowthPlan;
  videos: readonly YoutubeGrowthVideo[];
  daily: readonly YoutubeChannelDaily[] | null;
  subscriberCount: number | null;
  channelTraffic: { last28d?: YoutubeTrafficBreakdown | null } | null;
  retentionByVideoId?: Readonly<Record<string, YoutubeRetentionCurve | null>>;
  now: Date;
};

type MeasuredVideo = { video: YoutubeGrowthVideo; views: number; approximate: boolean; ageDays: number };
type HitRate = YoutubeGrowthPlanStatus['hitRates']['first'];
type CheckpointId = YoutubeGrowthPlanStatus['checkpoints'][number]['id'];

function quantile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function median(values: readonly number[]): number | null {
  return quantile(values, 0.5);
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return dateOnly(new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * 86_400_000));
}

function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return dateOnly(first);
}

function ageDays(publishedAt: string, now: Date): number {
  const published = Date.parse(publishedAt);
  return Number.isFinite(published) ? Math.floor((now.getTime() - published) / 86_400_000) : -1;
}

function videoViewsMetricId(videoId: string): string {
  const token = [...videoId].map((character) => character.codePointAt(0)!.toString(16)).join('-');
  return `first28_video_${token}_views`;
}

function viewsForWindow(video: YoutubeVideoStats, window: string): number | null {
  const value = (video.analytics[window] as Record<string, number | null | undefined> | undefined)?.views;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function hoursForChannel(videos: readonly YoutubeGrowthVideo[]): number | null {
  const publicLong = videos.filter((video) => !video.removed && video.privacy === 'public' && !video.isShort);
  if (publicLong.length === 0) return 0;
  const minutes = publicLong.map((video) => (video.analytics['365d'] as Record<string, number | null | undefined> | undefined)?.estimatedMinutesWatched);
  if (minutes.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return null;
  return minutes.reduce<number>((sum, value) => sum + (value as number), 0) / 60;
}

function isPlanEligible(video: YoutubeGrowthVideo, nicheStartDate: string | null): boolean {
  if (video.removed || video.privacy !== 'public' || video.isShort || video.excludedFromPlan || !video.publishedAt) return false;
  if (!nicheStartDate) return false;
  return dateOnly(new Date(video.publishedAt)) >= nicheStartDate;
}

function collectPlanVideos(videos: readonly YoutubeGrowthVideo[], plan: YoutubeGrowthPlan, now: Date): {
  eligible: YoutubeGrowthVideo[];
  mature: MeasuredVideo[];
  pending: YoutubeGrowthPlanStatus['pending'];
  unknownMatureCount: number;
} {
  const eligible = videos.filter((video) => isPlanEligible(video, plan.nicheStartDate));
  const mature: MeasuredVideo[] = [];
  const pending: YoutubeGrowthPlanStatus['pending'] = [];
  let unknownMatureCount = 0;
  for (const video of eligible) {
    const age = ageDays(video.publishedAt!, now);
    if (video.first28d) {
      if (typeof video.first28d.views === 'number') mature.push({ video, views: video.first28d.views, approximate: false, ageDays: age });
      else unknownMatureCount += 1;
      continue;
    }
    if (age >= YOUTUBE_GROWTH_PLAN_HEURISTICS.fallbackMinimumAgeDays && age <= YOUTUBE_GROWTH_PLAN_HEURISTICS.fallbackMaximumAgeDays) {
      const lifetime = viewsForWindow(video, 'lifetime');
      if (lifetime !== null) {
        mature.push({ video, views: lifetime, approximate: true, ageDays: age });
        continue;
      }
    }
    if (age < YOUTUBE_GROWTH_PLAN_HEURISTICS.matureAgeDays) {
      pending.push({ videoId: video.videoId, title: video.title, publishedAt: dateOnly(new Date(video.publishedAt!)), maturesOn: addDays(dateOnly(new Date(video.publishedAt!)), YOUTUBE_GROWTH_PLAN_HEURISTICS.matureAgeDays) });
    } else {
      unknownMatureCount += 1;
    }
  }
  mature.sort((a, b) => a.video.publishedAt!.localeCompare(b.video.publishedAt!) || a.video.videoId.localeCompare(b.video.videoId));
  pending.sort((a, b) => a.maturesOn.localeCompare(b.maturesOn) || a.videoId.localeCompare(b.videoId));
  return { eligible, mature, pending, unknownMatureCount };
}

export function computeWilsonInterval(hits: number, count: number): { low: number; high: number } | null {
  if (count <= 0) return null;
  const p = Math.min(count, Math.max(0, hits)) / count;
  const z2 = YOUTUBE_GROWTH_PLAN_HEURISTICS.wilsonZ ** 2;
  const denominator = 1 + z2 / count;
  const center = (p + z2 / (2 * count)) / denominator;
  const margin = YOUTUBE_GROWTH_PLAN_HEURISTICS.wilsonZ * Math.sqrt((p * (1 - p) + z2 / (4 * count)) / count) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export function computeHitRate(hits: number, count: number, approximate = false): HitRate {
  if (count <= 0) return { hits: 0, count: 0, rate: null, low: null, high: null, videosUntilHit: null, ruleOfThreeUpperBound: null, approximate, message: 'Chưa có đủ video trưởng thành để ước lượng.' };
  const safeHits = Math.min(count, Math.max(0, Math.floor(hits)));
  const rate = safeHits / count;
  if (safeHits === 0) {
    const upper = Math.min(1, YOUTUBE_GROWTH_PLAN_HEURISTICS.ruleOfThreeNumerator / count);
    return {
      hits: safeHits, count, rate, low: 0, high: upper, videosUntilHit: null, ruleOfThreeUpperBound: upper, approximate,
      message: count < YOUTUBE_GROWTH_PLAN_HEURISTICS.noHitSmallSampleLimit ? 'chưa có video nào đạt mốc; ước lượng chưa có ý nghĩa' : 'Chưa có video nào đạt mốc; cận trên dùng quy tắc 3/n.',
    };
  }
  const interval = computeWilsonInterval(safeHits, count)!;
  const minimum = Math.min(YOUTUBE_GROWTH_PLAN_HEURISTICS.expectedHitVideoCap, 1 / interval.high);
  const maximum = Math.min(YOUTUBE_GROWTH_PLAN_HEURISTICS.expectedHitVideoCap, 1 / interval.low);
  return { hits: safeHits, count, rate, low: interval.low, high: interval.high, videosUntilHit: { min: minimum, max: maximum }, ruleOfThreeUpperBound: null, approximate };
}

export function computeRequiredViews(input: { cadencePerWeek: number; watchHoursTarget: number; avgViewDurationMin: number; subscribersPerThousandViews: number | null }): {
  plannedVideosPerYear: number;
  hoursViewsPerVideo: number;
  subscribersViewsPerVideo: number | null;
  binding: 'watch-hours' | 'subscribers' | 'both' | 'unknown';
  bindingViewsPerVideo: number | null;
} {
  const plannedVideosPerYear = input.cadencePerWeek * YOUTUBE_GROWTH_PLAN_HEURISTICS.forecastWeeksPerYear;
  const hoursViewsPerVideo = input.watchHoursTarget * 60 / plannedVideosPerYear / input.avgViewDurationMin;
  const subsRate = input.subscribersPerThousandViews;
  const subscribersViewsPerVideo = subsRate !== null && subsRate > 0 ? (YOUTUBE_GROWTH_PLAN_HEURISTICS.targetSubscribers * 1_000) / (plannedVideosPerYear * subsRate) : null;
  if (subscribersViewsPerVideo === null) return { plannedVideosPerYear, hoursViewsPerVideo, subscribersViewsPerVideo: null, binding: 'unknown', bindingViewsPerVideo: null };
  const difference = Math.abs(hoursViewsPerVideo - subscribersViewsPerVideo);
  return {
    plannedVideosPerYear,
    hoursViewsPerVideo,
    subscribersViewsPerVideo,
    binding: difference < 1e-9 ? 'both' : hoursViewsPerVideo > subscribersViewsPerVideo ? 'watch-hours' : 'subscribers',
    bindingViewsPerVideo: Math.max(hoursViewsPerVideo, subscribersViewsPerVideo),
  };
}

function theilSenSlopes(values: readonly number[]): number[] {
  const slopes: number[] = [];
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) slopes.push((values[right]! - values[left]!) / (right - left));
  }
  return slopes;
}

function currentTailFactor(mature: readonly MeasuredVideo[]): { factor: number; assumed: boolean } {
  const ratios = mature.flatMap((row) => {
    if (row.ageDays <= 90 || row.views <= 0) return [];
    const annual = viewsForWindow(row.video, '365d') ?? viewsForWindow(row.video, 'lifetime');
    return annual === null ? [] : [annual / row.views];
  });
  if (ratios.length < YOUTUBE_GROWTH_PLAN_HEURISTICS.tailFactorMinimumVideos) return { factor: 1, assumed: true };
  return { factor: Math.max(0, median(ratios) ?? 1), assumed: false };
}

function forecast(input: {
  plan: YoutubeGrowthPlan;
  mature: readonly MeasuredVideo[];
  videos: readonly YoutubeGrowthVideo[];
  daily: readonly YoutubeChannelDaily[] | null;
  subscriberCount: number | null;
  avgViewDurationMin: number;
  avgViewDurationAssumed: boolean;
  subscribersPerThousandViews: number | null;
  last10Median: number | null;
  p75: number | null;
  now: Date;
}): YoutubeGrowthPlanStatus['forecast'] {
  if (input.mature.length < 10) return { status: 'insufficient-data', reason: 'Cần ít nhất 10 video trưởng thành để dự báo.' };
  if (!input.daily?.length) return { status: 'insufficient-data', reason: 'Chưa có chuỗi Analytics theo ngày.' };
  if (input.subscriberCount === null || input.subscribersPerThousandViews === null) return { status: 'insufficient-data', reason: 'Chưa đo được số người đăng ký tăng trên mỗi 1.000 lượt xem.' };
  const subscriberRate = input.subscribersPerThousandViews;
  const watchHoursNow = hoursForChannel(input.videos);
  if (watchHoursNow === null) return { status: 'insufficient-data', reason: 'Chưa có đủ số liệu giờ xem công khai trong 365 ngày.' };
  const levels = input.mature.slice(-YOUTUBE_GROWTH_PLAN_HEURISTICS.trendVideoLimit).map((row) => row.views);
  const slopes = theilSenSlopes(levels);
  const centralSlope = median(slopes) ?? 0;
  const optimisticSlope = quantile(slopes, YOUTUBE_GROWTH_PLAN_HEURISTICS.optimisticSlopePercentile) ?? centralSlope;
  const pessimisticSlope = quantile(slopes, YOUTUBE_GROWTH_PLAN_HEURISTICS.pessimisticSlopePercentile) ?? centralSlope;
  const cap = Math.max(0, (input.p75 ?? 0) * YOUTUBE_GROWTH_PLAN_HEURISTICS.projectedViewsCapP75Multiple);
  const currentLevel = Math.max(0, input.last10Median ?? median(levels) ?? 0);
  const tail = currentTailFactor(input.mature);
  const horizonWeeks = Math.ceil((input.plan.toleranceMonths + YOUTUBE_GROWTH_PLAN_HEURISTICS.forecastExtraMonths) * YOUTUBE_GROWTH_PLAN_HEURISTICS.forecastWeeksPerMonth);
  const startHours = watchHoursNow;
  const startSubscribers = input.subscriberCount;

  const simulate = (slope: number): { slopeViewsPerVideo: number; week: number | null; date: string | null; beyondTolerance: boolean } => {
    const published: { hours: number; subscribers: number; week: number }[] = [];
    let totalPublished = 0;
    let hitWeek: number | null = null;
    for (let week = 1; week <= horizonWeeks; week += 1) {
      const arrivals = Math.floor(week * input.plan.cadencePerWeek) - Math.floor((week - 1) * input.plan.cadencePerWeek);
      for (let arrival = 0; arrival < arrivals; arrival += 1) {
        totalPublished += 1;
        const projectedViews = Math.min(cap, Math.max(0, currentLevel + slope * totalPublished)) * tail.factor;
        published.push({
          hours: projectedViews * input.avgViewDurationMin / 60,
          subscribers: projectedViews * subscriberRate / 1_000,
          week,
        });
      }
      const retainedHours = published.reduce((sum, item) => {
        const age = week - item.week;
        return age >= 0 && age < YOUTUBE_GROWTH_PLAN_HEURISTICS.forecastWeeksPerYear
          ? sum + item.hours * Math.min(1, (age + 1) / YOUTUBE_GROWTH_PLAN_HEURISTICS.forecastWeeksPerYear)
          : sum;
      }, 0);
      const projectedSubscribers = published.reduce((sum, item) => {
        const age = week - item.week;
        return age >= 0 ? sum + item.subscribers * Math.min(1, (age + 1) / YOUTUBE_GROWTH_PLAN_HEURISTICS.forecastWeeksPerYear) : sum;
      }, 0);
      const remainingBaselineHours = Math.max(0, startHours * (1 - week / YOUTUBE_GROWTH_PLAN_HEURISTICS.forecastWeeksPerYear));
      const projectedHours = remainingBaselineHours + retainedHours;
      const projectedDate = addDays(dateOnly(input.now), week * YOUTUBE_GROWTH_PLAN_HEURISTICS.forecastDaysPerWeek);
      const requiredHours = projectedDate >= YOUTUBE_GROWTH_PLAN_HEURISTICS.thresholdChangeDate
        ? YOUTUBE_PARTNER_PROGRAM_THRESHOLDS.from2027_02_01.ads.longWatchHours
        : YOUTUBE_PARTNER_PROGRAM_THRESHOLDS.current.ads.longWatchHours;
      if (projectedHours >= requiredHours && startSubscribers + projectedSubscribers >= YOUTUBE_GROWTH_PLAN_HEURISTICS.targetSubscribers) {
        hitWeek = week;
        break;
      }
    }
    const toleranceWeeks = Math.ceil(input.plan.toleranceMonths * YOUTUBE_GROWTH_PLAN_HEURISTICS.forecastWeeksPerMonth);
    return {
      slopeViewsPerVideo: slope,
      week: hitWeek,
      date: hitWeek === null ? null : addDays(dateOnly(input.now), hitWeek * YOUTUBE_GROWTH_PLAN_HEURISTICS.forecastDaysPerWeek),
      beyondTolerance: hitWeek === null || hitWeek > toleranceWeeks,
    };
  };

  return {
    status: 'ready',
    optimistic: simulate(optimisticSlope),
    central: simulate(centralSlope),
    pessimistic: simulate(pessimisticSlope),
    tailFactor: tail.factor,
    tailFactorAssumed: tail.assumed,
    horizonWeeks,
  };
}

function partnerHoursTarget(now: Date): number {
  return dateOnly(now) >= YOUTUBE_GROWTH_PLAN_HEURISTICS.thresholdChangeDate
    ? YOUTUBE_PARTNER_PROGRAM_THRESHOLDS.from2027_02_01.ads.longWatchHours
    : YOUTUBE_PARTNER_PROGRAM_THRESHOLDS.current.ads.longWatchHours;
}

function lowCtrStatus(mature: readonly MeasuredVideo[]): { known: number; isLow: boolean; unknownForMost: boolean } {
  const values = mature.flatMap(({ video }) => video.manualReach && video.manualReach.impressions >= MIN_IMPRESSIONS_FOR_CTR ? [video.manualReach.ctrPercent] : []);
  const enoughKnown = values.length > mature.length * YOUTUBE_GROWTH_PLAN_HEURISTICS.lowCtrKnownCoverageFraction;
  return { known: values.length, isLow: enoughKnown && (median(values) ?? Infinity) < YOUTUBE_GROWTH_PLAN_HEURISTICS.lowCtrHeuristicPercent, unknownForMost: values.length <= mature.length / 2 };
}

function dominantTrafficSource(channelTraffic: BuildYoutubeGrowthPlanInput['channelTraffic']): string | null {
  const sources = channelTraffic?.last28d?.status === 'ok' ? channelTraffic.last28d.sources : [];
  if (sources.length === 0 || sources.some((source) => source.views === null)) return null;
  const total = sources.reduce((sum, source) => sum + source.views!, 0);
  if (total <= 0) return null;
  const top = [...sources].sort((a, b) => (b.views ?? 0) - (a.views ?? 0) || a.sourceType.localeCompare(b.sourceType))[0]!;
  return (top.views ?? 0) / total >= YOUTUBE_GROWTH_PLAN_HEURISTICS.dominantTrafficSourceFraction ? top.sourceType : null;
}

function makeCheckpoints(input: { plan: YoutubeGrowthPlan; matureCount: number; now: Date }): YoutubeGrowthPlanStatus['checkpoints'] {
  const dateForVideoCount = (count: number) => {
    if (!input.plan.nicheStartDate) return null;
    const uploadDays = Math.ceil(Math.max(0, count - 1) / input.plan.cadencePerWeek * YOUTUBE_GROWTH_PLAN_HEURISTICS.forecastDaysPerWeek);
    return addDays(input.plan.nicheStartDate, uploadDays + YOUTUBE_GROWTH_PLAN_HEURISTICS.matureAgeDays);
  };
  const monthsSinceStart = input.plan.nicheStartDate ? (input.now.getTime() - Date.parse(`${input.plan.nicheStartDate}T00:00:00.000Z`)) / (86_400_000 * 365 / 12) : 0;
  const decisionMaturityDate = dateForVideoCount(input.plan.decideAtMatureVideos);
  const decisionMonthDate = input.plan.nicheStartDate ? addMonths(input.plan.nicheStartDate, input.plan.decideMinMonths) : null;
  const decisionDate = decisionMaturityDate && decisionMonthDate ? (decisionMaturityDate > decisionMonthDate ? decisionMaturityDate : decisionMonthDate) : null;
  const hardDate = input.plan.nicheStartDate ? addDays(input.plan.nicheStartDate, input.plan.hardReviewWeek * YOUTUBE_GROWTH_PLAN_HEURISTICS.forecastDaysPerWeek) : null;
  const build = (id: CheckpointId, label: string, estimatedDate: string | null, target: number | null, reached: boolean, evaluate: string) => ({
    id, label, estimatedDate, matureVideoTarget: target, evaluate,
    status: reached ? 'reached' as const : estimatedDate && estimatedDate < dateOnly(input.now) ? 'passed' as const : 'upcoming' as const,
  });
  return [
    build('a_review', 'Rà soát đầu tiên', dateForVideoCount(YOUTUBE_GROWTH_PLAN_HEURISTICS.noHitSmallSampleLimit), YOUTUBE_GROWTH_PLAN_HEURISTICS.noHitSmallSampleLimit, input.matureCount >= YOUTUBE_GROWTH_PLAN_HEURISTICS.noHitSmallSampleLimit, 'Xem phân phối view 28 ngày, tỷ lệ đạt mốc, và dữ liệu còn thiếu.'),
    build('warning', 'Điểm cảnh báo', dateForVideoCount(input.plan.warnAtMatureVideos), input.plan.warnAtMatureVideos, input.matureCount >= input.plan.warnAtMatureVideos, 'Nếu view trung vị thấp, xu hướng không tăng và chưa video nào đạt mốc đầu, đổi một biến.'),
    build('decision', 'Điểm quyết định', decisionDate, input.plan.decideAtMatureVideos, input.matureCount >= input.plan.decideAtMatureVideos && monthsSinceStart >= input.plan.decideMinMonths, 'Đối chiếu dự báo, số video đạt mốc đầu và số thử nghiệm đã ghi trước khi cân nhắc dừng.'),
    build('hard_review', 'Rà soát bắt buộc', hardDate, null, Boolean(hardDate && dateOnly(input.now) >= hardDate), 'Mở lại dự báo, giả định và các điều kiện đã đặt.'),
  ];
}

function missingStageConditions(input: { stage: string; matureCount: number; median: number | null; strongHit: boolean; subscriberCount: number | null; watchHours: number | null; targetHours: number }): string[] {
  const conditions: string[] = [];
  if (input.stage === 'B') return [`Cần ${YOUTUBE_GROWTH_PLAN_HEURISTICS.noHitSmallSampleLimit} video trưởng thành có số liệu; hiện có ${input.matureCount}.`];
  if (input.stage === 'E') {
    if ((input.subscriberCount ?? -Infinity) < YOUTUBE_GROWTH_PLAN_HEURISTICS.targetSubscribers) conditions.push(`Người đăng ký: ${input.subscriberCount ?? 'chưa có dữ liệu'} / ${YOUTUBE_GROWTH_PLAN_HEURISTICS.targetSubscribers}.`);
    if ((input.watchHours ?? -Infinity) < input.targetHours) conditions.push(`Giờ xem công khai 365 ngày: ${input.watchHours ?? 'chưa có dữ liệu'} / ${input.targetHours}.`);
    return conditions;
  }
  if (input.stage === 'D') {
    if (input.median === null || input.median < YOUTUBE_GROWTH_PLAN_HEURISTICS.stageDMedianViews) conditions.push(`Trung vị 10 video gần nhất: ${input.median ?? 'chưa có dữ liệu'} / ${YOUTUBE_GROWTH_PLAN_HEURISTICS.stageDMedianViews} lượt xem.`);
    if ((input.subscriberCount ?? -Infinity) < YOUTUBE_GROWTH_PLAN_HEURISTICS.stageDSubscribers) conditions.push(`Người đăng ký: ${input.subscriberCount ?? 'chưa có dữ liệu'} / ${YOUTUBE_GROWTH_PLAN_HEURISTICS.stageDSubscribers}.`);
    if ((input.watchHours ?? -Infinity) < YOUTUBE_GROWTH_PLAN_HEURISTICS.stageDWatchHours) conditions.push(`Giờ xem công khai 365 ngày: ${input.watchHours ?? 'chưa có dữ liệu'} / ${YOUTUBE_GROWTH_PLAN_HEURISTICS.stageDWatchHours}.`);
    return conditions;
  }
  if (input.median === null || input.median < YOUTUBE_GROWTH_PLAN_HEURISTICS.stageCMedianViews) conditions.push(`Trung vị 10 video gần nhất: ${input.median ?? 'chưa có dữ liệu'} / ${YOUTUBE_GROWTH_PLAN_HEURISTICS.stageCMedianViews} lượt xem.`);
  if (!input.strongHit) conditions.push('Cần ít nhất một video đạt mốc mạnh.');
  if ((input.subscriberCount ?? -Infinity) < YOUTUBE_GROWTH_PLAN_HEURISTICS.stageCSubscribers) conditions.push(`Người đăng ký: ${input.subscriberCount ?? 'chưa có dữ liệu'} / ${YOUTUBE_GROWTH_PLAN_HEURISTICS.stageCSubscribers}.`);
  if ((input.watchHours ?? -Infinity) < YOUTUBE_GROWTH_PLAN_HEURISTICS.stageCWatchHours) conditions.push(`Giờ xem công khai 365 ngày: ${input.watchHours ?? 'chưa có dữ liệu'} / ${YOUTUBE_GROWTH_PLAN_HEURISTICS.stageCWatchHours}.`);
  return conditions;
}

function stageFor(input: { matureCount: number; last10Median: number | null; strongHit: boolean; subscriberCount: number | null; watchHours: number | null; currentTargetHours: number }): YoutubeGrowthPlanStatus['stage'] {
  let current: 'A' | 'B' | 'C' | 'D' | 'E' = 'B';
  if (input.matureCount < YOUTUBE_GROWTH_PLAN_HEURISTICS.noHitSmallSampleLimit) current = 'A';
  else if (input.subscriberCount !== null && input.subscriberCount >= YOUTUBE_GROWTH_PLAN_HEURISTICS.targetSubscribers && input.watchHours !== null && input.watchHours >= input.currentTargetHours) current = 'E';
  else if (input.last10Median !== null && input.last10Median >= YOUTUBE_GROWTH_PLAN_HEURISTICS.stageDMedianViews && (input.subscriberCount ?? -Infinity) >= YOUTUBE_GROWTH_PLAN_HEURISTICS.stageDSubscribers && (input.watchHours ?? -Infinity) >= YOUTUBE_GROWTH_PLAN_HEURISTICS.stageDWatchHours) current = 'D';
  else if (input.strongHit && input.last10Median !== null && input.last10Median >= YOUTUBE_GROWTH_PLAN_HEURISTICS.stageCMedianViews && (input.subscriberCount ?? -Infinity) >= YOUTUBE_GROWTH_PLAN_HEURISTICS.stageCSubscribers && (input.watchHours ?? -Infinity) >= YOUTUBE_GROWTH_PLAN_HEURISTICS.stageCWatchHours) current = 'C';
  const next = current === 'E' ? null : String.fromCharCode(current.charCodeAt(0) + 1) as 'A' | 'B' | 'C' | 'D' | 'E';
  const nextStage = next ?? current;
  return {
    current,
    next,
    label: ({ A: 'A · Thu thập tín hiệu', B: 'B · Tìm mẫu lặp lại', C: 'C · Có tín hiệu tăng trưởng', D: 'D · Tăng quy mô', E: 'E · Đủ số liệu theo mốc tham khảo' } as const)[current],
    unmetConditions: current === 'E' ? [] : missingStageConditions({ stage: nextStage, matureCount: input.matureCount, median: input.last10Median, strongHit: input.strongHit, subscriberCount: input.subscriberCount, watchHours: input.watchHours, targetHours: input.currentTargetHours }),
  };
}

function mostRecentExperimentVariables(plan: YoutubeGrowthPlan, mature: readonly MeasuredVideo[]): string[] {
  const recent = mature.slice(-5);
  if (recent.length === 0) return [];
  const ids = new Set(recent.map((item) => item.video.videoId));
  const earliestDate = dateOnly(new Date(recent[0]!.video.publishedAt!));
  return plan.experiments.filter((experiment) => experiment.videoIds?.some((id) => ids.has(id)) || (!experiment.videoIds && experiment.date >= earliestDate)).map((experiment) => experiment.variable);
}

function selectChangeVariable(input: {
  mature: readonly MeasuredVideo[];
  plan: YoutubeGrowthPlan;
  retentionFraction: number | null;
  ctrLow: boolean;
  dominantSource: string | null;
}): { variable: string; note: string } {
  let variable = 'topic';
  let note = 'Thử một nhóm chủ đề hẹp hơn để kiểm tra mức phù hợp của ngách.';
  if (input.retentionFraction !== null && input.retentionFraction >= YOUTUBE_GROWTH_PLAN_HEURISTICS.earlyRetentionDropFractionThreshold) {
    variable = 'hook';
    note = 'Tín hiệu rơi giữ chân sớm xuất hiện trên nhiều video; đổi phần mở đầu trước.';
  } else if (input.ctrLow) {
    variable = 'thumbnail';
    note = `CTR trung vị dưới ${YOUTUBE_GROWTH_PLAN_HEURISTICS.lowCtrHeuristicPercent}% ở các video đủ ${MIN_IMPRESSIONS_FOR_CTR.toLocaleString('en-US')} lượt hiển thị; đây là ngưỡng heuristic, không phải chuẩn YouTube.`;
  } else if (input.dominantSource) {
    variable = 'topic';
    note = `Nguồn ${input.dominantSource} chiếm ưu thế; thử một nhóm chủ đề khác để xem tín hiệu có mở rộng không.`;
  }
  const tried = mostRecentExperimentVariables(input.plan, input.mature);
  const recentNote = tried.includes(variable) ? ` Biến ${variable} đã được ghi trong thử nghiệm thuộc 5 video gần nhất.` : tried.length ? ` Trong 5 video gần nhất đã ghi nhận các biến: ${[...new Set(tried)].join(', ')}.` : '';
  return { variable, note: `${note}${recentNote}` };
}

function metric(value: number | null, unit: string, label: string, assumed = false) {
  return { value, unit, label, ...(assumed ? { assumed: true } : {}) };
}

export function buildYoutubeGrowthPlan(input: BuildYoutubeGrowthPlanInput): YoutubeGrowthPlanStatus {
  const { plan, videos, now } = input;
  const { eligible, mature, pending, unknownMatureCount } = collectPlanVideos(videos, plan, now);
  const matureById = new Map(mature.map((row) => [row.video.videoId, row]));
  const planVideos = [...eligible].sort((a, b) => a.publishedAt!.localeCompare(b.publishedAt!) || a.videoId.localeCompare(b.videoId)).map((video) => {
    const measured = matureById.get(video.videoId);
    const metricId = videoViewsMetricId(video.videoId);
    return { videoId: video.videoId, title: video.title, publishedAt: dateOnly(new Date(video.publishedAt!)), first28dViews: measured?.views ?? null, approximate: measured?.approximate ?? false, metricId };
  });
  const values = mature.map((row) => row.views);
  const last10 = mature.slice(-10);
  const medianViews = median(values);
  const meanViews = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const last10Median = median(last10.map((row) => row.views));
  const p25 = quantile(values, 0.25);
  const p75 = quantile(values, 0.75);
  const maxViews = values.length ? Math.max(...values) : null;
  const approximateCount = mature.filter((row) => row.approximate).length;
  const snapshotRows = mature.filter((row) => !row.approximate);
  const viewsWithMinutes = snapshotRows.filter((row) => row.video.first28d?.estimatedMinutesWatched !== null && row.video.first28d?.estimatedMinutesWatched !== undefined);
  const aggregateViews = viewsWithMinutes.reduce((sum, row) => sum + row.views, 0);
  const aggregateMinutes = viewsWithMinutes.reduce((sum, row) => sum + row.video.first28d!.estimatedMinutesWatched!, 0);
  const avgViewDurationMeasured = aggregateViews > 0 && viewsWithMinutes.length > 0 ? aggregateMinutes / aggregateViews : null;
  const avgViewDurationMin = avgViewDurationMeasured ?? plan.assumedAvgViewDurationMin;
  const avgViewDurationAssumed = avgViewDurationMeasured === null;
  const subRows = snapshotRows.filter((row) => row.video.first28d?.subscribersGained !== null && row.video.first28d?.subscribersGained !== undefined);
  const subViews = subRows.reduce((sum, row) => sum + row.views, 0);
  const subGains = subRows.reduce((sum, row) => sum + row.video.first28d!.subscribersGained!, 0);
  const subscribersPerThousandViews = subRows.length === snapshotRows.length && subViews > 0 ? subGains * 1_000 / subViews : null;
  const retentionRows = mature.flatMap((row) => {
    const curve = input.retentionByVideoId?.[row.video.videoId];
    return curve ? [getRetentionDropSegments(curve, row.video.durationSec).earlyDrop] : [];
  });
  const earlyRetentionDropFraction = retentionRows.length ? retentionRows.filter(Boolean).length / retentionRows.length : null;
  const firstRate = computeHitRate(mature.filter((row) => row.views >= plan.viewTargets.first).length, mature.length, approximateCount > 0);
  const strongRate = computeHitRate(mature.filter((row) => row.views >= plan.viewTargets.strong).length, mature.length, approximateCount > 0);
  const hoursTarget = partnerHoursTarget(now);
  const required = computeRequiredViews({ cadencePerWeek: plan.cadencePerWeek, watchHoursTarget: hoursTarget, avgViewDurationMin, subscribersPerThousandViews });
  const currentWatchHours = hoursForChannel(videos);
  const gap = (requiredViews: number | null, current: number | null) => ({
    absolute: requiredViews === null || current === null ? null : requiredViews - current,
    ratio: requiredViews === null || current === null || current <= 0 ? null : requiredViews / current,
  });
  const forecastResult = forecast({ plan, mature, videos, daily: input.daily, subscriberCount: input.subscriberCount, avgViewDurationMin, avgViewDurationAssumed, subscribersPerThousandViews, last10Median, p75, now });
  const checkpoints = makeCheckpoints({ plan, matureCount: mature.length, now });
  const nextCheckpoint = checkpoints.find((checkpoint) => checkpoint.status === 'upcoming')?.id ?? null;
  const ctr = lowCtrStatus(mature);
  const slopes = theilSenSlopes(mature.slice(-YOUTUBE_GROWTH_PLAN_HEURISTICS.trendVideoLimit).map((row) => row.views));
  const trendSlope = median(slopes);
  const dominantSource = dominantTrafficSource(input.channelTraffic);
  const warningCondition = mature.length >= plan.warnAtMatureVideos && (last10Median ?? Infinity) < YOUTUBE_GROWTH_PLAN_HEURISTICS.warningMedianViews && (trendSlope ?? Infinity) <= 0 && (maxViews ?? Infinity) < plan.viewTargets.first;
  const monthsSinceStart = plan.nicheStartDate ? (now.getTime() - Date.parse(`${plan.nicheStartDate}T00:00:00.000Z`)) / (86_400_000 * 365 / 12) : 0;
  const atDecision = mature.length >= plan.decideAtMatureVideos && monthsSinceStart >= plan.decideMinMonths;
  const optimisticBeyondTolerance = forecastResult.status === 'insufficient-data' || forecastResult.optimistic.week === null || forecastResult.optimistic.beyondTolerance;
  const lowFirstHitSignal = firstRate.hits < YOUTUBE_GROWTH_PLAN_HEURISTICS.stopMaximumFirstTargetHits || (firstRate.high ?? 1) < YOUTUBE_GROWTH_PLAN_HEURISTICS.stopLowUpperBound;
  const variablesTried = [...new Set(mostRecentExperimentVariables(plan, mature))];
  const change = selectChangeVariable({ mature, plan, retentionFraction: earlyRetentionDropFraction, ctrLow: ctr.isLow, dominantSource });
  const reasons: YoutubeGrowthPlanStatus['verdict']['reasons'] = [];
  let verdict: YoutubeGrowthPlanStatus['verdict']['verdict'] = 'continue';
  if (mature.length < YOUTUBE_GROWTH_PLAN_HEURISTICS.noHitSmallSampleLimit || !plan.nicheStartDate) {
    verdict = 'insufficient_data';
    if (!plan.nicheStartDate) reasons.push({ text: 'Đặt ngày bắt đầu ngách để xác định nhóm video và lịch mốc.' , metricIds: [] });
    if (mature.length < YOUTUBE_GROWTH_PLAN_HEURISTICS.noHitSmallSampleLimit) reasons.push({ text: `Cần ít nhất ${YOUTUBE_GROWTH_PLAN_HEURISTICS.noHitSmallSampleLimit} video trưởng thành; hiện có ${mature.length}.`, metricIds: ['mature_video_count'] });
  } else if (atDecision && optimisticBeyondTolerance && lowFirstHitSignal) {
    if (plan.experiments.length < plan.minExperimentsBeforeStop) {
      verdict = 'change_one_variable';
      reasons.push({ text: 'chưa thử đủ thay đổi trước khi dừng. Hãy ghi thêm một thử nghiệm có thể kiểm tra được.', metricIds: ['experiment_count'] });
      reasons.push({ text: `${change.variable}: ${change.note}`, metricIds: ['median_first28_last10', 'trend_slope_first28', 'first_hit_count'] });
    } else {
      verdict = 'consider_stop';
      const diagnosis = earlyRetentionDropFraction !== null || ctr.known > 0 ? 'Dữ liệu hiện có nghiêng về vấn đề ở cách làm; nó chưa chứng minh ngách không có nhu cầu.' : 'Chưa đủ tín hiệu để tách vấn đề ngách khỏi cách làm.';
      reasons.push({ text: `Cân nhắc dừng ngách theo tiêu chí đã đặt. Dự báo lạc quan chưa chạm mốc trong giới hạn, và số video đạt mốc đầu còn thấp. ${diagnosis}`, metricIds: ['forecast_optimistic_week', 'first_hit_count', 'first_hit_rate_high'] });
      if (variablesTried.length) reasons.push({ text: `Đã ghi các biến trong 5 video gần nhất: ${variablesTried.join(', ')}.`, metricIds: ['experiment_count'] });
    }
  } else if (warningCondition) {
    verdict = 'change_one_variable';
    reasons.push({ text: `Đổi một biến tiếp theo: ${change.variable}. ${change.note}`, metricIds: ['median_first28_last10', 'trend_slope_first28', 'max_first28'] });
  } else {
    reasons.push({ text: `Tiếp tục đến mốc ${nextCheckpoint ? checkpoints.find((checkpoint) => checkpoint.id === nextCheckpoint)?.label : 'rà soát tiếp theo'} rồi đánh giá lại bằng số liệu đã đặt.`, metricIds: ['mature_video_count', 'forecast_central_week'] });
  }
  const unknowns: string[] = [];
  if (ctr.unknownForMost) unknowns.push('CTR chưa biết cho đa số video: nhập tay từ YouTube Studio khi video có ít nhất 1.000 lượt hiển thị.');
  if (unknownMatureCount) unknowns.push(`${unknownMatureCount} video đã đủ tuổi nhưng chưa có lượt xem 28 ngày đo được.`);
  if (currentWatchHours === null) unknowns.push('Chưa đủ Analytics 365 ngày trên toàn bộ video công khai dài để tính giờ xem hiện tại.');
  if (subscribersPerThousandViews === null) unknowns.push('Chưa đo được tỷ lệ người đăng ký tăng trên mỗi 1.000 lượt xem đầu 28 ngày.');
  if (!input.channelTraffic?.last28d || input.channelTraffic.last28d.status !== 'ok') unknowns.push('Cơ cấu nguồn truy cập chưa có hoặc Analytics không cung cấp; đây chỉ là ngữ cảnh cho kết luận.');
  const confidence: YoutubeGrowthPlanStatus['verdict']['confidence'] = mature.length <= YOUTUBE_GROWTH_PLAN_HEURISTICS.confidenceLowMaximumMatureVideos || ctr.unknownForMost
    ? 'low'
    : mature.length >= YOUTUBE_GROWTH_PLAN_HEURISTICS.confidenceHighMinimumMatureVideos && forecastResult.status === 'ready'
      ? 'high'
      : 'medium';
  let forecastReviewText: string | undefined;
  const hardCheckpoint = checkpoints.find((checkpoint) => checkpoint.id === 'hard_review');
  if (hardCheckpoint?.estimatedDate && dateOnly(now) >= hardCheckpoint.estimatedDate) {
    forecastReviewText = forecastResult.status === 'ready'
      ? 'Đã qua mốc rà soát bắt buộc: xem lại cả ba kịch bản, giờ xem đang rời cửa sổ 365 ngày và các giả định trước khi giữ quyết định.'
      : 'Đã qua mốc rà soát bắt buộc: dự báo hiện chưa đủ dữ liệu; cập nhật Analytics và kiểm tra lại các giả định.';
    reasons.push({ text: forecastReviewText, metricIds: ['forecast_optimistic_week', 'forecast_central_week', 'forecast_pessimistic_week'] });
  }
  const assumptions = [
    'Tỷ lệ video đạt mốc giả định các video độc lập; video cùng ngách có thể tương quan.',
    `Dự báo giữ nhịp ${plan.cadencePerWeek} video dài mỗi tuần.`,
    forecastResult.status === 'ready' && forecastResult.tailFactorAssumed ? 'Hệ số đuôi dùng 1,0 vì có ít hơn 3 video đủ tuổi để đo.' : 'Hệ số đuôi lấy trung vị tỷ lệ lượt xem 365 ngày (hoặc trọn đời) / 28 ngày đầu của video đã hơn 90 ngày.',
    avgViewDurationAssumed ? `Thời lượng xem trung bình dùng giả định ${plan.assumedAvgViewDurationMin} phút.` : 'Thời lượng xem trung bình là thời lượng xem phút / lượt xem từ snapshot 28 ngày đầu.',
    subscribersPerThousandViews === null ? 'Dự báo chưa chạy vì chưa đo được tỷ lệ tăng người đăng ký.' : `Dự báo giữ tỷ lệ ${subscribersPerThousandViews.toFixed(2)} người đăng ký / 1.000 lượt xem.`,
    'Giờ xem nền hiện tại giảm đều trong 52 tuần; giờ xem tương lai được dàn đều trong năm đầu của mỗi video.',
    'Xu hướng dùng Theil–Sen trên tối đa 20 video có số liệu gần nhất; kịch bản lạc quan/xấu dùng phân vị 80%/20% của các độ dốc cặp.',
    'Dự báo từ ít video có sai số rất lớn.',
    'Giờ xem 365 ngày tính từ video dài công khai; Shorts, video riêng tư và không công khai không được tính.',
  ];
  if (approximateCount) assumptions.push(`Có ${approximateCount} số liệu dùng lượt xem trọn đời ở tuổi 31–45 ngày; mọi phép tính chứa các video đó là xấp xỉ.`);
  const targetHours = currentWatchHours;
  const stage = stageFor({ matureCount: mature.length, last10Median, strongHit: mature.some((row) => row.views >= plan.viewTargets.strong), subscriberCount: input.subscriberCount, watchHours: targetHours, currentTargetHours: hoursTarget });
  const metrics: YoutubeGrowthPlanStatus['metrics'] = {
    eligible_video_count: metric(eligible.length, 'videos', 'Video đủ điều kiện kế hoạch'),
    mature_video_count: metric(mature.length, 'videos', 'Video trưởng thành có lượt xem 28 ngày'),
    pending_video_count: metric(pending.length, 'videos', 'Video đang chờ đủ tuổi'),
    unknown_mature_video_count: metric(unknownMatureCount, 'videos', 'Video đủ tuổi nhưng chưa đo được'),
    first28_approximate_count: metric(approximateCount, 'videos', 'Số video dùng fallback xấp xỉ', approximateCount > 0),
    median_first28: metric(medianViews, 'views', 'Trung vị lượt xem 28 ngày đầu', approximateCount > 0),
    mean_first28: metric(meanViews, 'views', 'Trung bình lượt xem 28 ngày đầu', approximateCount > 0),
    max_first28: metric(maxViews, 'views', 'Cao nhất lượt xem 28 ngày đầu', approximateCount > 0),
    p25_first28: metric(p25, 'views', 'Phân vị 25 lượt xem 28 ngày đầu', approximateCount > 0),
    p75_first28: metric(p75, 'views', 'Phân vị 75 lượt xem 28 ngày đầu', approximateCount > 0),
    median_first28_last10: metric(last10Median, 'views', 'Trung vị 10 video gần nhất', approximateCount > 0),
    weighted_avg_view_duration_min: metric(avgViewDurationMin, 'minutes', 'Thời lượng xem trung bình có trọng số', avgViewDurationAssumed),
    subscribers_per_thousand_views: metric(subscribersPerThousandViews, 'subscribers/1000 views', 'Người đăng ký tăng trên 1.000 lượt xem', approximateCount > 0),
    early_retention_drop_fraction: metric(earlyRetentionDropFraction, 'fraction', 'Tỷ lệ video có rơi giữ chân sớm'),
    first_hit_count: metric(firstRate.hits, 'videos', `Video đạt ${plan.viewTargets.first} lượt xem`),
    first_hit_rate: metric(firstRate.rate, 'fraction', 'Tỷ lệ đạt mốc đầu', firstRate.approximate),
    first_hit_rate_low: metric(firstRate.low, 'fraction', 'Cận dưới Wilson 95% mốc đầu', firstRate.approximate),
    first_hit_rate_high: metric(firstRate.high, 'fraction', 'Cận trên Wilson 95% mốc đầu', firstRate.approximate),
    strong_hit_count: metric(strongRate.hits, 'videos', `Video đạt ${plan.viewTargets.strong} lượt xem`),
    strong_hit_rate: metric(strongRate.rate, 'fraction', 'Tỷ lệ đạt mốc mạnh', strongRate.approximate),
    strong_hit_rate_low: metric(strongRate.low, 'fraction', 'Cận dưới Wilson 95% mốc mạnh', strongRate.approximate),
    strong_hit_rate_high: metric(strongRate.high, 'fraction', 'Cận trên Wilson 95% mốc mạnh', strongRate.approximate),
    required_views_hours: metric(required.hoursViewsPerVideo, 'views/video', 'Lượt xem/video cần để đạt giờ xem', avgViewDurationAssumed),
    required_views_subscribers: metric(required.subscribersViewsPerVideo, 'views/video', 'Lượt xem/video cần để đạt người đăng ký'),
    required_views_binding: metric(required.bindingViewsPerVideo, 'views/video', 'Điều kiện ràng buộc lượt xem/video', avgViewDurationAssumed),
    gap_to_median_absolute: metric(gap(required.bindingViewsPerVideo, medianViews).absolute, 'views/video', 'Khoảng cách tuyệt đối so với trung vị', approximateCount > 0 || avgViewDurationAssumed),
    gap_to_median_ratio: metric(gap(required.bindingViewsPerVideo, medianViews).ratio, 'ratio', 'Tỷ số yêu cầu / trung vị', approximateCount > 0 || avgViewDurationAssumed),
    gap_to_p75_absolute: metric(gap(required.bindingViewsPerVideo, p75).absolute, 'views/video', 'Khoảng cách tuyệt đối so với phân vị 75', approximateCount > 0 || avgViewDurationAssumed),
    gap_to_p75_ratio: metric(gap(required.bindingViewsPerVideo, p75).ratio, 'ratio', 'Tỷ số yêu cầu / phân vị 75', approximateCount > 0 || avgViewDurationAssumed),
    planned_videos_per_year: metric(required.plannedVideosPerYear, 'videos/year', 'Video dự kiến mỗi năm'),
    early_retention_measured_count: metric(retentionRows.length, 'videos', 'Video có dữ liệu giữ chân'),
    ctr_known_video_count: metric(ctr.known, 'videos', 'Video CTR đủ 1.000 lượt hiển thị'),
    trend_slope_first28: metric(trendSlope, 'views/video', 'Độ dốc Theil–Sen lượt xem 28 ngày'),
    first_hit_rate_rule_of_three_upper: metric(firstRate.ruleOfThreeUpperBound, 'fraction', 'Cận trên quy tắc 3/n mốc đầu'),
    first_videos_until_hit_min: metric(firstRate.videosUntilHit?.min ?? null, 'videos', 'Số video tối thiểu ước lượng đến mốc đầu'),
    first_videos_until_hit_max: metric(firstRate.videosUntilHit?.max ?? null, 'videos', 'Số video tối đa ước lượng đến mốc đầu'),
    strong_hit_rate_rule_of_three_upper: metric(strongRate.ruleOfThreeUpperBound, 'fraction', 'Cận trên quy tắc 3/n mốc mạnh'),
    strong_videos_until_hit_min: metric(strongRate.videosUntilHit?.min ?? null, 'videos', 'Số video tối thiểu ước lượng đến mốc mạnh'),
    strong_videos_until_hit_max: metric(strongRate.videosUntilHit?.max ?? null, 'videos', 'Số video tối đa ước lượng đến mốc mạnh'),
    forecast_optimistic_slope: metric(forecastResult.status === 'ready' ? forecastResult.optimistic.slopeViewsPerVideo : null, 'views/video', 'Độ dốc lượt xem/video kịch bản lạc quan'),
    forecast_central_slope: metric(forecastResult.status === 'ready' ? forecastResult.central.slopeViewsPerVideo : null, 'views/video', 'Độ dốc lượt xem/video kịch bản trung tâm'),
    forecast_pessimistic_slope: metric(forecastResult.status === 'ready' ? forecastResult.pessimistic.slopeViewsPerVideo : null, 'views/video', 'Độ dốc lượt xem/video kịch bản thận trọng'),
    forecast_horizon_weeks: metric(forecastResult.status === 'ready' ? forecastResult.horizonWeeks : null, 'weeks', 'Thời hạn dự báo'),
    forecast_optimistic_week: metric(forecastResult.status === 'ready' ? forecastResult.optimistic.week : null, 'weeks', 'Tuần đạt đủ mốc, lạc quan'),
    forecast_central_week: metric(forecastResult.status === 'ready' ? forecastResult.central.week : null, 'weeks', 'Tuần đạt đủ mốc, trung tâm'),
    forecast_pessimistic_week: metric(forecastResult.status === 'ready' ? forecastResult.pessimistic.week : null, 'weeks', 'Tuần đạt đủ mốc, thận trọng'),
    forecast_tail_factor: metric(forecastResult.status === 'ready' ? forecastResult.tailFactor : null, 'ratio', 'Hệ số đuôi lượt xem', forecastResult.status === 'ready' && forecastResult.tailFactorAssumed),
    experiment_count: metric(plan.experiments.length, 'experiments', 'Số thử nghiệm đã ghi'),
    required_watch_hours_target: metric(hoursTarget, 'hours/365d', 'Mốc giờ xem tham khảo'),
    public_long_watch_hours_365d: metric(currentWatchHours, 'hours/365d', 'Giờ xem video dài công khai 365 ngày'),
    subscribers_current: metric(input.subscriberCount, 'subscribers', 'Người đăng ký hiện tại'),
    mature_target_warning: metric(plan.warnAtMatureVideos, 'videos', 'Điểm cảnh báo'),
    mature_target_decision: metric(plan.decideAtMatureVideos, 'videos', 'Điểm quyết định'),
    plan_cadence_per_week: metric(plan.cadencePerWeek, 'videos/week', 'Nhịp đăng kế hoạch'),
    plan_first_view_target: metric(plan.viewTargets.first, 'views', 'Mốc view đầu kế hoạch'),
    plan_strong_view_target: metric(plan.viewTargets.strong, 'views', 'Mốc view mạnh kế hoạch'),
    plan_tolerance_months: metric(plan.toleranceMonths, 'months', 'Giới hạn chờ kế hoạch'),
    plan_assumed_avg_view_duration_min: metric(plan.assumedAvgViewDurationMin, 'minutes', 'Thời lượng xem TB giả định', true),
    decision_min_months: metric(plan.decideMinMonths, 'months', 'Tháng tối thiểu trước điểm quyết định'),
    hard_review_week: metric(plan.hardReviewWeek, 'weeks', 'Tuần rà soát bắt buộc'),
    min_experiments_before_stop: metric(plan.minExperimentsBeforeStop, 'experiments', 'Số thử nghiệm tối thiểu trước khi dừng'),
    ypp_current_ads_subscribers: metric(YOUTUBE_PARTNER_PROGRAM_THRESHOLDS.current.ads.subscribers, 'subscribers', 'Mốc tham khảo người đăng ký hiện tại'),
    ypp_current_ads_watch_hours: metric(YOUTUBE_PARTNER_PROGRAM_THRESHOLDS.current.ads.longWatchHours, 'hours/365d', 'Mốc tham khảo giờ xem hiện tại'),
    ypp_current_ads_shorts_views: metric(YOUTUBE_PARTNER_PROGRAM_THRESHOLDS.current.ads.shortViews, 'views/90d', 'Mốc tham khảo Shorts hiện tại'),
    ypp_future_ads_subscribers: metric(YOUTUBE_PARTNER_PROGRAM_THRESHOLDS.from2027_02_01.ads.subscribers, 'subscribers', 'Mốc tham khảo người đăng ký từ 2027-02-01'),
    ypp_future_ads_watch_hours: metric(YOUTUBE_PARTNER_PROGRAM_THRESHOLDS.from2027_02_01.ads.longWatchHours, 'hours/365d', 'Mốc tham khảo giờ xem từ 2027-02-01'),
    ypp_future_ads_shorts_views: metric(YOUTUBE_PARTNER_PROGRAM_THRESHOLDS.from2027_02_01.ads.shortViews, 'views/90d', 'Mốc tham khảo Shorts từ 2027-02-01'),
    heuristic_warning_median_views: metric(YOUTUBE_GROWTH_PLAN_HEURISTICS.warningMedianViews, 'views', 'Ngưỡng heuristic view cảnh báo'),
    heuristic_low_ctr_percent: metric(YOUTUBE_GROWTH_PLAN_HEURISTICS.lowCtrHeuristicPercent, 'percent', 'Ngưỡng heuristic CTR thấp', true),
    heuristic_dominant_traffic_fraction: metric(YOUTUBE_GROWTH_PLAN_HEURISTICS.dominantTrafficSourceFraction, 'fraction', 'Ngưỡng heuristic nguồn truy cập chiếm ưu thế', true),
  };
  for (const video of planVideos) {
    metrics[video.metricId] = metric(video.first28dViews, 'views', `Lượt xem 28 ngày đầu · ${video.title}`, video.approximate);
  }
  const unknownsWithNoCtr = ctr.unknownForMost ? unknowns : unknowns.filter((unknown) => !unknown.startsWith('CTR chưa biết'));
  return YoutubeGrowthPlanStatusSchema.parse({
    plan,
    eligibleVideoCount: eligible.length,
    matureCount: mature.length,
    videos: planVideos,
    pending,
    distribution: {
      measuredCount: mature.length - approximateCount,
      approximateCount,
      unknownMatureCount,
      median: medianViews,
      mean: meanViews,
      max: maxViews,
      p25,
      p75,
      last10Median,
      weightedAvgViewDurationMin: avgViewDurationMin,
      avgViewDurationAssumed,
      subscribersPerThousandViews,
      earlyRetentionDropFraction,
      retentionMeasuredCount: retentionRows.length,
    },
    hitRates: { first: firstRate, strong: strongRate },
    requiredViews: {
      watchHoursTarget: hoursTarget,
      plannedVideosPerYear: required.plannedVideosPerYear,
      avgViewDurationMin,
      avgViewDurationAssumed,
      hoursViewsPerVideo: required.hoursViewsPerVideo,
      subscribersViewsPerVideo: required.subscribersViewsPerVideo,
      binding: required.binding,
      bindingViewsPerVideo: required.bindingViewsPerVideo,
      gapToMedian: gap(required.bindingViewsPerVideo, medianViews),
      gapToP75: gap(required.bindingViewsPerVideo, p75),
    },
    forecast: forecastResult,
    stage,
    checkpoints,
    verdict: { verdict, reasons, unknowns: unknownsWithNoCtr, confidence, nextCheckpoint, ...(forecastReviewText ? { forecastReviewText } : {}) },
    metrics,
    assumptions,
    thresholds: { ...YOUTUBE_PARTNER_PROGRAM_THRESHOLDS, qualifyingWatchHours: YOUTUBE_PARTNER_PROGRAM_THRESHOLDS.qualifyingWatchHours },
    submittedForReviewAt: plan.submittedForReviewAt,
  });
}
