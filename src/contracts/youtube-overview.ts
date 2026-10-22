import { z } from 'zod';
import { YoutubeChannelHealthSchema } from './youtube-analytics';
import { YoutubeConnectionSummarySchema } from './youtube';

const WindowMetricsSchema = z.object({
  views: z.number().nonnegative().nullable(),
  estimatedMinutesWatched: z.number().nonnegative().nullable(),
  subscribersGained: z.number().nullable(),
  subscribersLost: z.number().nullable(),
}).strict();

const TrendMetricSchema = z.object({
  current: z.number(),
  previous: z.number(),
  changePercent: z.number().nullable(),
}).strict();

const TrendSchema = z.object({
  views: TrendMetricSchema,
  watchMinutes: TrendMetricSchema,
  subscribers: TrendMetricSchema,
  tooFewData: z.boolean(),
}).strict();

export const YoutubeChannelOverviewRowSchema = z.object({
  channelId: z.string(),
  name: z.string(),
  handle: z.string().optional(),
  language: z.enum(['vi', 'en']),
  connection: YoutubeConnectionSummarySchema,
  subscriberCount: z.number().nonnegative().nullable(),
  videoCount: z.number().int().nonnegative(),
  longCount: z.number().int().nonnegative(),
  shortCount: z.number().int().nonnegative(),
  last28: WindowMetricsSchema,
  previous28: WindowMetricsSchema,
  trend: TrendSchema,
  health: YoutubeChannelHealthSchema,
  activeSyncJobId: z.string().nullable(),
  topVideo: z.object({ videoId: z.string(), title: z.string(), viewsPerDay: z.number().nonnegative() }).strict().nullable(),
}).strict();
export type YoutubeChannelOverviewRow = z.infer<typeof YoutubeChannelOverviewRowSchema>;

export const YoutubeChannelsOverviewTotalsSchema = z.object({
  subscriberCount: z.number().nonnegative().nullable(),
  views28: z.number().nonnegative().nullable(),
  watchHours28: z.number().nonnegative().nullable(),
  subscribersGained28: z.number().nullable(),
  channelsConnected: z.number().int().nonnegative(),
  channelsNeedReconnect: z.number().int().nonnegative(),
}).strict();

export const YoutubeChannelsOverviewSchema = z.object({
  channels: z.array(YoutubeChannelOverviewRowSchema),
  totals: YoutubeChannelsOverviewTotalsSchema,
}).strict();
export type YoutubeChannelsOverview = z.infer<typeof YoutubeChannelsOverviewSchema>;

export const YoutubeSyncAllResultSchema = z.object({
  results: z.array(z.object({
    channelId: z.string(),
    jobId: z.string().nullable(),
    skipped: z.enum(['not-connected', 'needs-reconnect', 'already-running', 'quota']).optional(),
    message: z.string().optional(),
  }).strict()),
}).strict();
export type YoutubeSyncAllResult = z.infer<typeof YoutubeSyncAllResultSchema>;
