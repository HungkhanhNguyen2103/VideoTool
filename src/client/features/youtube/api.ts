import { z } from 'zod';
import {
  YoutubeActiveJobSchema,
  YoutubeAuthorizationStartSchema,
  YoutubeChannelOverviewSchema,
  YoutubeJobStartSchema,
  YoutubeReviewSchema,
  YoutubeSuggestedLinkSchema,
  YoutubeVideoDetailSchema,
  YoutubeVideoListItemSchema,
  type YoutubeVideoListItem,
} from '../../../contracts/youtube-analytics';
import { RefreshYoutubeProfileRequestSchema, RefreshYoutubeProfileResultSchema, YoutubeConnectionSummarySchema, YoutubeManualReachInputSchema, YoutubePlanExclusionInputSchema, YoutubeSetupStatusSchema, YoutubeVideoStatsSchema, type RefreshYoutubeProfileRequest } from '../../../contracts/youtube';
import { YoutubeChannelsOverviewSchema, YoutubeSyncAllResultSchema } from '../../../contracts/youtube-overview';
import { YoutubeGrowthExperimentInputSchema, YoutubeGrowthPlanConfigSchema, YoutubeGrowthPlanSchema, YoutubeGrowthPlanStatusSchema } from '../../../contracts/youtube-plan';
import { apiRequest } from '../../shared/api-client';

const VideoListSchema = z.array(YoutubeVideoListItemSchema);
const SuggestedLinksSchema = z.array(YoutubeSuggestedLinkSchema);
const EmptySchema = z.void();
const YoutubeProjectLinkSchema = z.object({ id: z.string(), title: z.string(), channelId: z.string().nullable(), youtubeVideoId: z.string().nullable() });

export type YoutubeVideoFilters = {
  sort?: 'publishedAt' | 'viewCount' | 'durationSec' | 'title' | 'viewsPerDay' | 'averageViewPercentage' | 'clickThroughRate' | 'subscribersPerThousandViews';
  window?: '28d' | '90d' | '365d' | 'lifetime';
  type?: 'all' | 'long' | 'short';
  q?: string;
};

export function beginYoutubeConnection(channelId: string) {
  return apiRequest(`/api/youtube/connect/${encodeURIComponent(channelId)}`, YoutubeAuthorizationStartSchema, { method: 'POST' });
}

export function beginYoutubeImport() {
  return apiRequest('/api/youtube/import/start', YoutubeAuthorizationStartSchema, { method: 'POST' });
}

export function getYoutubeSetupStatus() {
  return apiRequest('/api/youtube/setup', YoutubeSetupStatusSchema);
}

export function getYoutubeChannelsOverview() {
  return apiRequest('/api/youtube/channels-overview', YoutubeChannelsOverviewSchema);
}

export function syncAllYoutubeChannels() {
  return apiRequest('/api/youtube/sync-all', YoutubeSyncAllResultSchema, { method: 'POST' });
}

export function refreshYoutubeProfile(channelId: string, input: RefreshYoutubeProfileRequest = {}) {
  return apiRequest(`/api/youtube/channels/${encodeURIComponent(channelId)}/refresh-profile`, RefreshYoutubeProfileResultSchema, {
    method: 'POST', body: RefreshYoutubeProfileRequestSchema.parse(input),
  });
}

export function getYoutubeConnection(channelId: string) {
  return apiRequest(`/api/youtube/connection/${encodeURIComponent(channelId)}`, YoutubeConnectionSummarySchema);
}

export function disconnectYoutube(channelId: string) {
  return apiRequest(`/api/youtube/disconnect/${encodeURIComponent(channelId)}`, EmptySchema, { method: 'POST', body: { deleteSyncedData: false } });
}

export function startYoutubeSync(channelId: string) {
  return apiRequest(`/api/youtube/sync/${encodeURIComponent(channelId)}`, YoutubeJobStartSchema, { method: 'POST' });
}

export function getActiveYoutubeSync(channelId: string) {
  return apiRequest(`/api/youtube/channels/${encodeURIComponent(channelId)}/sync-job`, YoutubeActiveJobSchema);
}

