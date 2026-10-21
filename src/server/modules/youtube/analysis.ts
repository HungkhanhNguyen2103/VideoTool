import type { YoutubeChannelDaily, YoutubeRetentionCurve, YoutubeVideoStats } from '../../../contracts/youtube';

export const YOUTUBE_SMALL_COHORT_SIZE = 5;
export const YOUTUBE_TREND_MINIMUM_VIEWS = 100;
export const EARLY_RETENTION_DROP_THRESHOLD = 0.3;
export const YOUTUBE_PARTNER_PROGRAM_THRESHOLDS = {
  checkedOn: '2026-10-21',
  sourceUrls: [
    'https://support.google.com/youtube/answer/72851',
    'https://support.google.com/youtube/answer/12843009',
  ],
  current: {
    entryTier: { subscribers: 500, longWatchHours: 3_000, shortViews: 3_000_000 },
    ads: { subscribers: 1_000, longWatchHours: 4_000, shortViews: 10_000_000 },
  },
  from2027_02_01: {
    entryTier: { subscribers: 500, longWatchHours: 3_000, shortViews: 3_000_000 },
    ads: { subscribers: 1_000, longWatchHours: 8_000, shortViews: 20_000_000 },
  },
} as const;

function metric(video: YoutubeVideoStats, window: string, key: string): number | null {
  const value = (video.analytics[window] as Record<string, number | null | undefined> | undefined)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getViewsPerDay(video: YoutubeVideoStats, now = new Date()): number | null {
  if (!video.publishedAt) return null;
  const age = Math.max(1, (now.getTime() - new Date(video.publishedAt).getTime()) / 86_400_000);
  const views = video.viewCount ?? metric(video, 'lifetime', 'views');
  return views === null ? null : views / age;
}

export function getVideoRanking(videos: readonly YoutubeVideoStats[], now = new Date(), window = '28d'): {
  viewsPerDay: { videoId: string; value: number }[];
  averageViewPercentage: { videoId: string; value: number }[];
  subscribersPerThousandViews: { videoId: string; value: number }[];
  clickThroughRate: { videoId: string; value: number }[];
} {
  const values = (getValue: (video: YoutubeVideoStats) => number | null) => videos.flatMap((video) => {
    const value = getValue(video);
    return value === null ? [] : [{ videoId: video.videoId, value }];
  }).sort((a, b) => b.value - a.value);
  return {
    viewsPerDay: values((video) => getViewsPerDay(video, now)),
    averageViewPercentage: values((video) => metric(video, window, 'averageViewPercentage') ?? metric(video, 'lifetime', 'averageViewPercentage')),
    subscribersPerThousandViews: values((video) => {
      const views = metric(video, window, 'views');
      const gained = metric(video, window, 'subscribersGained');
      return views && gained !== null ? gained * 1_000 / views : null;
    }),
    clickThroughRate: values((video) => metric(video, window, 'impressionsClickThroughRate')),
  };
}

export type YoutubeVideoChannelComparison = {
  videoViewsPerDay: number | null;
  medianViewsPerDay: number | null;
  viewsSampleSize: number;
  videoAverageViewPercentage: number | null;
  medianAverageViewPercentage: number | null;
  averageViewSampleSize: number;
};

export function compareVideoToChannelMedian(video: YoutubeVideoStats, channelVideos: readonly YoutubeVideoStats[], now = new Date(), window = '28d'): YoutubeVideoChannelComparison {
  const views = channelVideos.flatMap((row) => {
    const value = getViewsPerDay(row, now);
    return value === null ? [] : [value];
  });
  const averageViewPercentages = channelVideos.flatMap((row) => {
    const value = metric(row, window, 'averageViewPercentage') ?? metric(row, 'lifetime', 'averageViewPercentage');
    return value === null ? [] : [value];
  });
  return {
    videoViewsPerDay: getViewsPerDay(video, now),
    medianViewsPerDay: median(views),
    viewsSampleSize: views.length,
    videoAverageViewPercentage: metric(video, window, 'averageViewPercentage') ?? metric(video, 'lifetime', 'averageViewPercentage'),
    medianAverageViewPercentage: median(averageViewPercentages),
    averageViewSampleSize: averageViewPercentages.length,
  };
}

export type RetentionDropSegment = { startSec: number; endSec: number; dropRatio: number; dropPercent: number };

export function getRetentionDropSegments(curve: YoutubeRetentionCurve, durationSec: number): { earlyDrop: boolean; segments: RetentionDropSegment[] } {
  const points = [...curve].sort((a, b) => a.ratio - b.ratio);
  const segments: RetentionDropSegment[] = [];
  let earlyDrop = false;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const dropRatio = previous.watchRatio > 0 ? Math.max(0, (previous.watchRatio - current.watchRatio) / previous.watchRatio) : 0;
    if (current.ratio * durationSec <= 30 && dropRatio > EARLY_RETENTION_DROP_THRESHOLD) earlyDrop = true;
    segments.push({
      startSec: previous.ratio * durationSec,
      endSec: current.ratio * durationSec,
      dropRatio,
      dropPercent: dropRatio * 100,
    });
  }
  return { earlyDrop, segments: segments.sort((a, b) => b.dropRatio - a.dropRatio || a.startSec - b.startSec).slice(0, 3) };
}

