import { z } from 'zod';

export const YoutubeChannelOptionSchema = z.object({
  youtubeChannelId: z.string().min(1),
  title: z.string(),
  handle: z.string().optional(),
  customUrl: z.string().optional(),
  description: z.string().optional(),
  defaultLanguage: z.string().optional(),
  country: z.string().optional(),
  thumbnailUrl: z.string().url().optional(),
}).strict();
export type YoutubeChannelOption = z.infer<typeof YoutubeChannelOptionSchema>;

export const YoutubeProfileFieldSchema = z.enum(['name', 'handle', 'description', 'language']);
export type YoutubeProfileField = z.infer<typeof YoutubeProfileFieldSchema>;

export const RefreshYoutubeProfileRequestSchema = z.object({
  overwrite: z.boolean().default(false),
  fields: z.array(YoutubeProfileFieldSchema).optional(),
}).strict();
export type RefreshYoutubeProfileRequest = z.input<typeof RefreshYoutubeProfileRequestSchema>;

export const RefreshYoutubeProfileResultSchema = z.object({
  updated: z.array(YoutubeProfileFieldSchema),
  skipped: z.array(YoutubeProfileFieldSchema),
}).strict();
export type RefreshYoutubeProfileResult = z.infer<typeof RefreshYoutubeProfileResultSchema>;

export const YoutubeSetupStatusSchema = z.object({
  configured: z.boolean(),
  message: z.string().optional(),
}).strict();
export type YoutubeSetupStatus = z.infer<typeof YoutubeSetupStatusSchema>;

/** Safe for channel/project APIs. OAuth credentials intentionally have no fields in this contract. */
export const YoutubeConnectionSummarySchema = z.object({
  connected: z.boolean(),
  youtubeChannelId: z.string().nullable(),
  title: z.string().nullable(),
  handle: z.string().optional(),
  thumbnailUrl: z.string().url().optional(),
  connectedAt: z.string().datetime().nullable(),
  lastSyncAt: z.string().datetime().optional(),
  lastSyncError: z.string().optional(),
  needsReconnect: z.boolean().default(false),
  setupConfigured: z.boolean().default(false),
  channelOptions: z.array(YoutubeChannelOptionSchema).optional(),
}).strict();
export type YoutubeConnectionSummary = z.infer<typeof YoutubeConnectionSummarySchema>;

export const YoutubeVideoStatsSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  publishedAt: z.string().datetime().nullable(),
  durationSec: z.number().nonnegative(),
  isShort: z.boolean(),
  privacy: z.enum(['public', 'unlisted', 'private', 'removed']),
  viewCount: z.number().nonnegative().nullable(),
  likeCount: z.number().nonnegative().nullable(),
  commentCount: z.number().nonnegative().nullable(),
  fetchedAt: z.string().datetime(),
  analytics: z.record(z.string(), z.object({
    views: z.number().nonnegative().nullable().optional(),
    estimatedMinutesWatched: z.number().nonnegative().nullable().optional(),
    averageViewDurationSec: z.number().nonnegative().nullable().optional(),
    averageViewPercentage: z.number().nonnegative().nullable().optional(),
    subscribersGained: z.number().nonnegative().nullable().optional(),
    subscribersLost: z.number().nonnegative().nullable().optional(),
    impressions: z.number().nonnegative().nullable().optional(),
    impressionsClickThroughRate: z.number().nonnegative().nullable().optional(),
  }).strict()).default({}),
}).strict();
export type YoutubeVideoStats = z.infer<typeof YoutubeVideoStatsSchema>;

export const YoutubeRetentionCurveSchema = z.array(z.object({ ratio: z.number().min(0).max(1), watchRatio: z.number().nonnegative() }).strict());
export type YoutubeRetentionCurve = z.infer<typeof YoutubeRetentionCurveSchema>;

export const YoutubeChannelDailySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  views: z.number().nonnegative(),
  estimatedMinutesWatched: z.number().nonnegative(),
  subscribersGained: z.number(),
  subscribersLost: z.number(),
}).strict();
export type YoutubeChannelDaily = z.infer<typeof YoutubeChannelDailySchema>;
