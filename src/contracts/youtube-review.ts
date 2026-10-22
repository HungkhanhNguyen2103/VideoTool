import { z } from 'zod';

export const YoutubeReviewBackendSchema = z.enum(['cli', 'api']);
export const YoutubeReviewVariableSchema = z.enum(['topic', 'title', 'thumbnail', 'hook', 'length', 'cadence', 'other']);
export const YoutubeReviewComparatorSchema = z.enum(['>=', '<=']);

export const YoutubeReviewRequestSchema = z.object({
  backend: YoutubeReviewBackendSchema.default('cli'),
  cliModel: z.string().min(1).optional(),
}).strict();
export type YoutubeReviewRequest = z.input<typeof YoutubeReviewRequestSchema>;

export const YoutubeReviewSuccessCriterionSchema = z.object({
  metricId: z.string().min(1),
  comparator: YoutubeReviewComparatorSchema,
  value: z.number().finite(),
  afterVideos: z.number().int().min(1).max(60),
}).strict();
export type YoutubeReviewSuccessCriterion = z.infer<typeof YoutubeReviewSuccessCriterionSchema>;

export const YoutubeReviewClaimSchema = z.object({
  text: z.string().min(1).max(400),
  metricIds: z.array(z.string().min(1)).min(1).max(6),
  videoIds: z.array(z.string().min(1)).max(20).optional(),
}).strict();
export type YoutubeReviewClaim = z.infer<typeof YoutubeReviewClaimSchema>;

export const YoutubeChannelReviewV2AnalysisSchema = z.object({
  summary: z.string().min(1).max(500),
  strengths: z.array(YoutubeReviewClaimSchema).max(6),
  weaknesses: z.array(YoutubeReviewClaimSchema).max(6),
  diagnosis: z.object({
    classification: z.enum(['niche', 'execution', 'unclear']),
    reasoning: z.string().min(1).max(500),
    metricIds: z.array(z.string().min(1)).max(6),
  }).strict(),
  actionPlan: z.array(z.object({
    step: z.string().min(1).max(400),
    variable: YoutubeReviewVariableSchema,
    why: z.string().min(1).max(400),
    metricIds: z.array(z.string().min(1)).min(1).max(6),
    successCriterion: YoutubeReviewSuccessCriterionSchema,
  }).strict()).max(4),
  limits: z.array(z.string().min(1).max(400)).max(6),
}).strict();
export type YoutubeChannelReviewV2Analysis = z.infer<typeof YoutubeChannelReviewV2AnalysisSchema>;

export const YoutubeVideoReviewV2AnalysisSchema = z.object({
  summary: z.string().min(1).max(500),
  strengths: z.array(YoutubeReviewClaimSchema).max(6),
  weaknesses: z.array(YoutubeReviewClaimSchema).max(6),
  retentionFindings: z.array(z.object({
    fromSec: z.number().nonnegative(),
    toSec: z.number().positive(),
    sceneIndexes: z.array(z.number().int().positive()).max(20),
    observation: z.string().min(1).max(400),
    suggestion: z.string().min(1).max(400),
  }).strict()).max(10),
  searchFindings: z.array(z.object({
    rank: z.number().int().positive(),
    observation: z.string().min(1).max(300),
    metricIds: z.array(z.string().min(1)).min(1).max(6),
  }).strict()).max(10),
  nextChange: z.object({
    variable: YoutubeReviewVariableSchema,
    why: z.string().min(1).max(400),
    metricIds: z.array(z.string().min(1)).min(1).max(6),
    successCriterion: YoutubeReviewSuccessCriterionSchema,
  }).strict(),
  limits: z.array(z.string().min(1).max(400)).max(6),
}).strict();
export type YoutubeVideoReviewV2Analysis = z.infer<typeof YoutubeVideoReviewV2AnalysisSchema>;

