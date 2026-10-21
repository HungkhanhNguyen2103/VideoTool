import { z } from 'zod';
import { YoutubeChannelOptionSchema, YoutubeVideoStatsSchema, YoutubeChannelDailySchema } from '../../../contracts/youtube';

const EncryptedRefreshTokenSchema = z.object({
  algorithm: z.literal('aes-256-gcm'),
  iv: z.string(),
  authTag: z.string(),
  ciphertext: z.string(),
}).strict();

export const YoutubeCredentialDocSchema = z.object({
  _id: z.string(),
  schemaVersion: z.literal(1),
  refreshToken: EncryptedRefreshTokenSchema,
  youtubeChannelId: z.string().nullable(),
  title: z.string().nullable(),
  handle: z.string().optional(),
  thumbnailUrl: z.string().url().optional(),
  connectedAt: z.date(),
  lastSyncAt: z.date().optional(),
  lastSyncError: z.string().optional(),
  needsReconnect: z.boolean().default(false),
  channelOptions: z.array(YoutubeChannelOptionSchema).default([]),
  selectionId: z.string().optional(),
  lastSyncReport: z.record(z.string(), z.object({ status: z.enum(['ok', 'unavailable', 'error']), message: z.string().optional() }).strict()).optional(),
}).strict();
export type YoutubeCredentialDoc = z.infer<typeof YoutubeCredentialDocSchema>;

export const YoutubeVideoDocSchema = YoutubeVideoStatsSchema.extend({
  _id: z.string(),
  channelProfileId: z.string(),
  removed: z.boolean().default(false),
}).strict();
export type YoutubeVideoDoc = z.infer<typeof YoutubeVideoDocSchema>;

export const YoutubeChannelDailyDocSchema = YoutubeChannelDailySchema.extend({
  _id: z.string(),
  channelProfileId: z.string(),
}).strict();
export type YoutubeChannelDailyDoc = z.infer<typeof YoutubeChannelDailyDocSchema>;

export const YoutubeQuotaDocSchema = z.object({
  _id: z.string(),
  date: z.string(),
  projectKey: z.string(),
  estimatedUnits: z.number().int().nonnegative(),
}).strict();
export type YoutubeQuotaDoc = z.infer<typeof YoutubeQuotaDocSchema>;
