import { z } from 'zod';
import {
  YoutubeChannelDailySchema,
  YoutubeConnectionSummarySchema,
  YoutubeRetentionCurveSchema,
  YoutubeVideoStatsSchema,
} from './youtube';

const RankingRowSchema = z.object({ videoId: z.string(), value: z.number() }).strict();

export const YoutubeReviewResultSchema = z.object({
  observations: z.array(z.string()),
  hypotheses: z.array(z.string()),
  experiments: z.array(z.string()),
}).strict();
export type YoutubeReviewResult = z.infer<typeof YoutubeReviewResultSchema>;

export const YoutubeReviewSchema = z.object({
  target: z.enum(['channel', 'video']),
  targetId: z.string(),
  promptVersion: z.string(),
  dataWindow: z.string(),
  result: YoutubeReviewResultSchema,
  generatedAt: z.string().datetime(),
}).strict();
export type YoutubeReview = z.infer<typeof YoutubeReviewSchema>;

const ThresholdValuesSchema = z.object({
  subscribers: z.number().nonnegative(),
  longWatchHours: z.number().nonnegative(),
  shortViews: z.number().nonnegative(),
}).strict();

const PartnerThresholdPairSchema = z.object({
  entryTier: ThresholdValuesSchema,
  ads: ThresholdValuesSchema,
}).strict();

export const YoutubePartnerThresholdsSchema = z.object({
  checkedOn: z.string().date(),
  sourceUrls: z.array(z.string().url()),
  current: PartnerThresholdPairSchema,
  from2027_02_01: PartnerThresholdPairSchema,
  // Added in Task 117: the same dated table now also carries window and label metadata.
  referenceLabel: z.string().optional(),
  longWatchWindowDays: z.number().int().positive().optional(),
  shortsViewWindowDays: z.number().int().positive().optional(),
  qualifyingWatchHours: z.string().optional(),
}).strict();
export type YoutubePartnerThresholds = z.infer<typeof YoutubePartnerThresholdsSchema>;

const PartnerProgressSchema = ThresholdValuesSchema.extend({
  publicLongWatchHours: z.number().nonnegative().nullable(),
  publicShortViews: z.number().nonnegative().nullable(),
  subscribersProgress: z.number().min(0).max(1).nullable(),
  watchHoursProgress: z.number().min(0).max(1).nullable(),
  shortViewsProgress: z.number().min(0).max(1).nullable(),
  eligible: z.boolean(),
}).strict();

const PartnerProgressPairSchema = z.object({
  entryTier: PartnerProgressSchema,
  ads: PartnerProgressSchema,
}).strict();

export const YoutubeChannelHealthSchema = z.object({
  subscribers: z.number().nonnegative().nullable(),
  publicLongWatchHours365d: z.number().nonnegative().nullable(),
  publicShortViews90d: z.number().nonnegative().nullable(),
  publicUploads90d: z.number().int().nonnegative().nullable(),
  current: PartnerProgressPairSchema,
  from2027_02_01: PartnerProgressPairSchema,
  note: z.literal('mốc tham khảo, kiểm tra lại trên YouTube Studio'),
}).strict();
export type YoutubeChannelHealth = z.infer<typeof YoutubeChannelHealthSchema>;

const CohortSchema = z.object({
  key: z.string(),
  dimension: z.string(),
  label: z.string(),
  n: z.number().int().nonnegative(),
  medianViewsPerDay: z.number().nullable(),
  medianAverageViewPercentage: z.number().nullable(),
  sampleWarning: z.literal('mẫu nhỏ — chưa kết luận').optional(),
}).strict();

const TrendMetricSchema = z.object({
  current: z.number(),
  previous: z.number(),
  changePercent: z.number().nullable(),
}).strict();

const YoutubeReviewStatusSchema = z.object({
  status: z.enum(['ok', 'unavailable', 'error']),
  message: z.string().optional(),
}).strict();