export const YoutubeReviewIdeaSchema = z.object({
  title: z.string().min(1).max(100),
  angle: z.string().min(1).max(300),
  basedOn: z.object({
    metricIds: z.array(z.string().min(1)).min(1).max(6),
    videoIds: z.array(z.string().min(1)).max(20).optional(),
    searchTermRanks: z.array(z.number().int().positive()).max(25).optional(),
  }).strict(),
  changedVariable: YoutubeReviewVariableSchema,
  hypothesis: z.string().min(1).max(400),
  successCriterion: YoutubeReviewSuccessCriterionSchema,
  risk: z.string().min(1).max(300),
}).strict();
export type YoutubeReviewIdea = z.infer<typeof YoutubeReviewIdeaSchema>;

export const YoutubeReviewIdeasAnalysisSchema = z.object({
  ideas: z.array(YoutubeReviewIdeaSchema).max(5),
}).strict();
export type YoutubeReviewIdeasAnalysis = z.infer<typeof YoutubeReviewIdeasAnalysisSchema>;

export const YoutubeReviewGroundingReportSchema = z.object({
  checked: z.number().int().nonnegative(),
  repaired: z.number().int().nonnegative(),
  dropped: z.array(z.object({ path: z.string(), reasons: z.array(z.string()) }).strict()),
}).strict();
export type YoutubeReviewGroundingReport = z.infer<typeof YoutubeReviewGroundingReportSchema>;

export const YoutubeReviewPacketSummarySchema = z.object({
  matureCount: z.number().int().nonnegative(),
  includedVideoCount: z.number().int().nonnegative(),
  truncatedVideoCount: z.number().int().nonnegative(),
}).strict();
export type YoutubeReviewPacketSummary = z.infer<typeof YoutubeReviewPacketSummarySchema>;

export const YoutubeReviewVideoContextSchema = z.object({
  mappingQuality: z.enum(['exact', 'approximate', 'none']),
  linkedProjectId: z.string().nullable(),
  retentionDrops: z.array(z.object({
    fromSec: z.number().nonnegative(),
    toSec: z.number().positive(),
    dropPercent: z.number().nonnegative(),
    sceneIndexes: z.array(z.number().int().positive()),
    narrationExcerpt: z.string().max(400),
  }).strict()),
  searchTerms: z.array(z.object({
    window: z.enum(['last28d', 'lifetime']),
    status: z.enum(['ok', 'unavailable', 'error']),
    terms: z.array(z.object({ rank: z.number().int().positive(), term: z.string().max(200), views: z.number().nonnegative().nullable(), share: z.number().nonnegative().nullable() }).strict()).max(25),
  }).strict()).max(2),
}).strict();
export type YoutubeReviewVideoContext = z.infer<typeof YoutubeReviewVideoContextSchema>;

export const YoutubeReviewV2ResultSchema = z.object({
  target: z.enum(['channel', 'video']),
  targetId: z.string().min(1),
  promptVersion: z.enum(['youtube-review-v2-channel', 'youtube-review-v2-video']),
  backend: YoutubeReviewBackendSchema,
  model: z.string().min(1),
  dataFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  packetSummary: YoutubeReviewPacketSummarySchema,
  groundingReport: YoutubeReviewGroundingReportSchema,
  generatedAt: z.string().datetime(),
  stale: z.boolean(),
  metricMap: z.record(z.string(), z.object({ value: z.number().finite(), unit: z.string(), label: z.string(), assumed: z.boolean().optional() }).strict()),
  analysis: z.union([YoutubeChannelReviewV2AnalysisSchema, YoutubeVideoReviewV2AnalysisSchema]),
  videoContext: YoutubeReviewVideoContextSchema.optional(),
  ideas: z.object({
    status: z.enum(['generated', 'gated']),
    reason: z.string().optional(),
    items: z.array(YoutubeReviewIdeaSchema).max(5),
  }).strict().optional(),
}).strict();
export type YoutubeReviewV2Result = z.infer<typeof YoutubeReviewV2ResultSchema>;
