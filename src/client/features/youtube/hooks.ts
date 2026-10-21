import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { YoutubeVideoFilters } from './api';
import * as api from './api';

export const YOUTUBE_QUERY_KEY = ['youtube'] as const;
export const youtubeConnectionKey = (channelId: string) => [...YOUTUBE_QUERY_KEY, 'connection', channelId] as const;
export const youtubeOverviewKey = (channelId: string) => [...YOUTUBE_QUERY_KEY, 'overview', channelId] as const;
export const youtubeVideosKey = (channelId: string, filters: YoutubeVideoFilters = {}) => [...YOUTUBE_QUERY_KEY, 'videos', channelId, filters] as const;
export const youtubeVideoKey = (channelId: string, videoId: string) => [...YOUTUBE_QUERY_KEY, 'video', channelId, videoId] as const;
export const youtubeLinksKey = (channelId: string) => [...YOUTUBE_QUERY_KEY, 'suggested-links', channelId] as const;
export const youtubeActiveSyncKey = (channelId: string) => [...YOUTUBE_QUERY_KEY, 'active-sync', channelId] as const;

export async function invalidateYoutubeChannelQueries(queryClient: Pick<QueryClient, 'invalidateQueries'>, channelId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: youtubeConnectionKey(channelId) }),
    queryClient.invalidateQueries({ queryKey: youtubeOverviewKey(channelId) }),
    queryClient.invalidateQueries({ queryKey: [...YOUTUBE_QUERY_KEY, 'videos', channelId] }),
    queryClient.invalidateQueries({ queryKey: youtubeLinksKey(channelId) }),
    queryClient.invalidateQueries({ queryKey: youtubeActiveSyncKey(channelId) }),
  ]);
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

export function useYoutubeSuggestedLinks(channelId: string, enabled = true) {
  return useQuery({ queryKey: youtubeLinksKey(channelId), queryFn: () => api.getSuggestedYoutubeLinks(channelId), enabled: Boolean(channelId) && enabled });
}
