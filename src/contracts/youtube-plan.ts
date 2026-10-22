import { z } from 'zod';

// gợi ý của người dùng/Claude, chưa kiểm chứng: these defaults are starting assumptions, not YouTube benchmarks.
export const YOUTUBE_GROWTH_PLAN_DEFAULTS = {
  cadencePerWeek: 3.5,
  cadencePerWeekMin: 0.5,
  cadencePerWeekMax: 14,
  firstViewTarget: 500,
  strongViewTarget: 1_000,
  assumedAvgViewDurationMin: 4,
  assumedAvgViewDurationMinMin: 0.1,
  assumedAvgViewDurationMinMax: 720,
  toleranceMonths: 18,
  toleranceMonthsMin: 1,
  toleranceMonthsMax: 60,
  warnAtMatureVideos: 15,
  decideAtMatureVideos: 40,
  decideMinMonths: 4,
  hardReviewWeek: 26,
  minExperimentsBeforeStop: 2,
  experimentLimit: 100,
  experimentNoteMaxLength: 300,
  videoIdsPerExperimentMax: 500,
} as const;

export const MIN_IMPRESSIONS_FOR_CTR = 1_000;

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Ngày phải có thật và theo định dạng YYYY-MM-DD.');

export const YoutubeGrowthPlanConfigSchema = z.object({
  nicheStartDate: IsoDateSchema.nullable().default(null),
  cadencePerWeek: z.number().min(YOUTUBE_GROWTH_PLAN_DEFAULTS.cadencePerWeekMin).max(YOUTUBE_GROWTH_PLAN_DEFAULTS.cadencePerWeekMax).default(YOUTUBE_GROWTH_PLAN_DEFAULTS.cadencePerWeek),
  viewTargets: z.object({
    first: z.number().int().positive().default(YOUTUBE_GROWTH_PLAN_DEFAULTS.firstViewTarget),
    strong: z.number().int().positive().default(YOUTUBE_GROWTH_PLAN_DEFAULTS.strongViewTarget),
  }).strict().default({ first: YOUTUBE_GROWTH_PLAN_DEFAULTS.firstViewTarget, strong: YOUTUBE_GROWTH_PLAN_DEFAULTS.strongViewTarget }).superRefine((targets, ctx) => {
    if (targets.first >= targets.strong) ctx.addIssue({ code: 'custom', path: ['strong'], message: 'Mốc mạnh phải cao hơn mốc đầu tiên.' });
  }),
  assumedAvgViewDurationMin: z.number().min(YOUTUBE_GROWTH_PLAN_DEFAULTS.assumedAvgViewDurationMinMin).max(YOUTUBE_GROWTH_PLAN_DEFAULTS.assumedAvgViewDurationMinMax).default(YOUTUBE_GROWTH_PLAN_DEFAULTS.assumedAvgViewDurationMin),
  toleranceMonths: z.number().int().min(YOUTUBE_GROWTH_PLAN_DEFAULTS.toleranceMonthsMin).max(YOUTUBE_GROWTH_PLAN_DEFAULTS.toleranceMonthsMax).default(YOUTUBE_GROWTH_PLAN_DEFAULTS.toleranceMonths),
  warnAtMatureVideos: z.number().int().positive().default(YOUTUBE_GROWTH_PLAN_DEFAULTS.warnAtMatureVideos),
  decideAtMatureVideos: z.number().int().positive().default(YOUTUBE_GROWTH_PLAN_DEFAULTS.decideAtMatureVideos),
  decideMinMonths: z.number().int().positive().default(YOUTUBE_GROWTH_PLAN_DEFAULTS.decideMinMonths),
  hardReviewWeek: z.number().int().positive().default(YOUTUBE_GROWTH_PLAN_DEFAULTS.hardReviewWeek),
  minExperimentsBeforeStop: z.number().int().nonnegative().default(YOUTUBE_GROWTH_PLAN_DEFAULTS.minExperimentsBeforeStop),
  submittedForReviewAt: IsoDateSchema.nullable().default(null),
}).strict();
export type YoutubeGrowthPlanConfig = z.infer<typeof YoutubeGrowthPlanConfigSchema>;

