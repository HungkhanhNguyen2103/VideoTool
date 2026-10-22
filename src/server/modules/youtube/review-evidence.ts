import { createHash } from 'node:crypto';
import { MIN_IMPRESSIONS_FOR_CTR, type YoutubeGrowthPlanStatus } from '../../../contracts/youtube-plan';
import type { YoutubeRetentionCurve, YoutubeSearchTerms, YoutubeSearchTermsBreakdown, YoutubeVideoStats } from '../../../contracts/youtube';
import { compareVideoToChannelMedian, getRetentionDropSegments } from './analysis';

export const YOUTUBE_REVIEW_MAX_PACKET_CHARS = 60_000;
export const YOUTUBE_REVIEW_CHANNEL_VIDEO_LIMIT = 20;
export const YOUTUBE_REVIEW_TEXT_MAX_CHARS = 400;
export const YOUTUBE_REVIEW_VISUAL_HEADLINE_MAX_CHARS = 160;
export const YOUTUBE_REVIEW_SCENE_APPROXIMATE_MISMATCH = 0.05;
export const YOUTUBE_REVIEW_SCENE_NONE_MISMATCH = 0.20;

export type ReviewMetric = { value: number; unit: string; label: string; assumed?: boolean };
export type ReviewMetricMap = Record<string, ReviewMetric>;
export type ReviewScene = { id?: string; narration: string; visualPrompt?: string; durationSec: number; active?: boolean };
export type ReviewProject = {
  id: string;
  title: string;
  updatedAt?: string;
  seo?: { titles?: { id: string; text: string }[]; chosenTitleId?: string | null; descriptionIntro?: string; descriptionKeywords?: string; tags?: string[] };
  scenes: ReviewScene[];
};
export type ReviewRetentionDrop = { startSec: number; endSec: number; dropPercent: number };
export type MappedRetentionDrop = {
  fromSec: number;
  toSec: number;
  dropPercent: number;
  sceneIndexes: number[];
  sceneNarrationExcerpt: string;
  mappingQuality: 'exact' | 'approximate' | 'none';
};

function metric(value: unknown, unit: string, label: string, assumed?: boolean): ReviewMetric | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return { value, unit, label, ...(assumed ? { assumed: true } : {}) };
}

export function sanitizeReviewText(value: string, maxLength = YOUTUBE_REVIEW_TEXT_MAX_CHARS): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, Math.max(0, maxLength));
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeBreakdown(breakdown: YoutubeSearchTermsBreakdown | null | undefined, prefix: string, metricMap: ReviewMetricMap) {
  const terms = (breakdown?.terms ?? []).slice(0, 25).map((row, index) => {
    const rank = index + 1;
    const viewsId = `${prefix}:${rank}:views`;
    const minutesId = `${prefix}:${rank}:minutes`;
    const shareId = `${prefix}:${rank}:share`;
    const totalViews = (breakdown?.terms ?? []).reduce((sum, term) => sum + (term.views ?? 0), 0);
    const views = metric(row.views, 'views', `Lượt xem từ từ khóa ${rank}`);
    const minutes = metric(row.estimatedMinutesWatched, 'minutes', `Phút xem từ từ khóa ${rank}`);
    if (views) metricMap[viewsId] = views;
    if (minutes) metricMap[minutesId] = minutes;
    if (row.views !== null && totalViews > 0) metricMap[shareId] = { value: row.views / totalViews, unit: 'fraction', label: `Tỷ trọng từ khóa ${rank}` };
    return {
      rank,
      term: sanitizeReviewText(row.term, 200),
      views: row.views,
      estimatedMinutesWatched: row.estimatedMinutesWatched,
      metricIds: [viewsId, minutesId, ...(metricMap[shareId] ? [shareId] : [])],
    };
  });
  return { status: breakdown?.status ?? 'unavailable', capturedAt: breakdown?.capturedAt ?? null, terms };
}

