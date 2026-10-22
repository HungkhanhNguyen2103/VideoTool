import { createHash } from 'node:crypto';
import type { ScriptPresetId } from '../../../contracts/project';
import { NEXT_VIDEO_IDEAS_MIN_MATURE, type YoutubeIdeaEvidenceTier } from '../../../contracts/youtube-ideas';
import type { YoutubeGrowthPlanStatus } from '../../../contracts/youtube-plan';
import { normalizeSeoTitleForComparison } from '../../../contracts/seo-duplicates';
import { sanitizeReviewText } from './review-evidence';

export type IdeaPacketInput = {
  channel: { id: string; name: string; language: 'vi' | 'en'; tagline: string; description: string };
  plan: { nicheStartDate: string | null; cadencePerWeek: number; experiments: { id: string; date: string; variable: string; note: string; videoIds?: string[] }[] };
  planStatus: Pick<YoutubeGrowthPlanStatus, 'matureCount' | 'videos' | 'metrics' | 'verdict'>;
  projects: { id: string; title: string; scriptPresetId: ScriptPresetId; brief: string; youtubeVideoId: string | null; status: string }[];
  syncedVideos: { videoId: string; title: string; publishedAt: string | null; privacy: string }[];
  savedIdeas: { title: string; status: 'new' | 'chosen' | 'rejected' | 'used' }[];
  steering: string;
  presetId: ScriptPresetId;
  count: number;
  targetDurationSec: number;
  searchTerms?: { window: 'last28d' | 'lifetime'; status: string; terms: { term: string; views: number | null }[] }[];
  trafficMix?: { window: 'last28d' | 'lifetime'; sources: { sourceType: string; views: number | null; share: number | null }[] }[];
};

export type YoutubeIdeaPacket = {
  packet: Record<string, unknown>;
  serialized: string;
  fingerprint: string;
  coverageFingerprint: string;
  evidenceTier: YoutubeIdeaEvidenceTier;
  packetSummary: { projectCount: number; syncedVideoCount: number; savedIdeaCount: number; matureVideoCount: number };
};

export function classifyIdeaEvidence(matureVideoCount: number): { tier: YoutubeIdeaEvidenceTier; matureVideoCount: number; minimumMatureForDataInformed: number } {
  const count = Number.isFinite(matureVideoCount) ? Math.max(0, Math.floor(matureVideoCount)) : 0;
  const tier: YoutubeIdeaEvidenceTier = count < 3 ? 'no-performance-data' : count < NEXT_VIDEO_IDEAS_MIN_MATURE ? 'weak-signal' : 'data-informed';
  return { tier, matureVideoCount: count, minimumMatureForDataInformed: NEXT_VIDEO_IDEAS_MIN_MATURE };
}

export function normalizeYoutubeIdeaTitle(value: string): string {
  return normalizeSeoTitleForComparison(value);
}