export const YoutubeGrowthExperimentVariableSchema = z.enum(['topic', 'title', 'thumbnail', 'hook', 'length', 'cadence', 'other']);
export const YoutubeGrowthExperimentInputSchema = z.object({
  date: IsoDateSchema,
  variable: YoutubeGrowthExperimentVariableSchema,
  note: z.string().max(YOUTUBE_GROWTH_PLAN_DEFAULTS.experimentNoteMaxLength),
  videoIds: z.array(z.string().min(1)).max(YOUTUBE_GROWTH_PLAN_DEFAULTS.videoIdsPerExperimentMax).optional(),
}).strict();
export const YoutubeGrowthExperimentSchema = YoutubeGrowthExperimentInputSchema.extend({ id: z.string().min(1) }).strict();
export type YoutubeGrowthExperiment = z.infer<typeof YoutubeGrowthExperimentSchema>;

export const YoutubeGrowthPlanSchema = YoutubeGrowthPlanConfigSchema.extend({
  channelProfileId: z.string().min(1),
  experiments: z.array(YoutubeGrowthExperimentSchema).max(YOUTUBE_GROWTH_PLAN_DEFAULTS.experimentLimit).default([]),
  createdAt: z.string().datetime().nullable().default(null),
  updatedAt: z.string().datetime().nullable().default(null),
}).strict();
export type YoutubeGrowthPlan = z.infer<typeof YoutubeGrowthPlanSchema>;

export const YoutubePlanMetricSchema = z.object({
  value: z.number().nullable(),
  unit: z.string(),
  label: z.string(),
  assumed: z.boolean().optional(),
}).strict();
export const YoutubeGrowthHitRateSchema = z.object({
  hits: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  rate: z.number().min(0).max(1).nullable(),
  low: z.number().min(0).max(1).nullable(),
  high: z.number().min(0).max(1).nullable(),
  videosUntilHit: z.object({ min: z.number().positive(), max: z.number().positive() }).strict().nullable(),
  ruleOfThreeUpperBound: z.number().min(0).max(1).nullable(),
  approximate: z.boolean(),
  message: z.string().optional(),
}).strict();

export const YoutubeGrowthDistributionSchema = z.object({
  measuredCount: z.number().int().nonnegative(),
  approximateCount: z.number().int().nonnegative(),
  unknownMatureCount: z.number().int().nonnegative(),
  median: z.number().nonnegative().nullable(),
  mean: z.number().nonnegative().nullable(),
  max: z.number().nonnegative().nullable(),
  p25: z.number().nonnegative().nullable(),
  p75: z.number().nonnegative().nullable(),
  last10Median: z.number().nonnegative().nullable(),
  weightedAvgViewDurationMin: z.number().nonnegative().nullable(),
  avgViewDurationAssumed: z.boolean(),
  subscribersPerThousandViews: z.number().nonnegative().nullable(),
  earlyRetentionDropFraction: z.number().min(0).max(1).nullable(),
  retentionMeasuredCount: z.number().int().nonnegative(),
}).strict();

export const YoutubeGrowthRequiredViewsSchema = z.object({
  watchHoursTarget: z.number().positive(),
  plannedVideosPerYear: z.number().positive(),
  avgViewDurationMin: z.number().positive(),
  avgViewDurationAssumed: z.boolean(),
  hoursViewsPerVideo: z.number().nonnegative(),
  subscribersViewsPerVideo: z.number().nonnegative().nullable(),
  binding: z.enum(['watch-hours', 'subscribers', 'both', 'unknown']),
  bindingViewsPerVideo: z.number().nonnegative().nullable(),
  gapToMedian: z.object({ absolute: z.number().nullable(), ratio: z.number().nonnegative().nullable() }).strict(),
  gapToP75: z.object({ absolute: z.number().nullable(), ratio: z.number().nonnegative().nullable() }).strict(),
}).strict();