function planMetrics(status: YoutubeGrowthPlanStatus): ReviewMetricMap {
  return Object.fromEntries(Object.entries(status.metrics).flatMap(([id, item]) => {
    if (item.value === null) return [];
    return [[id, { value: item.value, unit: item.unit, label: sanitizeReviewText(item.label, 200), ...(item.assumed ? { assumed: true } : {}) }]];
  }));
}

function addVideoMetrics(video: YoutubeVideoStats, first28Views: number | null, approximate: boolean, metricMap: ReviewMetricMap): Record<string, unknown> {
  const prefix = `v:${video.videoId}`;
  const add = (key: string, value: unknown, unit: string, label: string, assumed = false) => {
    const found = metric(value, unit, label, assumed);
    if (found) metricMap[`${prefix}:${key}`] = found;
  };
  add('first28_views', first28Views, 'views', 'Lượt xem 28 ngày đầu', approximate);
  const snapshot = video.first28d;
  add('first28_minutes', snapshot?.estimatedMinutesWatched, 'minutes', 'Phút xem 28 ngày đầu');
  add('first28_avd_sec', snapshot?.averageViewDurationSec, 'seconds', 'Thời lượng xem trung bình 28 ngày đầu');
  add('first28_avg_view_percent', snapshot?.averageViewPercentage, 'percent', 'Tỷ lệ xem trung bình 28 ngày đầu');
  add('first28_subscribers', snapshot?.subscribersGained, 'subscribers', 'Người đăng ký tăng trong 28 ngày đầu');
  add('duration_sec', video.durationSec, 'seconds', 'Thời lượng video');
  const subscribersPerThousand = first28Views && snapshot?.subscribersGained !== null && snapshot?.subscribersGained !== undefined
    ? snapshot.subscribersGained * 1_000 / first28Views
    : null;
  add('subs_per_1000_views', subscribersPerThousand, 'subscribers/1000 views', 'Người đăng ký tăng trên 1.000 lượt xem 28 ngày đầu', approximate);
  const impressions = video.manualReach?.impressions;
  const ctr = impressions !== undefined && impressions >= MIN_IMPRESSIONS_FOR_CTR ? video.manualReach?.ctrPercent : null;
  add('manual_impressions', impressions !== undefined && impressions >= MIN_IMPRESSIONS_FOR_CTR ? impressions : null, 'impressions', 'Lượt hiển thị nhập từ Studio');
  add('manual_ctr_percent', ctr, 'percent', 'CTR nhập từ Studio');

  const traffic = (['last28d', 'lifetime'] as const).map((window) => {
    const breakdown = video.trafficSources[window];
    const totalViews = (breakdown?.sources ?? []).reduce((sum, source) => sum + (source.views ?? 0), 0);
    const sources = (breakdown?.sources ?? []).map((source) => {
      const token = source.sourceType.toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '_');
      const id = `${prefix}:traffic:${window}:${token}:share`;
      if (source.views !== null && totalViews > 0) metricMap[id] = { value: source.views / totalViews, unit: 'fraction', label: `Tỷ trọng nguồn ${source.sourceType} · ${window}` };
      return { sourceType: source.sourceType, views: source.views, estimatedMinutesWatched: source.estimatedMinutesWatched, share: source.views !== null && totalViews > 0 ? source.views / totalViews : null, metricId: id };
    });
    return { window, status: breakdown?.status ?? 'unavailable', capturedAt: breakdown?.capturedAt ?? null, sources };
  });

  const searchTerms = (['last28d', 'lifetime'] as const).map((window) => ({
    window,
    ...safeBreakdown(video.searchTerms[window], `${prefix}:search:${window}`, metricMap),
  }));
  return {
    videoId: video.videoId,
    title: sanitizeReviewText(video.title, 200),
    publishedAt: video.publishedAt,
    durationSec: video.durationSec,
    first28d: {
      views: first28Views,
      minutes: snapshot?.estimatedMinutesWatched ?? null,
      averageViewDurationSec: snapshot?.averageViewDurationSec ?? null,
      averageViewPercent: snapshot?.averageViewPercentage ?? null,
      subscribersGained: snapshot?.subscribersGained ?? null,
      approximate,
      metricIds: [`${prefix}:first28_views`, `${prefix}:first28_minutes`, `${prefix}:first28_avd_sec`, `${prefix}:first28_avg_view_percent`, `${prefix}:first28_subscribers`, `${prefix}:subs_per_1000_views`],
    },
    manualReach: { impressions: impressions !== undefined && impressions >= MIN_IMPRESSIONS_FOR_CTR ? impressions : null, ctrPercent: ctr ?? null, known: ctr !== null, metricIds: [`${prefix}:manual_impressions`, `${prefix}:manual_ctr_percent`] },
    trafficSources: traffic,
    searchTerms,
  };
}

