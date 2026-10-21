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
  subscriberCount: z.number().nonnegative().nullable().optional(),
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

export const YoutubeRetentionDocSchema = z.object({
  _id: z.string(),
  channelProfileId: z.string(),
  videoId: z.string(),
  fetchedAt: z.date(),
  curve: z.array(z.object({ ratio: z.number().min(0).max(1), watchRatio: z.number().nonnegative() }).strict()),
}).strict();
export type YoutubeRetentionDoc = z.infer<typeof YoutubeRetentionDocSchema>;

export const YoutubeReviewDocSchema = z.object({
  _id: z.string(),
  channelProfileId: z.string(),
  target: z.enum(['channel', 'video']),
  targetId: z.string(),
  promptVersion: z.string(),
  dataWindow: z.string(),
  result: z.object({ observations: z.array(z.string()), hypotheses: z.array(z.string()), experiments: z.array(z.string()) }).strict(),
  generatedAt: z.date(),
}).strict();
export type YoutubeReviewDoc = z.infer<typeof YoutubeReviewDocSchema>;