const ForecastScenarioSchema = z.object({
  slopeViewsPerVideo: z.number(),
  week: z.number().int().positive().nullable(),
  date: IsoDateSchema.nullable(),
  beyondTolerance: z.boolean(),
}).strict();
export const YoutubeGrowthForecastSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('insufficient-data'), reason: z.string() }).strict(),
  z.object({
    status: z.literal('ready'),
    optimistic: ForecastScenarioSchema,
    central: ForecastScenarioSchema,
    pessimistic: ForecastScenarioSchema,
    tailFactor: z.number().nonnegative(),
    tailFactorAssumed: z.boolean(),
    horizonWeeks: z.number().int().positive(),
  }).strict(),
]);
export type YoutubeGrowthForecast = z.infer<typeof YoutubeGrowthForecastSchema>;

export const YoutubeGrowthCheckpointSchema = z.object({
  id: z.enum(['a_review', 'warning', 'decision', 'hard_review']),
  label: z.string(),
  status: z.enum(['upcoming', 'reached', 'passed']),
  estimatedDate: IsoDateSchema.nullable(),
  matureVideoTarget: z.number().int().positive().nullable(),
  evaluate: z.string(),
}).strict();

export const YoutubeGrowthStageSchema = z.object({
  current: z.enum(['A', 'B', 'C', 'D', 'E']),
  next: z.enum(['A', 'B', 'C', 'D', 'E']).nullable(),
  label: z.string(),
  unmetConditions: z.array(z.string()),
}).strict();
export const YoutubeGrowthVerdictSchema = z.object({
  verdict: z.enum(['insufficient_data', 'continue', 'change_one_variable', 'consider_stop']),
  reasons: z.array(z.object({ text: z.string(), metricIds: z.array(z.string()) }).strict()),
  unknowns: z.array(z.string()),
  confidence: z.enum(['low', 'medium', 'high']),
  nextCheckpoint: z.enum(['a_review', 'warning', 'decision', 'hard_review']).nullable(),
  forecastReviewText: z.string().optional(),
}).strict();

const PartnerTierSchema = z.object({ subscribers: z.number(), longWatchHours: z.number(), shortViews: z.number() }).strict();
const PartnerThresholdPeriodSchema = z.object({ entryTier: PartnerTierSchema, ads: PartnerTierSchema }).strict();
export const YoutubeGrowthThresholdsSchema = z.object({
  checkedOn: IsoDateSchema,
  referenceLabel: z.string(),
  sourceUrls: z.array(z.string().url()),
  current: PartnerThresholdPeriodSchema,
  from2027_02_01: PartnerThresholdPeriodSchema,
  longWatchWindowDays: z.number().int().positive(),
  shortsViewWindowDays: z.number().int().positive(),
  qualifyingWatchHours: z.string(),
}).strict();

export const YoutubeGrowthPendingVideoSchema = z.object({ videoId: z.string(), title: z.string(), publishedAt: IsoDateSchema, maturesOn: IsoDateSchema }).strict();
export const YoutubeGrowthPlanVideoSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  publishedAt: IsoDateSchema,
  first28dViews: z.number().nonnegative().nullable(),
  approximate: z.boolean(),
  metricId: z.string(),
}).strict();
export const YoutubeGrowthPlanStatusSchema = z.object({
  plan: YoutubeGrowthPlanSchema,
  eligibleVideoCount: z.number().int().nonnegative(),
  matureCount: z.number().int().nonnegative(),
  videos: z.array(YoutubeGrowthPlanVideoSchema),
  pending: z.array(YoutubeGrowthPendingVideoSchema),
  distribution: YoutubeGrowthDistributionSchema,
  hitRates: z.object({ first: YoutubeGrowthHitRateSchema, strong: YoutubeGrowthHitRateSchema }).strict(),
  requiredViews: YoutubeGrowthRequiredViewsSchema,
  forecast: YoutubeGrowthForecastSchema,
  stage: YoutubeGrowthStageSchema,
  checkpoints: z.array(YoutubeGrowthCheckpointSchema),
  verdict: YoutubeGrowthVerdictSchema,
  metrics: z.record(z.string(), YoutubePlanMetricSchema),
  assumptions: z.array(z.string()),
  thresholds: YoutubeGrowthThresholdsSchema,
  submittedForReviewAt: IsoDateSchema.nullable(),
}).strict();
export type YoutubeGrowthPlanStatus = z.infer<typeof YoutubeGrowthPlanStatusSchema>;