function channelBase(status: YoutubeGrowthPlanStatus, metricMap: ReviewMetricMap, syncedAt: string | null, channelSearchTerms: YoutubeSearchTerms | undefined) {
  const searchTerms = (['last28d', 'lifetime'] as const).map((window) => ({
    window,
    ...safeBreakdown(channelSearchTerms?.[window], `search:${window}`, metricMap),
  }));
  const unknowns = [...status.verdict.unknowns];
  const ctrUnknownCount = Math.max(0, status.matureCount - (status.metrics.ctr_known_video_count?.value ?? 0));
  if (ctrUnknownCount > 0) unknowns.push(`CTR chưa đủ ${MIN_IMPRESSIONS_FOR_CTR} lượt hiển thị ở ${ctrUnknownCount} video trưởng thành.`);
  if (status.forecast.status === 'ready' && status.forecast.tailFactorAssumed) unknowns.push('Hệ số đuôi dự báo đang dùng giả định 1,0.');
  if (searchTerms.some((row) => row.status !== 'ok')) unknowns.push('Từ khóa tìm kiếm chưa được đồng bộ hoặc Analytics không cung cấp báo cáo.');
  return {
    target: 'channel' as const,
    stage: status.stage,
    verdict: status.verdict,
    plan: {
      nicheStartDate: status.plan.nicheStartDate,
      cadencePerWeek: status.plan.cadencePerWeek,
      viewTargets: status.plan.viewTargets,
      assumedAvgViewDurationMin: status.plan.assumedAvgViewDurationMin,
      toleranceMonths: status.plan.toleranceMonths,
      warnAtMatureVideos: status.plan.warnAtMatureVideos,
      decideAtMatureVideos: status.plan.decideAtMatureVideos,
      decideMinMonths: status.plan.decideMinMonths,
      hardReviewWeek: status.plan.hardReviewWeek,
      minExperimentsBeforeStop: status.plan.minExperimentsBeforeStop,
      submittedForReviewAt: status.plan.submittedForReviewAt,
      updatedAt: status.plan.updatedAt,
    },
    experiments: status.plan.experiments.map((experiment) => ({ ...experiment, note: sanitizeReviewText(experiment.note, 300) })),
    thresholds: status.thresholds,
    matureCount: status.matureCount,
    unknowns,
    assumptions: status.assumptions.map((assumption) => sanitizeReviewText(assumption, 300)),
    metrics: metricMap,
    searchTerms,
    syncedAt,
  };
}

function videoMetricRows(status: YoutubeGrowthPlanStatus) {
  return new Map(status.videos.map((video) => [video.videoId, video]));
}

function packetWithSizeLimit<T extends { videos: Record<string, unknown>[]; truncated: boolean; truncatedVideoCount: number }>(packet: T, metricMap: ReviewMetricMap, maxPacketChars: number): { packet: T; metricMap: ReviewMetricMap; serialized: string } {
  const working = structuredClone(packet);
  const map = { ...metricMap };
  (working as T & { metrics: ReviewMetricMap }).metrics = map;
  const serialize = () => JSON.stringify({ ...working, metrics: map });
  let serialized = serialize();
  while (serialized.length > maxPacketChars && working.videos.length > 0) {
    const dropped = working.videos.pop();
    if (dropped && typeof dropped.videoId === 'string') {
      const prefix = `v:${dropped.videoId}:`;
      for (const id of Object.keys(map)) if (id.startsWith(prefix)) delete map[id];
      working.truncatedVideoCount += 1;
      working.truncated = true;
      const id = (dropped as { metricIds?: string[] }).metricIds ?? [];
      for (const metricId of id) delete map[metricId];
      (working as T & { metrics: ReviewMetricMap }).metrics = map;
    }
    serialized = serialize();
  }
  return { packet: working, metricMap: map, serialized };
}