export type CohortProject = { scriptPresetId: string; visualStylePresetId: string };
export type CohortInput = { video: YoutubeVideoStats; project: CohortProject | null };
export type YoutubeVideoCohort = {
  key: string;
  dimension: string;
  label: string;
  n: number;
  medianViewsPerDay: number | null;
  medianAverageViewPercentage: number | null;
  sampleWarning?: 'mẫu nhỏ — chưa kết luận';
};

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function durationBucket(duration: number): [string, string] {
  if (duration < 8 * 60) return ['<8', 'Dưới 8 phút'];
  if (duration <= 12 * 60) return ['8-12', '8–12 phút'];
  if (duration <= 20 * 60) return ['12-20', '12–20 phút'];
  return ['>20', 'Trên 20 phút'];
}

function titleLengthBucket(title: string): string {
  const length = [...title].length;
  return length < 50 ? '<50' : length <= 70 ? '50-70' : '>70';
}

function publishBuckets(publishedAt: string | null, timezone: string): [string, string][] {
  if (!publishedAt) return [];
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(publishedAt));
    const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Unknown';
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
    const start = Math.floor(hour / 6) * 6;
    const label = `${weekday}, ${String(start).padStart(2, '0')}:00–${String(start + 5).padStart(2, '0')}:59`;
    return [[`publish:${weekday}:${String(start).padStart(2, '0')}`, label]];
  } catch {
    return [];
  }
}