function sanitizeIdeaText(value: string, limit: number): string {
  return sanitizeReviewText(value, limit)
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu, '[email removed]')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/giu, '[token removed]')
    .replace(/\b(?:ya29\.|AIza)[A-Za-z0-9_-]{12,}/gu, '[token removed]')
    .replace(/(?:[A-Za-z]:\\|\\\\|\/(?:home|Users|tmp|var)\/)[^\s"']+/gu, '[path removed]');
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function metricMap(status: IdeaPacketInput['planStatus']): Record<string, { value: number | null; unit: string; label: string; assumed?: boolean }> {
  return Object.fromEntries(Object.entries(status.metrics).map(([id, item]) => [id, item]));
}

export function buildYoutubeIdeaPacket(input: IdeaPacketInput): YoutubeIdeaPacket {
  const tier = classifyIdeaEvidence(input.planStatus.matureCount);
  const presets = [...new Set(input.projects.map((project) => project.scriptPresetId))];
  const projects = input.projects.map((project) => ({
    title: sanitizeIdeaText(project.title, 120),
    scriptPresetId: project.scriptPresetId,
    brief: sanitizeIdeaText(project.brief, 300),
    youtubeVideoId: project.youtubeVideoId,
    status: project.status,
  }));
  const nicheStartDate = input.plan.nicheStartDate;
  const syncedVideos = input.syncedVideos.map((video) => ({
    videoId: video.videoId,
    title: sanitizeIdeaText(video.title, 200),
    publishedAt: video.publishedAt,
    olderNiche: Boolean(nicheStartDate && video.publishedAt && video.publishedAt.slice(0, 10) < nicheStartDate),
  }));
  const savedIdeas = input.savedIdeas.map((idea) => ({ title: sanitizeIdeaText(idea.title, 100), status: idea.status }));
  const coverage = { projects, syncedVideos, savedIdeas };
  const packet: Record<string, unknown> = {
    packetVersion: 'youtube-idea-packet-v1',
    channel: {
      name: sanitizeIdeaText(input.channel.name, 100),
      language: input.channel.language,
      tagline: sanitizeIdeaText(input.channel.tagline, 200),
      description: sanitizeIdeaText(input.channel.description, 1000),
      nicheStartDate,
      cadencePerWeek: input.plan.cadencePerWeek,
      presetsUsedSoFar: presets,
    },
    coverage,
    steering: sanitizeIdeaText(input.steering, 500),
    request: { presetId: input.presetId, count: input.count, targetDurationSec: input.targetDurationSec },
    evidence: { tier: tier.tier, matureVideoCount: tier.matureVideoCount, minimumMatureForDataInformed: tier.minimumMatureForDataInformed },
  };

  const measured = input.planStatus.videos.filter((video) => video.first28dViews !== null)
    .sort((left, right) => (right.first28dViews ?? 0) - (left.first28dViews ?? 0) || left.videoId.localeCompare(right.videoId));
  if (tier.tier === 'weak-signal') {
    packet.rankedOwnVideos = {
      sampleSize: tier.matureVideoCount,
      warning: `Mẫu chỉ có ${tier.matureVideoCount} video trưởng thành; thứ hạng là gợi ý yếu, không phải kết luận về hiệu quả tương lai.`,
      items: measured.map((video, index) => ({ rank: index + 1, videoId: video.videoId, title: sanitizeIdeaText(video.title, 200), first28dViews: video.first28dViews, approximate: video.approximate, metricId: video.metricId })),
    };
  } else if (tier.tier === 'data-informed') {
    const asRanked = (rows: typeof measured) => rows.map((video) => ({ videoId: video.videoId, title: sanitizeIdeaText(video.title, 200), first28dViews: video.first28dViews, approximate: video.approximate, metricId: video.metricId }));
    packet.metrics = metricMap(input.planStatus);
    packet.topVideos = asRanked(measured.slice(0, 5));
    packet.bottomVideos = asRanked([...measured].slice(-5).reverse());
    packet.searchTerms = Object.fromEntries((input.searchTerms ?? []).map((window) => [window.window, window.terms.slice(0, 25).map((row, index) => ({
      rank: index + 1,
      term: sanitizeIdeaText(row.term, 200),
      views: row.views,
      metricIds: [`search:${window.window}:${index + 1}:views`],
    }))]));
    packet.trafficMix = Object.fromEntries((input.trafficMix ?? []).map((window) => [window.window, window.sources.map((row) => ({ ...row, metricId: `traffic:${window.window}:${row.sourceType.toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '_')}:share` }))]));
    packet.verdict = input.planStatus.verdict;
    packet.activeExperiment = input.plan.experiments.at(-1) ?? null;
  }

  const coverageFingerprint = fingerprint(coverage);
  const serialized = JSON.stringify(packet);
  return {
    packet,
    serialized,
    fingerprint: fingerprint(packet),
    coverageFingerprint,
    evidenceTier: tier.tier,
    packetSummary: { projectCount: projects.length, syncedVideoCount: syncedVideos.length, savedIdeaCount: savedIdeas.length, matureVideoCount: tier.matureVideoCount },
  };
}