export function mapRetentionDropsToScenes(drops: readonly ReviewRetentionDrop[], scenes: readonly ReviewScene[], videoDurationSec: number): { mappingQuality: 'exact' | 'approximate' | 'none'; sceneDurationSec: number; drops: MappedRetentionDrop[] } {
  const renderedScenes = scenes.flatMap((scene, sourceIndex) => scene.active === false ? [] : [{ scene, sourceIndex }]);
  const sceneDurationSec = renderedScenes.reduce((sum, row) => sum + row.scene.durationSec, 0);
  const mismatch = videoDurationSec > 0 ? Math.abs(sceneDurationSec - videoDurationSec) / videoDurationSec : Number.POSITIVE_INFINITY;
  const mappingQuality = renderedScenes.length === 0 || mismatch > YOUTUBE_REVIEW_SCENE_NONE_MISMATCH
    ? 'none'
    : mismatch > YOUTUBE_REVIEW_SCENE_APPROXIMATE_MISMATCH ? 'approximate' : 'exact';
  const timeline: { index: number; startSec: number; endSec: number; scene: ReviewScene }[] = [];
  let startSec = 0;
  for (const { scene, sourceIndex } of renderedScenes) {
    const endSec = startSec + scene.durationSec;
    timeline.push({ index: sourceIndex + 1, startSec, endSec, scene });
    startSec = endSec;
  }
  const mapped: MappedRetentionDrop[] = drops.map((drop) => {
    if (mappingQuality === 'none') return { fromSec: drop.startSec, toSec: drop.endSec, dropPercent: drop.dropPercent, sceneIndexes: [], sceneNarrationExcerpt: '', mappingQuality };
    const touched = timeline.filter((row) => drop.endSec > row.startSec && drop.startSec < row.endSec);
    return {
      fromSec: drop.startSec,
      toSec: drop.endSec,
      dropPercent: drop.dropPercent,
      sceneIndexes: touched.map((row) => row.index),
      sceneNarrationExcerpt: sanitizeReviewText(touched.map((row) => `Cảnh ${row.index}: ${row.scene.narration}`).join(' '), YOUTUBE_REVIEW_TEXT_MAX_CHARS),
      mappingQuality,
    };
  });
  return { mappingQuality, sceneDurationSec, drops: mapped };
}

