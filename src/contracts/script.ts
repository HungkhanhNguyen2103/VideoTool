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
  paragraphs: z.array(z.string()),
  status: z.enum(CHAPTER_STATUSES),
  scenesCount: z.number().int().nonnegative().nullable(),
  durationSec: z.number().nonnegative().nullable(),
  role: z.enum(NARRATIVE_ROLES).nullable().default(null),
  beat: z.string().default(''),
  targetWords: z.number().int().positive().nullable().default(null),
  endsOnTension: z.boolean().default(false),
});
export type ChapterDoc = z.input<typeof ChapterDocSchema>;

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
