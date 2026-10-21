import type { AiProvider } from '../../../contracts/project';
import type { YoutubeVideoStats } from '../../../contracts/youtube';
import type { Config } from '../../config';
import { getDefaultAiModelId } from '../../../contracts/ai-models';
import { getAiClient, type AiClient } from '../../shared/ai';
import { AppError, NotFound } from '../../shared/errors';
import { loadConfig } from '../../config';
import { getProject, listProjects } from '../project';
import { buildChannelTrend, getRetentionDropSegments, getVideoRanking } from './analysis';
import { buildYoutubeReviewPrompt, requestYoutubeReview } from './ai-review';
import { getYoutubeAccessToken } from './sync';
import { getYoutubeRetention, getStoredChannelDaily } from './analytics-service';
import { findReview, listVideoDocs, upsertReview } from './repo';
import { YoutubeReviewDocSchema } from './docs';

export type YoutubeReviewTarget = 'channel' | 'video';

function usableVideos(rows: readonly YoutubeVideoStats[]): YoutubeVideoStats[] {
  return rows.filter((video) => video.privacy !== 'removed');
}

async function selectedAi(profileId: string, videoId?: string, config = loadConfig()): Promise<{ provider: AiProvider; model: string }> {
  if (!videoId) return { provider: config.DEFAULT_AI_PROVIDER, model: getDefaultAiModelId(config.DEFAULT_AI_PROVIDER) };
  const projects = await listProjects({});
  const linked = projects.find((project) => project.channelId === profileId && project.youtubeVideoId === videoId);
  if (!linked) return { provider: config.DEFAULT_AI_PROVIDER, model: getDefaultAiModelId(config.DEFAULT_AI_PROVIDER) };
  const project = await getProject(linked.id);
  return { provider: project.aiProvider, model: project.aiModel ?? getDefaultAiModelId(project.aiProvider) };
}

export async function generateYoutubeReview(input: {
  profileId: string;
  target: YoutubeReviewTarget;
  videoId?: string;
  fetcher?: typeof fetch;
  config?: Config;
  clientFactory?: (provider: AiProvider, model: string) => Pick<AiClient, 'chat'>;
}): Promise<{ target: YoutubeReviewTarget; targetId: string; promptVersion: string; dataWindow: string; result: Awaited<ReturnType<typeof requestYoutubeReview>>['result']; generatedAt: string }> {
  const videos = usableVideos(await listVideoDocs(input.profileId, { removed: { $ne: true } }));
  if (!videos.length) throw new AppError('Đồng bộ ít nhất một video trước khi nhận xét bằng AI.', 409, 'YOUTUBE_REVIEW_NO_DATA');
  const targetId = input.target === 'channel' ? 'channel' : input.videoId;
  if (!targetId) throw new AppError('Thiếu mã video cần nhận xét.', 400, 'YOUTUBE_VIDEO_ID_REQUIRED');
  let title: string | undefined;
  let metrics: Record<string, number | string | null>;
  let sampleSize = videos.length;
  let dataWindow = '28d vs previous 28d';
  if (input.target === 'channel') {
    const daily = await getStoredChannelDaily(input.profileId);
    const trend = buildChannelTrend(daily);
    const rankings = getVideoRanking(videos);
    metrics = {
      views28d: trend.views.current,
      viewsPrevious28d: trend.views.previous,
      viewsChangePercent: trend.views.changePercent,
      watchMinutes28d: trend.watchMinutes.current,
      watchMinutesPrevious28d: trend.watchMinutes.previous,
      netSubscribers28d: trend.subscribers.current,
      medianVideoViewsPerDay: rankings.viewsPerDay.length ? rankings.viewsPerDay[Math.floor(rankings.viewsPerDay.length / 2)]!.value : null,
      videoCount: videos.length,
      tooFewData: trend.tooFewData ? 'true' : 'false',
    };
  } else {
    const video = videos.find((row) => row.videoId === input.videoId);
    if (!video) throw new NotFound('Không tìm thấy video đã đồng bộ.');
    title = video.title;
    sampleSize = 1;
    const ranking = getVideoRanking([video]).viewsPerDay[0]?.value ?? null;
    const retentionResult = await getYoutubeRetention(input.profileId, video, await getYoutubeAccessToken(input.profileId, input.fetcher, input.config), input.fetcher);
    const retention = retentionResult.curve ? getRetentionDropSegments(retentionResult.curve, video.durationSec) : null;
    metrics = {
      views28d: video.analytics['28d']?.views ?? null,
      estimatedMinutesWatched28d: video.analytics['28d']?.estimatedMinutesWatched ?? null,
      averageViewPercentage28d: video.analytics['28d']?.averageViewPercentage ?? null,
      subscribersGained28d: video.analytics['28d']?.subscribersGained ?? null,
      viewsPerDay: ranking,
      durationSec: video.durationSec,
      earlyRetentionDrop: retention ? (retention.earlyDrop ? 'true' : 'false') : null,
      steepestRetentionDropPercent: retention?.segments[0]?.dropPercent ?? null,
    };
    dataWindow = '28d';
  }
  const ai = await selectedAi(input.profileId, input.videoId, input.config);
  const client = input.clientFactory?.(ai.provider, ai.model) ?? getAiClient(ai.provider, ai.model);
  const reviewInput = { kind: input.target, window: dataWindow, ...(title ? { title } : {}), metrics, sampleSize } as const;
  // Building the prompt here pins the serialized allowlist before anything reaches an AI client.
  const prompt = buildYoutubeReviewPrompt(reviewInput);
  const generated = await requestYoutubeReview(reviewInput, client);
  const generatedAt = new Date();
  await upsertReview(YoutubeReviewDocSchema.parse({
    _id: `${input.profileId}:${input.target}:${targetId}`,
    channelProfileId: input.profileId,
    target: input.target,
    targetId,
    promptVersion: prompt.promptVersion,
    dataWindow,
    result: generated.result,
    generatedAt,
  }));
  return { target: input.target, targetId, promptVersion: generated.promptVersion, dataWindow, result: generated.result, generatedAt: generatedAt.toISOString() };
}

export async function getYoutubeReview(profileId: string, target: YoutubeReviewTarget, targetId = target === 'channel' ? 'channel' : ''): Promise<Awaited<ReturnType<typeof generateYoutubeReview>> | null> {
  const review = await findReview(profileId, target, targetId);
  return review ? { target: review.target, targetId: review.targetId, promptVersion: review.promptVersion, dataWindow: review.dataWindow, result: review.result, generatedAt: review.generatedAt.toISOString() } : null;
}
