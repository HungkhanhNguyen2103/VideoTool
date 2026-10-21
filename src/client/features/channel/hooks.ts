import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { CreateChannelRequest, UpdateChannelRequest } from '../../../contracts/channel';
import * as api from './api';

export const CHANNELS_QUERY_KEY = ['channels'] as const;

export async function invalidateChannelMutationQueries(queryClient: Pick<QueryClient, 'invalidateQueries'>, projectId?: string): Promise<void> {
  const invalidations = [queryClient.invalidateQueries({ queryKey: CHANNELS_QUERY_KEY })];
  if (projectId) {
    invalidations.push(queryClient.invalidateQueries({ queryKey: ['projects', 'detail', projectId] }));
    invalidations.push(queryClient.invalidateQueries({ queryKey: ['projects'] }));
  }
  await Promise.all(invalidations);
}

export function useChannels() {
  return useQuery({ queryKey: CHANNELS_QUERY_KEY, queryFn: api.listChannels });
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
