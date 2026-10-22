import { z } from 'zod';
import { CLAUDE_CLI_DEFAULT_MODEL } from './claude-cli';
import { SCRIPT_PRESET_IDS } from './project';
import { YoutubeReviewVariableSchema } from './youtube-review';

export const NEXT_VIDEO_IDEAS_MIN_MATURE = 10;
export const IDEA_DEFAULT_CLI_MODEL = CLAUDE_CLI_DEFAULT_MODEL;
export const YOUTUBE_IDEA_EVIDENCE_TIERS = ['no-performance-data', 'weak-signal', 'data-informed'] as const;
export const YoutubeIdeaEvidenceTierSchema = z.enum(YOUTUBE_IDEA_EVIDENCE_TIERS);
export type YoutubeIdeaEvidenceTier = z.infer<typeof YoutubeIdeaEvidenceTierSchema>;

export const YoutubeIdeaBackendSchema = z.enum(['cli', 'api']);
export const YoutubeIdeaStatusSchema = z.enum(['new', 'chosen', 'rejected', 'used']);
export type YoutubeIdeaStatus = z.infer<typeof YoutubeIdeaStatusSchema>;
export function canTransitionYoutubeIdeaStatus(from: YoutubeIdeaStatus, to: YoutubeIdeaStatus): boolean {
  if (from === to) return true;
  if (from === 'used') return false;
  if (to === 'used') return false;
  return from === 'new' || from === 'chosen' || from === 'rejected';
}
export const YoutubeIdeaMotifEvidenceSchema = z.object({ text: z.string().trim().min(1).max(300), evidence: z.enum(['strong', 'partial', 'thin']) }).strict();
export const YoutubeIdeaMotifSchema = z.object({
  hunter: YoutubeIdeaMotifEvidenceSchema,
  perfectPlan: YoutubeIdeaMotifEvidenceSchema,
  blindSpot: YoutubeIdeaMotifEvidenceSchema,
  selfDestruction: YoutubeIdeaMotifEvidenceSchema,
}).strict();

export const YoutubeIdeaScoresSchema = z.object({
  fit: z.number().int().min(0).max(5),
  clarity: z.number().int().min(0).max(5),
  riskOfThinSources: z.number().int().min(0).max(5),
}).strict();

function hasFiveToEightSentences(value: string): boolean {
  const sentences = value.trim().split(/(?<=[.!?。！？])\s+/u).filter((sentence) => sentence.trim().length > 0);
  return sentences.length >= 5 && sentences.length <= 8;
}

export const YoutubeIdeaDraftSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(100),
  hook: z.string().trim().min(1).max(300),
  brief: z.string().trim().min(10).max(1200).refine(hasFiveToEightSentences, 'Brief must contain 5–8 sentences.'),
  presetId: z.enum(SCRIPT_PRESET_IDS),
  motif: YoutubeIdeaMotifSchema.optional(),
  whyForThisChannel: z.string().trim().min(1).max(300),
  testVariable: YoutubeReviewVariableSchema,
  successCriterion: z.object({ description: z.string().trim().min(1).max(400), afterVideos: z.number().int().min(1).max(60) }).strict(),
  unverifiedFacts: z.array(z.string().trim().min(1).max(300)).max(8),
  risks: z.array(z.string().trim().min(1).max(300)).max(4),
  rarityGuess: z.enum(['common', 'uncommon', 'rare', 'unknown']).optional(),
  evidenceTier: YoutubeIdeaEvidenceTierSchema,
  suggestedDurationSec: z.number().int().min(30).max(3600),
  suggestedChapterCount: z.number().int().min(1).max(20).nullable(),
}).strict();
export type YoutubeIdeaDraft = z.infer<typeof YoutubeIdeaDraftSchema>;

export const YoutubeIdeaSchema = YoutubeIdeaDraftSchema.extend({ scores: YoutubeIdeaScoresSchema }).strict();
export type YoutubeIdea = z.infer<typeof YoutubeIdeaSchema>;

export const YoutubeIdeaHunterArchetypeSchema = z.enum(['military', 'political', 'economic', 'technological', 'diplomatic', 'institutional', 'other']);
export const YoutubeIdeaFamousnessGuessSchema = z.enum(['famous', 'known', 'obscure', 'unknown']);
export const YoutubeIdeaClaimSchema = z.object({
  text: z.string().trim().min(1).max(160),
  confidence: z.enum(['high', 'medium', 'low']),
}).strict();
export const YoutubeIdeaTrapSchema = z.object({
  hunterBelief: z.string().trim().min(1).max(200),
  outsideVariable: z.string().trim().min(1).max(200),
  exploitedBy: z.string().trim().min(1).max(200),
  advantageThatBackfired: z.string().trim().min(1).max(200),
}).strict();

