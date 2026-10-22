import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { YoutubeVideoFilters } from './api';
import * as api from './api';

export const YOUTUBE_QUERY_KEY = ['youtube'] as const;
export const youtubeConnectionKey = (channelId: string) => [...YOUTUBE_QUERY_KEY, 'connection', channelId] as const;
export const youtubeOverviewKey = (channelId: string) => [...YOUTUBE_QUERY_KEY, 'overview', channelId] as const;
export const youtubeVideosKey = (channelId: string, filters: YoutubeVideoFilters = {}) => [...YOUTUBE_QUERY_KEY, 'videos', channelId, filters] as const;
export const youtubeVideoKey = (channelId: string, videoId: string) => [...YOUTUBE_QUERY_KEY, 'video', channelId, videoId] as const;
export const youtubeGrowthPlanKey = (channelId: string) => [...YOUTUBE_QUERY_KEY, 'growth-plan', channelId] as const;
export const youtubeGrowthPlanStatusKey = (channelId: string) => [...YOUTUBE_QUERY_KEY, 'growth-plan-status', channelId] as const;
export const youtubeLinksKey = (channelId: string) => [...YOUTUBE_QUERY_KEY, 'suggested-links', channelId] as const;
export const youtubeActiveSyncKey = (channelId: string) => [...YOUTUBE_QUERY_KEY, 'active-sync', channelId] as const;
export const youtubeSetupStatusKey = [...YOUTUBE_QUERY_KEY, 'setup'] as const;
export const youtubeChannelReviewV2Key = (channelId: string) => [...YOUTUBE_QUERY_KEY, 'review-v2', 'channel', channelId] as const;
export const youtubeVideoReviewV2Key = (channelId: string, videoId: string) => [...YOUTUBE_QUERY_KEY, 'review-v2', 'video', channelId, videoId] as const;
export const youtubeChannelsOverviewKey = [...YOUTUBE_QUERY_KEY, 'channels-overview'] as const;

export async function invalidateYoutubeChannelQueries(queryClient: Pick<QueryClient, 'invalidateQueries'>, channelId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: youtubeConnectionKey(channelId) }),
    queryClient.invalidateQueries({ queryKey: youtubeOverviewKey(channelId) }),
    queryClient.invalidateQueries({ queryKey: [...YOUTUBE_QUERY_KEY, 'videos', channelId] }),
    queryClient.invalidateQueries({ queryKey: youtubeLinksKey(channelId) }),
    queryClient.invalidateQueries({ queryKey: youtubeActiveSyncKey(channelId) }),
  ]);
}

export async function invalidateYoutubeChannelsOverviewQueries(queryClient: Pick<QueryClient, 'invalidateQueries'>, channelIds?: readonly string[]): Promise<void> {
  const tasks: Promise<unknown>[] = [
    queryClient.invalidateQueries({ queryKey: youtubeChannelsOverviewKey }),
    queryClient.invalidateQueries({ queryKey: ['channels'] }),
  ];
  if (channelIds?.length) tasks.push(...channelIds.map((channelId) => invalidateYoutubeChannelQueries(queryClient, channelId)));
  else tasks.push(queryClient.invalidateQueries({ queryKey: YOUTUBE_QUERY_KEY }));
  await Promise.all(tasks);
}

export async function invalidateYoutubeLinkQueries(queryClient: Pick<QueryClient, 'invalidateQueries'>, channelId: string, videoId?: string): Promise<void> {
  const invalidations = [
    queryClient.invalidateQueries({ queryKey: [...YOUTUBE_QUERY_KEY, 'videos', channelId] }),
    queryClient.invalidateQueries({ queryKey: youtubeLinksKey(channelId) }),
    queryClient.invalidateQueries({ queryKey: youtubeOverviewKey(channelId) }),
    queryClient.invalidateQueries({ queryKey: ['projects'] }),
  ];
  if (videoId) invalidations.push(queryClient.invalidateQueries({ queryKey: youtubeVideoKey(channelId, videoId) }));
  await Promise.all(invalidations);
}