export function buildVideoCohorts(rows: readonly CohortInput[], timezone = 'Asia/Ho_Chi_Minh', now = new Date()): YoutubeVideoCohort[] {
  const grouped = new Map<string, { dimension: string; label: string; rows: CohortInput[] }>();
  const add = (row: CohortInput, key: string, dimension: string, label: string) => {
    const group = grouped.get(key) ?? { dimension, label, rows: [] };
    group.rows.push(row);
    grouped.set(key, group);
  };
  for (const row of rows) {
    const [durationKey, durationLabel] = durationBucket(row.video.durationSec);
    add(row, `duration:${durationKey}`, 'Thời lượng', durationLabel);
    const title = row.video.title;
    const lengthKey = titleLengthBucket(title);
    const lengthLabel = lengthKey === '<50' ? 'Tiêu đề dưới 50 ký tự' : lengthKey === '50-70' ? 'Tiêu đề 50–70 ký tự' : 'Tiêu đề trên 70 ký tự';
    add(row, `title:length:${lengthKey}`, 'Độ dài tiêu đề', lengthLabel);
    if (/\p{N}/u.test(title)) add(row, 'title:number', 'Đặc điểm tiêu đề', 'Có chữ số');
    if (/\?/u.test(title)) add(row, 'title:question', 'Đặc điểm tiêu đề', 'Có câu hỏi');
    if (/[()[\]（）「」『』]/u.test(title)) add(row, 'title:parentheses', 'Đặc điểm tiêu đề', 'Có ngoặc');
    for (const [key, label] of publishBuckets(row.video.publishedAt, timezone)) add(row, key, 'Khung giờ đăng', label);
    if (row.project) {
      add(row, `preset:${row.project.scriptPresetId}`, 'Preset kịch bản', row.project.scriptPresetId);
      add(row, `style:${row.project.visualStylePresetId}`, 'Phong cách hình ảnh', row.project.visualStylePresetId);
    }
  }
  return [...grouped.entries()].map(([key, group]) => {
    const viewsPerDay = group.rows.flatMap((row) => {
      const value = getViewsPerDay(row.video, now);
      return value === null ? [] : [value];
    });
    const avp = group.rows.flatMap(({ video }) => {
      const value = metric(video, '28d', 'averageViewPercentage') ?? metric(video, 'lifetime', 'averageViewPercentage');
      return value === null ? [] : [value];
    });
    return {
      key,
      dimension: group.dimension,
      label: group.label,
      n: group.rows.length,
      medianViewsPerDay: median(viewsPerDay),
      medianAverageViewPercentage: median(avp),
      ...(group.rows.length < YOUTUBE_SMALL_COHORT_SIZE ? { sampleWarning: 'mẫu nhỏ — chưa kết luận' as const } : {}),
    };
  }).sort((a, b) => a.dimension.localeCompare(b.dimension) || a.label.localeCompare(b.label));
}

export type TrendMetric = { current: number; previous: number; changePercent: number | null };
export type YoutubeChannelTrend = { views: TrendMetric; watchMinutes: TrendMetric; subscribers: TrendMetric; tooFewData: boolean };

function percentChange(current: number, previous: number): number | null {
  return previous === 0 ? null : (current - previous) / previous * 100;
}

export function buildChannelTrend(daily: readonly YoutubeChannelDaily[], now = new Date()): YoutubeChannelTrend {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startCurrent = today - 28 * 86_400_000;
  const startPrevious = today - 56 * 86_400_000;
  const current = daily.filter((row) => Date.parse(`${row.date}T00:00:00.000Z`) >= startCurrent && Date.parse(`${row.date}T00:00:00.000Z`) < today);
  const previous = daily.filter((row) => Date.parse(`${row.date}T00:00:00.000Z`) >= startPrevious && Date.parse(`${row.date}T00:00:00.000Z`) < startCurrent);
  const sum = (rows: readonly YoutubeChannelDaily[], select: (row: YoutubeChannelDaily) => number) => rows.reduce((total, row) => total + select(row), 0);
  const currentViews = sum(current, (row) => row.views);
  const previousViews = sum(previous, (row) => row.views);
  const currentWatch = sum(current, (row) => row.estimatedMinutesWatched);
  const previousWatch = sum(previous, (row) => row.estimatedMinutesWatched);
  const currentSubs = sum(current, (row) => row.subscribersGained - row.subscribersLost);
  const previousSubs = sum(previous, (row) => row.subscribersGained - row.subscribersLost);
  return {
    views: { current: currentViews, previous: previousViews, changePercent: percentChange(currentViews, previousViews) },
    watchMinutes: { current: currentWatch, previous: previousWatch, changePercent: percentChange(currentWatch, previousWatch) },
    subscribers: { current: currentSubs, previous: previousSubs, changePercent: percentChange(currentSubs, previousSubs) },
    tooFewData: currentViews < YOUTUBE_TREND_MINIMUM_VIEWS || previousViews < YOUTUBE_TREND_MINIMUM_VIEWS,
  };
}