export function buildChannelEvidence(input: {
  planStatus: YoutubeGrowthPlanStatus;
  videos: readonly YoutubeVideoStats[];
  channelSearchTerms?: YoutubeSearchTerms;
  retentionByVideoId?: Record<string, { curve: YoutubeRetentionCurve; fetchedAt: string }>;
  syncedAt?: string | null;
  maxPacketChars?: number;
}): { packet: Record<string, unknown>; metricMap: ReviewMetricMap; fingerprint: string; serialized: string; packetSummary: { matureCount: number; includedVideoCount: number; truncatedVideoCount: number } } {
  const metricMap = planMetrics(input.planStatus);
  for (const row of input.planStatus.videos) delete metricMap[row.metricId];
  const base = channelBase(input.planStatus, metricMap, input.syncedAt ?? null, input.channelSearchTerms);
  const videoById = new Map(input.videos.map((video) => [video.videoId, video]));
  const planRows = [...input.planStatus.videos].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.videoId.localeCompare(a.videoId));
  const selected = planRows.slice(0, YOUTUBE_REVIEW_CHANNEL_VIDEO_LIMIT);
  const videoPackets = selected.flatMap((planVideo) => {
    const video = videoById.get(planVideo.videoId);
    if (!video) return [];
    const planMetric = metric(planVideo.first28dViews, 'views', `Lượt xem 28 ngày đầu · ${sanitizeReviewText(planVideo.title, 100)}`, planVideo.approximate);
    if (planMetric) metricMap[planVideo.metricId] = planMetric;
    const packet = addVideoMetrics(video, planVideo.first28dViews, planVideo.approximate, metricMap);
    const retention = input.retentionByVideoId?.[video.videoId];
    const drops = retention ? getRetentionDropSegments(retention.curve, video.durationSec) : null;
    const early = drops?.earlyDrop;
    const earlyId = `v:${video.videoId}:early_retention_drop`;
    if (early !== undefined) metricMap[earlyId] = { value: early ? 1 : 0, unit: 'boolean', label: 'Có rơi giữ chân sớm trong 30 giây đầu' };
    return [{ ...packet, planMetricId: planVideo.metricId, earlyRetentionDrop: early ?? null, earlyRetentionDropMetricId: earlyId, retentionFetchedAt: retention?.fetchedAt ?? null, metricIds: [planVideo.metricId] }];
  });
  const fingerprintInput = {
    plan: input.planStatus.plan,
    planMetrics: input.planStatus.metrics,
    planVideos: input.planStatus.videos,
    verdict: input.planStatus.verdict,
    stage: input.planStatus.stage,
    matureCount: input.planStatus.matureCount,
    syncedAt: input.syncedAt ?? null,
    channelSearchTerms: input.channelSearchTerms ?? null,
    videos: input.videos.map((video) => ({ videoId: video.videoId, title: video.title, publishedAt: video.publishedAt, durationSec: video.durationSec, viewCount: video.viewCount, analytics: video.analytics, fetchedAt: video.fetchedAt, first28d: video.first28d, manualReach: video.manualReach, trafficSources: video.trafficSources, searchTerms: video.searchTerms })),
    retentionByVideoId: input.retentionByVideoId ?? {},
  };
  const candidate = { ...base, videos: videoPackets, truncated: false, truncatedVideoCount: 0 };
  const limited = packetWithSizeLimit(candidate, metricMap, input.maxPacketChars ?? YOUTUBE_REVIEW_MAX_PACKET_CHARS);
  return {
    ...limited,
    fingerprint: stableHash(fingerprintInput),
    packetSummary: { matureCount: input.planStatus.matureCount, includedVideoCount: limited.packet.videos.length, truncatedVideoCount: limited.packet.truncatedVideoCount },
  };
}