export const YoutubeIdeaV2DraftSchema = z.object({
  id: z.string().trim().min(1).max(80),
  episode: z.string().trim().min(1).max(160),
  period: z.string().trim().min(1).max(80),
  place: z.string().trim().min(1).max(100),
  hunterArchetype: YoutubeIdeaHunterArchetypeSchema,
  famousnessGuess: YoutubeIdeaFamousnessGuessSchema,
  famousnessFallback: z.boolean(),
  angle: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(100),
  hook: z.string().trim().min(1).max(300),
  brief: z.string().trim().min(10).max(1200).refine(hasFiveToEightSentences, 'Brief must contain 5–8 sentences.'),
  presetId: z.enum(SCRIPT_PRESET_IDS),
  motif: YoutubeIdeaMotifSchema,
  trap: YoutubeIdeaTrapSchema,
  trapSketch: z.string().trim().min(1).max(280),
  whyForThisChannel: z.string().trim().min(1).max(300),
  testVariable: z.literal('topic'),
  successCriterion: z.object({ description: z.string().trim().min(1).max(400), afterVideos: z.number().int().min(1).max(60) }).strict(),
  claims: z.array(YoutubeIdeaClaimSchema).max(20),
  risks: z.array(z.string().trim().min(1).max(300)).max(4),
  rarityGuess: z.enum(['common', 'uncommon', 'rare', 'unknown']).optional(),
  evidenceTier: YoutubeIdeaEvidenceTierSchema,
  suggestedDurationSec: z.number().int().min(30).max(3600),
  suggestedChapterCount: z.number().int().min(1).max(20).nullable(),
}).strict();
export type YoutubeIdeaV2Draft = z.infer<typeof YoutubeIdeaV2DraftSchema>;
export const YoutubeIdeaV2Schema = YoutubeIdeaV2DraftSchema.extend({ scores: YoutubeIdeaScoresSchema }).strict();
export type YoutubeIdeaV2 = z.infer<typeof YoutubeIdeaV2Schema>;
export const YoutubeIdeaStoredSchema = z.union([YoutubeIdeaSchema, YoutubeIdeaV2Schema]);
export type YoutubeIdeaStored = z.infer<typeof YoutubeIdeaStoredSchema>;

export const YoutubeIdeaManualDemandInputSchema = z.object({ note: z.string().trim().min(1).max(300) }).strict();
export const YoutubeIdeaManualDemandSchema = YoutubeIdeaManualDemandInputSchema.extend({ checkedAt: z.string().datetime() }).strict();

export const YoutubeIdeasGenerateRequestSchema = z.object({
  backend: YoutubeIdeaBackendSchema.default('cli'),
  cliModel: z.string().trim().min(1).optional(),
  steering: z.string().max(500).default(''),
  presetId: z.enum(SCRIPT_PRESET_IDS).default('hubris-trap'),
  count: z.number().int().min(4).max(8).default(6),
  targetDurationSec: z.number().int().min(30).max(3600).default(600),
}).strict();
export type YoutubeIdeasGenerateRequest = z.infer<typeof YoutubeIdeasGenerateRequestSchema>;