type PartnerTierThreshold = { subscribers: number; longWatchHours: number; shortViews: number };
type PartnerProgramThresholds = { entryTier: PartnerTierThreshold; ads: PartnerTierThreshold };
type PartnerTierProgress = PartnerTierThreshold & { publicLongWatchHours: number | null; publicShortViews: number | null; subscribersProgress: number | null; watchHoursProgress: number | null; shortViewsProgress: number | null; eligible: boolean };
export type YoutubeChannelHealth = {
  subscribers: number | null;
  publicLongWatchHours365d: number | null;
  publicShortViews90d: number | null;
  publicUploads90d: number | null;
  current: { entryTier: PartnerTierProgress; ads: PartnerTierProgress };
  from2027_02_01: { entryTier: PartnerTierProgress; ads: PartnerTierProgress };
  note: 'mốc tham khảo, kiểm tra lại trên YouTube Studio';
};

function progress(actual: number | null, required: number): number | null {
  if (actual === null) return null;
  return Math.max(0, Math.min(1, actual / required));
}

function tierProgress(threshold: PartnerTierThreshold, subscribers: number | null, hours: number | null, shortViews: number | null): PartnerTierProgress {
  return {
    ...threshold,
    publicLongWatchHours: hours,
    publicShortViews: shortViews,
    subscribersProgress: progress(subscribers, threshold.subscribers),
    watchHoursProgress: progress(hours, threshold.longWatchHours),
    shortViewsProgress: progress(shortViews, threshold.shortViews),
    eligible: subscribers !== null && subscribers >= threshold.subscribers && ((hours !== null && hours >= threshold.longWatchHours) || (shortViews !== null && shortViews >= threshold.shortViews)),
  };
}

export function buildChannelHealth(input: { subscriberCount: number | null; videos: readonly YoutubeVideoStats[]; dataSynced?: boolean; now?: Date }): YoutubeChannelHealth {
  const now = input.now ?? new Date();
  const since90d = now.getTime() - 90 * 86_400_000;
  const publicVideos = input.videos.filter((video) => video.privacy === 'public' && video.publishedAt);
  const dataSynced = input.dataSynced ?? true;
  const longVideos = publicVideos.filter((video) => !video.isShort);
  const recentShorts = publicVideos.filter((video) => video.isShort && new Date(video.publishedAt!).getTime() >= since90d);
  const longMetrics = longVideos.map((video) => metric(video, '365d', 'estimatedMinutesWatched'));
  const shortMetrics = recentShorts.map((video) => metric(video, '90d', 'views'));
  const longHours = !dataSynced ? null : longVideos.length === 0 ? 0 : longMetrics.some((value) => value === null) ? null : longMetrics.reduce<number>((sum, value) => sum + value!, 0) / 60;
  const shortsViews = !dataSynced ? null : recentShorts.length === 0 ? 0 : shortMetrics.some((value) => value === null) ? null : shortMetrics.reduce<number>((sum, value) => sum + value!, 0);
  const uploads = dataSynced ? publicVideos.filter((video) => new Date(video.publishedAt!).getTime() >= since90d).length : null;
  const progressFor = (thresholds: PartnerProgramThresholds) => ({
    entryTier: tierProgress(thresholds.entryTier, input.subscriberCount, longHours, shortsViews),
    ads: tierProgress(thresholds.ads, input.subscriberCount, longHours, shortsViews),
  });
  return {
    subscribers: input.subscriberCount,
    publicLongWatchHours365d: longHours,
    publicShortViews90d: shortsViews,
    publicUploads90d: uploads,
    current: progressFor(YOUTUBE_PARTNER_PROGRAM_THRESHOLDS.current),
    from2027_02_01: progressFor(YOUTUBE_PARTNER_PROGRAM_THRESHOLDS.from2027_02_01),
    note: 'mốc tham khảo, kiểm tra lại trên YouTube Studio',
  };
}
