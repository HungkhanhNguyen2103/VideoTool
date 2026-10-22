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
import { RefreshYoutubeProfileRequestSchema, RefreshYoutubeProfileResultSchema, YoutubeConnectionSummarySchema, YoutubeSetupStatusSchema, type RefreshYoutubeProfileRequest } from '../../../contracts/youtube';
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