export const YoutubeChannelOverviewSchema = z.object({
  connection: YoutubeConnectionSummarySchema,
  daily: z.array(YoutubeChannelDailySchema),
  videoCount: z.number().int().nonnegative(),
  synced: z.boolean(),
  trend: z.object({ views: TrendMetricSchema, watchMinutes: TrendMetricSchema, subscribers: TrendMetricSchema, tooFewData: z.boolean() }).strict(),
  health: YoutubeChannelHealthSchema,
  thresholds: YoutubePartnerThresholdsSchema,
  rankings: z.object({
    viewsPerDay: z.array(RankingRowSchema),
    averageViewPercentage: z.array(RankingRowSchema),
    subscribersPerThousandViews: z.array(RankingRowSchema),
    clickThroughRate: z.array(RankingRowSchema),
  }).strict(),
  cohorts: z.array(CohortSchema),
  channelReview: YoutubeReviewSchema.nullable(),
  analyticsStatus: z.record(z.string(), YoutubeReviewStatusSchema),
}).strict();
export type YoutubeChannelOverview = z.infer<typeof YoutubeChannelOverviewSchema>;

const LinkedProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  scriptPresetId: z.string().optional(),
  visualStylePresetId: z.string().optional(),
}).strict();

const VideoRankingValuesSchema = z.object({
  viewsPerDay: z.number().nullable(),
  averageViewPercentage: z.number().nullable(),
  clickThroughRate: z.number().nullable(),
  subscribersPerThousandViews: z.number().nullable(),
}).strict();

export const YoutubeVideoListItemSchema = YoutubeVideoStatsSchema.extend({
  ranking: VideoRankingValuesSchema,
  linkedProject: LinkedProjectSchema.nullable(),
}).strict();
export type YoutubeVideoListItem = z.infer<typeof YoutubeVideoListItemSchema>;

export const YoutubeVideoDetailSchema = YoutubeVideoStatsSchema.extend({
  retentionCurve: YoutubeRetentionCurveSchema.nullable(),
  retentionUnavailableReason: z.string().optional(),
  channelComparison: z.object({
    videoViewsPerDay: z.number().nullable(),
    medianViewsPerDay: z.number().nullable(),
    viewsSampleSize: z.number().int().nonnegative(),
    videoAverageViewPercentage: z.number().nullable(),
    medianAverageViewPercentage: z.number().nullable(),
    averageViewSampleSize: z.number().int().nonnegative(),
  }).strict(),
  dropSegments: z.object({
    earlyDrop: z.boolean(),
    segments: z.array(z.object({ startSec: z.number(), endSec: z.number(), dropRatio: z.number(), dropPercent: z.number() }).strict()),
  }).nullable().optional(),
  linkedProject: LinkedProjectSchema.nullable(),
  review: YoutubeReviewSchema.nullable(),
}).strict();
export type YoutubeVideoDetail = z.infer<typeof YoutubeVideoDetailSchema>;

export const YoutubeSuggestedLinkSchema = z.object({
  projectId: z.string(),
  projectTitle: z.string(),
  chosenSeoTitle: z.string(),
  videoId: z.string(),
  videoTitle: z.string(),
  titleMatch: z.enum(['exact', 'containment', 'none']),
  publishDateDays: z.number(),
  score: z.number(),
  reasons: z.array(z.string()),
}).strict();
export type YoutubeSuggestedLink = z.infer<typeof YoutubeSuggestedLinkSchema>;

export const YoutubeAuthorizationStartSchema = z.object({ authorizationUrl: z.string().url() }).strict();
export const YoutubeJobStartSchema = z.object({ jobId: z.string() }).strict();
export const YoutubeActiveJobSchema = z.object({ jobId: z.string().nullable() }).strict();
export const YoutubeAnalyticsSyncReportSchema = z.record(z.string(), YoutubeReviewStatusSchema);