export function getYoutubeOverview(channelId: string) {
  return apiRequest(`/api/youtube/channels/${encodeURIComponent(channelId)}/overview`, YoutubeChannelOverviewSchema);
}

export function getYoutubeVideos(channelId: string, filters: YoutubeVideoFilters = {}): Promise<YoutubeVideoListItem[]> {
  return apiRequest(`/api/youtube/channels/${encodeURIComponent(channelId)}/videos`, VideoListSchema, {
    query: { sort: filters.sort, window: filters.window, type: filters.type, q: filters.q },
  });
}

export function getYoutubeVideo(channelId: string, videoId: string) {
  return apiRequest(`/api/youtube/videos/${encodeURIComponent(channelId)}/${encodeURIComponent(videoId)}`, YoutubeVideoDetailSchema);
}

export function getYoutubeGrowthPlan(channelId: string) {
  return apiRequest(`/api/youtube/channels/${encodeURIComponent(channelId)}/plan`, YoutubeGrowthPlanSchema);
}

export function saveYoutubeGrowthPlan(channelId: string, input: unknown) {
  return apiRequest(`/api/youtube/channels/${encodeURIComponent(channelId)}/plan`, YoutubeGrowthPlanSchema, { method: 'PUT', body: YoutubeGrowthPlanConfigSchema.parse(input) });
}

export function getYoutubeGrowthPlanStatus(channelId: string) {
  return apiRequest(`/api/youtube/channels/${encodeURIComponent(channelId)}/plan-status`, YoutubeGrowthPlanStatusSchema);
}

export function addYoutubeGrowthExperiment(channelId: string, input: unknown) {
  return apiRequest(`/api/youtube/channels/${encodeURIComponent(channelId)}/plan/experiments`, YoutubeGrowthPlanSchema, { method: 'POST', body: YoutubeGrowthExperimentInputSchema.parse(input) });
}

export function deleteYoutubeGrowthExperiment(channelId: string, experimentId: string) {
  return apiRequest(`/api/youtube/channels/${encodeURIComponent(channelId)}/plan/experiments/${encodeURIComponent(experimentId)}`, YoutubeGrowthPlanSchema, { method: 'DELETE' });
}

export function saveYoutubeManualReach(channelId: string, videoId: string, input: unknown) {
  return apiRequest(`/api/youtube/videos/${encodeURIComponent(channelId)}/${encodeURIComponent(videoId)}/manual-reach`, YoutubeVideoStatsSchema, { method: 'PUT', body: YoutubeManualReachInputSchema.parse(input) });
}

export function clearYoutubeManualReach(channelId: string, videoId: string) {
  return apiRequest(`/api/youtube/videos/${encodeURIComponent(channelId)}/${encodeURIComponent(videoId)}/manual-reach`, YoutubeVideoStatsSchema, { method: 'DELETE' });
}

export function setYoutubePlanExclusion(channelId: string, videoId: string, excluded: boolean) {
  return apiRequest(`/api/youtube/videos/${encodeURIComponent(channelId)}/${encodeURIComponent(videoId)}/plan-exclusion`, YoutubeVideoStatsSchema, { method: 'PUT', body: YoutubePlanExclusionInputSchema.parse({ excluded }) });
}

export function getSuggestedYoutubeLinks(channelId: string) {
  return apiRequest(`/api/youtube/channels/${encodeURIComponent(channelId)}/suggested-links`, SuggestedLinksSchema);
}

export function generateYoutubeChannelReview(channelId: string) {
  return apiRequest(`/api/youtube/channels/${encodeURIComponent(channelId)}/review`, YoutubeReviewSchema, { method: 'POST' });
}

export function generateYoutubeVideoReview(channelId: string, videoId: string) {
  return apiRequest(`/api/youtube/videos/${encodeURIComponent(channelId)}/${encodeURIComponent(videoId)}/review`, YoutubeReviewSchema, { method: 'POST' });
}

export function linkProjectToYoutubeVideo(projectId: string, videoId: string) {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/youtube-video`, YoutubeProjectLinkSchema, { method: 'PUT', body: { videoId } });
}

export function unlinkProjectFromYoutubeVideo(projectId: string) {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/youtube-video`, YoutubeProjectLinkSchema, { method: 'DELETE' });
}
