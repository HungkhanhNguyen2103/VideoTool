import { z } from 'zod';
import { YoutubeChannelOptionSchema, YoutubeVideoStatsSchema, YoutubeChannelDailySchema, YoutubeSearchTermsBreakdownSchema, YoutubeTrafficBreakdownSchema } from '../../../contracts/youtube';
import { YOUTUBE_GROWTH_PLAN_DEFAULTS, YoutubeGrowthExperimentSchema, YoutubeGrowthPlanConfigSchema } from '../../../contracts/youtube-plan';
import { YoutubeChannelReviewV2AnalysisSchema, YoutubeReviewBackendSchema, YoutubeReviewGroundingReportSchema, YoutubeReviewIdeaSchema, YoutubeReviewPacketSummarySchema, YoutubeVideoReviewV2AnalysisSchema } from '../../../contracts/youtube-review';

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
  openerOrigin: z.string().url().optional(),
  lastSyncReport: z.record(z.string(), z.object({ status: z.enum(['ok', 'unavailable', 'error']), message: z.string().optional() }).strict()).optional(),
}).strict();
export type YoutubeCredentialDoc = z.infer<typeof YoutubeCredentialDocSchema>;

export const YoutubePendingImportDocSchema = z.object({
  _id: z.string(),
  schemaVersion: z.literal(1),
  kind: z.literal('pending-import'),
  refreshToken: EncryptedRefreshTokenSchema,
  channelOptions: z.array(YoutubeChannelOptionSchema),
  expiresAt: z.date(),
  openerOrigin: z.string().url().optional(),
}).strict();
export type YoutubePendingImportDoc = z.infer<typeof YoutubePendingImportDocSchema>;
export type YoutubeStoredCredentialDoc = YoutubeCredentialDoc | YoutubePendingImportDoc;

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

export const YoutubeReviewV2DocSchema = z.object({
  _id: z.string(),
  channelProfileId: z.string(),
  target: z.enum(['channel', 'video']),
  targetId: z.string(),
  promptVersion: z.enum(['youtube-review-v2-channel', 'youtube-review-v2-video']),
  backend: YoutubeReviewBackendSchema,
  model: z.string().min(1),
  dataFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  packetSummary: YoutubeReviewPacketSummarySchema,
  groundingReport: YoutubeReviewGroundingReportSchema,
  metricMap: z.record(z.string(), z.object({ value: z.number().finite(), unit: z.string(), label: z.string(), assumed: z.boolean().optional() }).strict()),
  analysis: z.union([YoutubeChannelReviewV2AnalysisSchema, YoutubeVideoReviewV2AnalysisSchema]),
  ideas: z.object({ status: z.enum(['generated', 'gated']), reason: z.string().optional(), items: z.array(YoutubeReviewIdeaSchema).max(5) }).strict().optional(),
  generatedAt: z.date(),
}).strict();
export type YoutubeReviewV2Doc = z.infer<typeof YoutubeReviewV2DocSchema>;
export const YoutubeStoredReviewDocSchema = z.union([YoutubeReviewDocSchema, YoutubeReviewV2DocSchema]);
export type YoutubeStoredReviewDoc = z.infer<typeof YoutubeStoredReviewDocSchema>;

export const YoutubeChannelTrafficDocSchema = z.object({
  _id: z.string(),
  channelProfileId: z.string(),
  last28d: YoutubeTrafficBreakdownSchema.nullable().optional(),
  lifetime: YoutubeTrafficBreakdownSchema.nullable().optional(),
  searchTerms: z.object({
    last28d: YoutubeSearchTermsBreakdownSchema.nullable().optional(),
    lifetime: YoutubeSearchTermsBreakdownSchema.nullable().optional(),
  }).strict().default({}),
}).strict();
export type YoutubeChannelTrafficDoc = z.infer<typeof YoutubeChannelTrafficDocSchema>;

export const YoutubeGrowthPlanDocSchema = YoutubeGrowthPlanConfigSchema.extend({
  _id: z.string(),
  channelProfileId: z.string(),
  experiments: z.array(YoutubeGrowthExperimentSchema).max(YOUTUBE_GROWTH_PLAN_DEFAULTS.experimentLimit).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type YoutubeGrowthPlanDoc = z.infer<typeof YoutubeGrowthPlanDocSchema>;
