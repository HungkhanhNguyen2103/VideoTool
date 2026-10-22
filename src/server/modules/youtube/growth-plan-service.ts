import { YoutubeGrowthPlanConfigSchema, YoutubeGrowthPlanSchema, type YoutubeGrowthPlan, type YoutubeGrowthPlanConfig, type YoutubeGrowthPlanStatus } from '../../../contracts/youtube-plan';
import { findChannelTrafficSources, findCredential, findRetention, findYoutubeGrowthPlan, listChannelDaily, listVideoDocs, replaceYoutubeGrowthPlan } from './repo';
import { buildYoutubeGrowthPlan } from './growth-plan';

export async function getYoutubeGrowthPlan(profileId: string): Promise<YoutubeGrowthPlan> {
  const stored = await findYoutubeGrowthPlan(profileId);
  const config = stored ? YoutubeGrowthPlanConfigSchema.parse({
    nicheStartDate: stored.nicheStartDate,
    cadencePerWeek: stored.cadencePerWeek,
    viewTargets: stored.viewTargets,
    assumedAvgViewDurationMin: stored.assumedAvgViewDurationMin,
    toleranceMonths: stored.toleranceMonths,
    warnAtMatureVideos: stored.warnAtMatureVideos,
    decideAtMatureVideos: stored.decideAtMatureVideos,
    decideMinMonths: stored.decideMinMonths,
    hardReviewWeek: stored.hardReviewWeek,
    minExperimentsBeforeStop: stored.minExperimentsBeforeStop,
    submittedForReviewAt: stored.submittedForReviewAt,
  }) : YoutubeGrowthPlanConfigSchema.parse({});
  return YoutubeGrowthPlanSchema.parse({
    ...config,
    channelProfileId: profileId,
    experiments: stored?.experiments ?? [],
    createdAt: stored?.createdAt ?? null,
    updatedAt: stored?.updatedAt ?? null,
  });
}

export async function saveYoutubeGrowthPlan(profileId: string, config: YoutubeGrowthPlanConfig, now = new Date()): Promise<YoutubeGrowthPlan> {
  const saved = await findYoutubeGrowthPlan(profileId);
  const updated = await replaceYoutubeGrowthPlan(profileId, config, now);
  return YoutubeGrowthPlanSchema.parse({
    nicheStartDate: updated.nicheStartDate,
    cadencePerWeek: updated.cadencePerWeek,
    viewTargets: updated.viewTargets,
    assumedAvgViewDurationMin: updated.assumedAvgViewDurationMin,
    toleranceMonths: updated.toleranceMonths,
    warnAtMatureVideos: updated.warnAtMatureVideos,
    decideAtMatureVideos: updated.decideAtMatureVideos,
    decideMinMonths: updated.decideMinMonths,
    hardReviewWeek: updated.hardReviewWeek,
    minExperimentsBeforeStop: updated.minExperimentsBeforeStop,
    submittedForReviewAt: updated.submittedForReviewAt,
    channelProfileId: profileId,
    experiments: saved?.experiments ?? updated.experiments,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  });
}

export async function getYoutubeGrowthPlanStatus(profileId: string, now = new Date()): Promise<YoutubeGrowthPlanStatus> {
  const [plan, videos, daily, credential, traffic] = await Promise.all([
    getYoutubeGrowthPlan(profileId),
    listVideoDocs(profileId, { removed: { $ne: true } }),
    listChannelDaily(profileId),
    findCredential(profileId),
    findChannelTrafficSources(profileId),
  ]);
  const retentionRows = await Promise.all(videos.map((video) => findRetention(profileId, video.videoId)));
  const retentionByVideoId = Object.fromEntries(videos.flatMap((video, index) => {
    const curve = retentionRows[index]?.curve;
    return curve ? [[video.videoId, curve]] : [];
  }));
  return buildYoutubeGrowthPlan({
    plan,
    videos,
    daily: daily.map(({ date, views, estimatedMinutesWatched, subscribersGained, subscribersLost }) => ({ date, views, estimatedMinutesWatched, subscribersGained, subscribersLost })),
    subscriberCount: credential?.subscriberCount ?? null,
    channelTraffic: traffic,
    retentionByVideoId,
    now,
  });
}
