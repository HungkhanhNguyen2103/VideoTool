import { z } from 'zod';

export const CHAPTER_STATUSES = ['pending', 'generating', 'approved', 'needs-fix'] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

export const NARRATIVE_ROLES = ['hook', 'context', 'rising', 'climax', 'resolution'] as const;
export type NarrativeRole = (typeof NARRATIVE_ROLES)[number];

export const OpenLoopSchema = z.object({
  question: z.string(),
  plantedInChapter: z.number().int().positive(),
  resolvedInChapter: z.number().int().positive(),
});
export type OpenLoop = z.infer<typeof OpenLoopSchema>;

export const HubrisMotifSchema = z.object({
  hunter: z.string(),
  perfectPlan: z.string(),
  blindSpot: z.string(),
  selfDestruction: z.string(),
});
export type HubrisMotif = z.infer<typeof HubrisMotifSchema>;

export const ChapterDocSchema = z.object({
  id: z.string(),
  no: z.number().int(),
  title: z.string(),
  // Keep persisted chapter data tolerant for legacy blank paragraphs; finalization and patchChapter
  // normalize/reject them at the workflow boundary, while AI output schemas reject them up front.
  paragraphs: z.array(z.string()),
  status: z.enum(CHAPTER_STATUSES),
  scenesCount: z.number().int().nonnegative().nullable(),
  durationSec: z.number().nonnegative().nullable(),
  role: z.enum(NARRATIVE_ROLES).nullable().default(null),
  beat: z.string().default(''),
  targetWords: z.number().int().positive().nullable().default(null),
  endsOnTension: z.boolean().default(false),
  sourceFacts: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
  holdBack: z.array(z.string().trim().min(1).max(200)).max(4).optional(),
  chapterSummary: z.string().max(250).nullable().default(null),
  avoidRepeating: z.array(z.string().max(80)).max(5).default([]),
  persistentFacts: z.array(z.string().max(120)).max(10).default([]),
  reviewStatus: z.enum(['clean', 'upstream-changed']).default('clean'),
});
export type ChapterDoc = z.input<typeof ChapterDocSchema>;

export const ScriptQualityChapterSummarySchema = z.object({
  chapterNo: z.number().int().positive(),
  title: z.string(),
  words: z.number().int().nonnegative(),
  targetWords: z.number().int().nonnegative(),
  differenceWords: z.number().int(),
  deviationPct: z.number(),
  outsideLengthRange: z.boolean(),
});

export const ScriptQualityActShareSchema = z.object({
  act: z.number().int().positive(),
  role: z.string(),
  actualPct: z.number(),
  targetPct: z.number(),
  differencePctPoints: z.number(),
  outsideTolerance: z.boolean(),
});

export const ScriptQualitySummarySchema = z.object({
  totalWords: z.number().int().nonnegative(),
  targetWords: z.number().int().nonnegative(),
  differenceWords: z.number().int(),
  targetPercent: z.number(),
  outsideLengthRange: z.boolean(),
  plannedWords: z.number().int().nonnegative(),
  plannedDifferenceWords: z.number().int(),
  plannedDeviationPct: z.number(),
  plannedBudgetWarning: z.boolean(),
  actShares: z.array(ScriptQualityActShareSchema),
  chapters: z.array(ScriptQualityChapterSummarySchema),
  warnings: z.array(z.string()),
});
export type ScriptQualitySummary = z.infer<typeof ScriptQualitySummarySchema>;

export const ChapterSnapshotSchema = z.object({
  takenAt: z.date(),
  chapters: z.array(ChapterDocSchema),
});
export type ChapterSnapshot = z.input<typeof ChapterSnapshotSchema>;

export const NARRATION_WORDS_PER_MINUTE = 150;

export function countNarrationWords(text: string): number {
  return text.match(/\S+/gu)?.length ?? 0;
}

export function estimateNarrationDurationSec(text: string): number {
  return Math.max(1, Math.round(countNarrationWords(text) / NARRATION_WORDS_PER_MINUTE * 60));
}

export function getReferenceCoverage(referencesText: string, targetDurationSec: number): {
  referenceCharacters: number;
  targetMinutes: number;
  charactersPerMinute: number;
  shouldWarn: boolean;
} {
  const referenceCharacters = referencesText.trim().length;
  const targetMinutes = targetDurationSec / 60;
  const charactersPerMinute = targetMinutes > 0 ? Math.round(referenceCharacters / targetMinutes) : 0;
  return {
    referenceCharacters,
    targetMinutes,
    charactersPerMinute,
    shouldWarn: charactersPerMinute < 500,
  };
}
