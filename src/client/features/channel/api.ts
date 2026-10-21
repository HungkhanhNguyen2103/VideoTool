import { z } from 'zod';
import { ChannelSchema, CreateChannelRequestSchema, UpdateChannelRequestSchema, type CreateChannelRequest, type UpdateChannelRequest } from '../../../contracts/channel';
import { apiRequest } from '../../shared/api-client';

const ChannelListSchema = z.array(ChannelSchema);

export function listChannels() {
  return apiRequest('/api/channels', ChannelListSchema);
}

export function createChannel(input: CreateChannelRequest) {
  return apiRequest('/api/channels', ChannelSchema, { method: 'POST', body: CreateChannelRequestSchema.parse(input) });
}

export function updateChannel(id: string, input: UpdateChannelRequest) {
  return apiRequest(`/api/channels/${encodeURIComponent(id)}`, ChannelSchema, { method: 'PATCH', body: UpdateChannelRequestSchema.parse(input) });
}

export function deleteChannel(id: string) {
  return apiRequest(`/api/channels/${encodeURIComponent(id)}`, z.void(), { method: 'DELETE' });
}
