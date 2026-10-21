import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { CreateChannelRequest, UpdateChannelRequest } from '../../../contracts/channel';
import * as api from './api';

export const CHANNELS_QUERY_KEY = ['channels'] as const;
export const CHANNEL_TITLES_QUERY_KEY = ['channel-titles'] as const;
export const channelQueryKey = (id: string) => [...CHANNELS_QUERY_KEY, 'detail', id] as const;
export const channelTitlesQueryKey = (projectId: string) => [...CHANNEL_TITLES_QUERY_KEY, projectId] as const;

export async function invalidateChannelTitlesQuery(queryClient: Pick<QueryClient, 'invalidateQueries'>): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: CHANNEL_TITLES_QUERY_KEY });
}

export async function invalidateChannelMutationQueries(queryClient: Pick<QueryClient, 'invalidateQueries'>, projectId?: string): Promise<void> {
  const invalidations = [queryClient.invalidateQueries({ queryKey: CHANNELS_QUERY_KEY })];
  if (projectId) {
    invalidations.push(queryClient.invalidateQueries({ queryKey: ['projects', 'detail', projectId] }));
    invalidations.push(queryClient.invalidateQueries({ queryKey: ['projects'] }));
    invalidations.push(invalidateChannelTitlesQuery(queryClient));
  }
  await Promise.all(invalidations);
}

export function useChannels() {
  return useQuery({ queryKey: CHANNELS_QUERY_KEY, queryFn: api.listChannels });
}

export function useChannel(id: string | null | undefined) {
  return useQuery({ queryKey: channelQueryKey(id ?? ''), queryFn: () => api.getChannel(id!), enabled: Boolean(id) });
}

export function useCreateChannel() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (input: CreateChannelRequest) => api.createChannel(input), onSuccess: () => invalidateChannelMutationQueries(queryClient) });
}

export function useUpdateChannel() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: UpdateChannelRequest }) => api.updateChannel(id, input), onSuccess: () => invalidateChannelMutationQueries(queryClient) });
}

export function useDeleteChannel() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.deleteChannel(id), onSuccess: () => invalidateChannelMutationQueries(queryClient) });
}