export const YoutubeIdeaStatusPatchSchema = z.object({
  status: z.enum(['new', 'chosen', 'rejected']).optional(),
  statusNote: z.string().trim().max(300).nullable().optional(),
  manualDemand: YoutubeIdeaManualDemandInputSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');
export type YoutubeIdeaStatusPatch = z.infer<typeof YoutubeIdeaStatusPatchSchema>;

export const YoutubeIdeaDroppedSchema = z.object({ id: z.string().min(1).max(80), reason: z.string().min(1).max(300) }).strict();
export type YoutubeIdeaDropped = z.infer<typeof YoutubeIdeaDroppedSchema>;
export const YoutubeIdeaPacketSummarySchema = z.object({
  projectCount: z.number().int().nonnegative(),
  syncedVideoCount: z.number().int().nonnegative(),
  savedIdeaCount: z.number().int().nonnegative(),
  matureVideoCount: z.number().int().nonnegative(),
}).strict();
export const YoutubeIdeaRunDurationsSchema = z.object({ generateMs: z.number().int().nonnegative(), critiqueMs: z.number().int().nonnegative(), totalMs: z.number().int().nonnegative() }).strict();
export const YoutubeIdeaV2RunDurationsSchema = z.object({ seedsMs: z.number().int().nonnegative(), selectMs: z.number().int().nonnegative(), expandMs: z.number().int().nonnegative(), totalMs: z.number().int().nonnegative() }).strict();
export const YoutubeIdeaStoredRunDurationsSchema = z.union([YoutubeIdeaRunDurationsSchema, YoutubeIdeaV2RunDurationsSchema]);
export const YoutubeIdeaRunStatusSchema = z.enum(['complete', 'partial']);

export const YoutubeIdeaRunSummarySchema = z.object({
  id: z.string().min(1),
  evidenceTier: YoutubeIdeaEvidenceTierSchema,
  backend: YoutubeIdeaBackendSchema,
  model: z.string().min(1),
  promptVersion: z.enum(['video-ideas-v1', 'video-ideas-v2']),
  generatedAt: z.string().datetime(),
  requestedCount: z.number().int().min(4).max(8),
  status: YoutubeIdeaRunStatusSchema.optional(),
  packetSummary: YoutubeIdeaPacketSummarySchema,
  coverageFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  dropped: z.array(YoutubeIdeaDroppedSchema).max(30),
  durations: YoutubeIdeaStoredRunDurationsSchema,
}).strict();
export type YoutubeIdeaRunSummary = z.infer<typeof YoutubeIdeaRunSummarySchema>;

export const YoutubeIdeaRecordSchema = z.object({
  id: z.string().min(1),
  channelProfileId: z.string().min(1),
  runId: z.string().min(1),
  evidenceTier: YoutubeIdeaEvidenceTierSchema,
  backend: YoutubeIdeaBackendSchema,
  model: z.string().min(1),
  promptVersion: z.enum(['video-ideas-v1', 'video-ideas-v2']),
  generatedAt: z.string().datetime(),
  idea: YoutubeIdeaStoredSchema,
  status: YoutubeIdeaStatusSchema,
  statusNote: z.string().max(300).optional(),
  usedProjectId: z.string().min(1).optional(),
  manualDemand: YoutubeIdeaManualDemandSchema.optional(),
}).strict();
export type YoutubeIdeaRecord = z.infer<typeof YoutubeIdeaRecordSchema>;

export const YoutubeIdeasListResponseSchema = z.object({
  ideas: z.array(YoutubeIdeaRecordSchema).max(200),
  latestRun: YoutubeIdeaRunSummarySchema.nullable(),
  currentTier: YoutubeIdeaEvidenceTierSchema,
  matureVideoCount: z.number().int().nonnegative(),
  minimumMatureForDataInformed: z.literal(NEXT_VIDEO_IDEAS_MIN_MATURE),
  currentCoverageFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  stale: z.boolean(),
}).strict();
export type YoutubeIdeasListResponse = z.infer<typeof YoutubeIdeasListResponseSchema>;

export const YoutubeIdeasGenerateResponseSchema = z.object({ jobId: z.string().min(1) }).strict();
export const YoutubeIdeasJobPayloadSchema = YoutubeIdeasGenerateRequestSchema.extend({ channelId: z.string().min(1) }).strict();
export type YoutubeIdeasJobPayload = z.infer<typeof YoutubeIdeasJobPayloadSchema>;
export const YoutubeIdeaCreateProjectRequestSchema = z.object({ projectId: z.string().min(1).optional() }).strict();
export const YoutubeIdeaProjectPrefillSchema = z.object({
  title: z.string().min(1).max(100),
  language: z.enum(['vi', 'en']),
  brief: z.string().min(10).max(1200),
  referencesText: z.literal(''),
  scriptPresetId: z.enum(SCRIPT_PRESET_IDS),
  targetDurationSec: z.number().int().min(30).max(3600),
  chapterCount: z.number().int().min(1).max(20).nullable(),
  channelId: z.string().min(1),
  researchNote: z.literal('Chưa có nguồn: cần research có dẫn nguồn trước khi viết kịch bản'),
}).strict();
export type YoutubeIdeaProjectPrefill = z.infer<typeof YoutubeIdeaProjectPrefillSchema>;
export const YoutubeIdeaCreateProjectResponseSchema = z.object({ ideaId: z.string().min(1), prefill: YoutubeIdeaProjectPrefillSchema }).strict();
export type YoutubeIdeaCreateProjectResponse = z.infer<typeof YoutubeIdeaCreateProjectResponseSchema>;