export function buildVideoEvidence(input: {
  planStatus: YoutubeGrowthPlanStatus;
  video: YoutubeVideoStats;
  videos: readonly YoutubeVideoStats[];
  retentionCurve: YoutubeRetentionCurve | null;
  retentionFetchedAt?: string | null;
  project?: ReviewProject | null;
  syncedAt?: string | null;
  channelSearchTerms?: YoutubeSearchTerms;
}): { packet: Record<string, unknown>; metricMap: ReviewMetricMap; fingerprint: string; serialized: string; packetSummary: { matureCount: number; includedVideoCount: number; truncatedVideoCount: number } } {
  const metricMap = planMetrics(input.planStatus);
  const planVideo = videoMetricRows(input.planStatus).get(input.video.videoId);
  for (const row of input.planStatus.videos) delete metricMap[row.metricId];
  const first28Views = planVideo?.first28dViews ?? input.video.first28d?.views ?? null;
  const approximate = planVideo?.approximate ?? false;
  const stableVideoMetric = planVideo ? metric(first28Views, 'views', `Lượt xem 28 ngày đầu · ${sanitizeReviewText(planVideo.title, 100)}`, approximate) : null;
  if (planVideo && stableVideoMetric) metricMap[planVideo.metricId] = stableVideoMetric;
  const videoPacket = addVideoMetrics(input.video, first28Views, approximate, metricMap);
  const comparison = compareVideoToChannelMedian(input.video, input.videos);
  const planRows = input.planStatus.videos;
  const last10 = [...planRows].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.videoId.localeCompare(a.videoId)).slice(0, 10).flatMap((row) => row.first28dViews === null ? [] : [row.first28dViews]);
  const thisVideoViews = planVideo?.first28dViews ?? input.video.first28d?.views ?? null;
  const first28Last10Median = median(last10);
  const first28Percentile = thisVideoViews === null || last10.length === 0 ? null : last10.filter((value) => value <= thisVideoViews).length / last10.length * 100;
  const comparisonMetrics: Record<string, unknown> = {};
  const addComparison = (id: string, value: number | null, unit: string, label: string) => {
    if (value === null) return;
    metricMap[id] = { value, unit, label };
    comparisonMetrics[id] = metricMap[id];
  };
  addComparison(`v:${input.video.videoId}:channel_median_views_per_day`, comparison.medianViewsPerDay, 'views/day', 'Trung vị lượt xem/ngày của kênh');
  addComparison(`v:${input.video.videoId}:views_per_day`, comparison.videoViewsPerDay, 'views/day', 'Lượt xem/ngày của video');
  addComparison(`v:${input.video.videoId}:channel_median_view_percent`, comparison.medianAverageViewPercentage, 'percent', 'Trung vị tỷ lệ xem của kênh');
  addComparison(`v:${input.video.videoId}:first28_last10_median`, first28Last10Median, 'views', 'Trung vị 28 ngày đầu của 10 video trưởng thành gần nhất');
  addComparison(`v:${input.video.videoId}:first28_percentile`, first28Percentile, 'percentile', 'Phân vị lượt xem 28 ngày đầu trong 10 video trưởng thành gần nhất');

  const retention = input.retentionCurve ? getRetentionDropSegments(input.retentionCurve, input.video.durationSec) : null;
  const sceneMap = input.project && retention
    ? mapRetentionDropsToScenes(retention.segments, input.project.scenes, input.video.durationSec)
    : { mappingQuality: 'none' as const, sceneDurationSec: 0, drops: retention?.segments.map((drop) => ({ fromSec: drop.startSec, toSec: drop.endSec, dropPercent: drop.dropPercent, sceneIndexes: [], sceneNarrationExcerpt: '', mappingQuality: 'none' as const })) ?? [] };
  const sceneContent = input.project && sceneMap.mappingQuality !== 'none'
    ? (() => {
      let elapsed = 0;
      return input.project!.scenes.flatMap((scene, sourceIndex) => {
        if (scene.active === false) return [];
        const startSec = elapsed;
        elapsed += scene.durationSec;
        const sceneIndex = sourceIndex + 1;
        if (!sceneMap.drops.some((drop) => drop.sceneIndexes.includes(sceneIndex))) return [];
        return [{ sceneIndex, startSec, endSec: elapsed, narration: sanitizeReviewText(scene.narration, YOUTUBE_REVIEW_TEXT_MAX_CHARS), visualPromptHeadline: scene.visualPrompt ? sanitizeReviewText(scene.visualPrompt, YOUTUBE_REVIEW_VISUAL_HEADLINE_MAX_CHARS) : null }];
      });
    })()
    : [];
  const chosenTitle = input.project?.seo?.titles?.find((title) => title.id === input.project?.seo?.chosenTitleId)?.text ?? null;
  const first45Seconds = input.project ? (() => {
    let elapsed = 0;
      return input.project!.scenes.flatMap((scene, sourceIndex) => {
        if (scene.active === false) return [];
      if (elapsed >= 45) return [];
        const row = { sceneIndex: sourceIndex + 1, narration: sanitizeReviewText(scene.narration, YOUTUBE_REVIEW_TEXT_MAX_CHARS) };
        elapsed += scene.durationSec;
        return [row];
    });
  })() : [];
  const channelSearch = input.channelSearchTerms;
  const searchTerms = (['last28d', 'lifetime'] as const).map((window) => ({
    window,
    ...safeBreakdown(input.video.searchTerms[window], `search:${window}`, metricMap),
  }));
  const channelSearchTerms = (['last28d', 'lifetime'] as const).map((window) => ({
    window,
    ...safeBreakdown(channelSearch?.[window], `channel_search:${window}`, metricMap),
  }));
  const base = channelBase(input.planStatus, metricMap, input.syncedAt ?? null, input.channelSearchTerms);
  const packet = {
    target: 'video' as const,
    stage: base.stage,
    verdict: base.verdict,
    matureCount: base.matureCount,
    plan: base.plan,
    experiments: base.experiments,
    assumptions: base.assumptions,
    thresholds: base.thresholds,
    channelComparison: { ...comparison, metricIds: Object.keys(comparisonMetrics) },
    comparisonMetrics,
    video: videoPacket,
    retention: {
      status: retention ? 'ok' : 'unavailable',
      earlyDrop: retention?.earlyDrop ?? null,
      fetchedAt: input.retentionFetchedAt ?? null,
      drops: sceneMap.drops,
      sceneDurationSec: sceneMap.sceneDurationSec,
      mappingQuality: sceneMap.mappingQuality,
    },
    searchTerms,
    channelSearchTerms,
    project: input.project ? {
      id: input.project.id,
      title: sanitizeReviewText(input.project.title, 200),
      updatedAt: input.project.updatedAt ?? null,
      seoTitle: chosenTitle ? sanitizeReviewText(chosenTitle, 100) : null,
      descriptionIntro: input.project.seo?.descriptionIntro ? sanitizeReviewText(input.project.seo.descriptionIntro, 500) : null,
      descriptionKeywords: input.project.seo?.descriptionKeywords ? sanitizeReviewText(input.project.seo.descriptionKeywords, 800) : null,
      tags: (input.project.seo?.tags ?? []).slice(0, 30).map((tag) => sanitizeReviewText(tag, 80)),
      first45Seconds,
      scenesTouchedByRetentionDrops: sceneContent,
    } : null,
    thumbnailVisible: false,
    unknowns: [
      ...input.planStatus.verdict.unknowns,
      ...(input.video.manualReach?.impressions === undefined || input.video.manualReach.impressions < MIN_IMPRESSIONS_FOR_CTR ? ['CTR không khả dụng vì chưa có đủ lượt hiển thị nhập từ Studio.'] : []),
      ...(!input.retentionCurve ? ['Chưa có đường giữ chân đã lưu cho video này.'] : []),
      ...(searchTerms.some((row) => row.status !== 'ok') ? ['Từ khóa tìm kiếm chưa được cung cấp hoặc không khả dụng.'] : []),
      ...(sceneMap.mappingQuality === 'approximate' ? ['Thời lượng dự án khớp video xấp xỉ; cảnh chỉ là tham chiếu.'] : []),
      ...(sceneMap.mappingQuality === 'none' ? ['Không thể ánh xạ thời gian video sang cảnh của dự án.'] : []),
    ],
    metrics: metricMap,
    syncedAt: input.syncedAt ?? null,
    truncated: false,
    truncatedVideoCount: 0,
  };
  const fingerprint = stableHash({
    plan: input.planStatus.plan,
    planMetrics: input.planStatus.metrics,
    planVideos: input.planStatus.videos,
    verdict: input.planStatus.verdict,
    video: input.video,
    channelComparison: comparison,
    retention: { curve: input.retentionCurve, fetchedAt: input.retentionFetchedAt ?? null },
    project: input.project ?? null,
    channelSearchTerms: input.channelSearchTerms ?? null,
    syncedAt: input.syncedAt ?? null,
  });
  const serialized = JSON.stringify(packet);
  return { packet, metricMap, fingerprint, serialized, packetSummary: { matureCount: input.planStatus.matureCount, includedVideoCount: 1, truncatedVideoCount: 0 } };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}