export async function invalidateYoutubeProfileQueries(queryClient: Pick<QueryClient, 'invalidateQueries'>, channelId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['channels'] }),
    queryClient.invalidateQueries({ queryKey: ['channels', 'detail', channelId] }),
    queryClient.invalidateQueries({ queryKey: youtubeConnectionKey(channelId) }),
  ]);
}

export function useYoutubeSetupStatus() {
  return useQuery({ queryKey: youtubeSetupStatusKey, queryFn: api.getYoutubeSetupStatus });
}

export function useYoutubeChannelsOverview() {
  return useQuery({ queryKey: youtubeChannelsOverviewKey, queryFn: api.getYoutubeChannelsOverview });
}

export function useSyncAllYoutubeChannels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.syncAllYoutubeChannels,
    onSuccess: (result) => invalidateYoutubeChannelsOverviewQueries(queryClient, result.results.map((row) => row.channelId)),
  });
}

export function useRefreshYoutubeProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, input }: { channelId: string; input?: Parameters<typeof api.refreshYoutubeProfile>[1] }) => api.refreshYoutubeProfile(channelId, input),
    onSuccess: (_result, variables) => invalidateYoutubeProfileQueries(queryClient, variables.channelId),
  });
}

export function useYoutubeConnection(channelId: string, initialData?: Awaited<ReturnType<typeof api.getYoutubeConnection>>) {
  return useQuery({ queryKey: youtubeConnectionKey(channelId), queryFn: () => api.getYoutubeConnection(channelId), enabled: Boolean(channelId), ...(initialData ? { initialData } : {}) });
}

export function useYoutubeActiveSync(channelId: string, enabled = true) {
  return useQuery({ queryKey: youtubeActiveSyncKey(channelId), queryFn: () => api.getActiveYoutubeSync(channelId), enabled: Boolean(channelId) && enabled });
}

export function useYoutubeOverview(channelId: string, enabled = true) {
  return useQuery({ queryKey: youtubeOverviewKey(channelId), queryFn: () => api.getYoutubeOverview(channelId), enabled: Boolean(channelId) && enabled });
}

export function useYoutubeVideos(channelId: string, filters: YoutubeVideoFilters, enabled = true) {
  return useQuery({ queryKey: youtubeVideosKey(channelId, filters), queryFn: () => api.getYoutubeVideos(channelId, filters), enabled: Boolean(channelId) && enabled });
}

export function useYoutubeVideo(channelId: string, videoId: string | null) {
  return useQuery({ queryKey: youtubeVideoKey(channelId, videoId ?? ''), queryFn: () => api.getYoutubeVideo(channelId, videoId!), enabled: Boolean(channelId && videoId) });
}

export function useYoutubeGrowthPlan(channelId: string, enabled = true) {
  return useQuery({ queryKey: youtubeGrowthPlanKey(channelId), queryFn: () => api.getYoutubeGrowthPlan(channelId), enabled: Boolean(channelId) && enabled });
}

export function useYoutubeGrowthPlanStatus(channelId: string, enabled = true) {
  return useQuery({ queryKey: youtubeGrowthPlanStatusKey(channelId), queryFn: () => api.getYoutubeGrowthPlanStatus(channelId), enabled: Boolean(channelId) && enabled });
}

export function useYoutubeSuggestedLinks(channelId: string, enabled = true) {
  return useQuery({ queryKey: youtubeLinksKey(channelId), queryFn: () => api.getSuggestedYoutubeLinks(channelId), enabled: Boolean(channelId) && enabled });
}

export function useYoutubeChannelReviewV2(channelId: string, enabled = true) {
  return useQuery({ queryKey: youtubeChannelReviewV2Key(channelId), queryFn: () => api.getYoutubeChannelReviewV2(channelId), enabled: Boolean(channelId) && enabled });
}

export function useYoutubeVideoReviewV2(channelId: string, videoId: string | null) {
  return useQuery({ queryKey: youtubeVideoReviewV2Key(channelId, videoId ?? ''), queryFn: () => api.getYoutubeVideoReviewV2(channelId, videoId!), enabled: Boolean(channelId && videoId) });
}
