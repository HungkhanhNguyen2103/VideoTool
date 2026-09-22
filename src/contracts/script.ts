import { z } from 'zod';

export const CHAPTER_STATUSES = ['pending', 'generating', 'approved', 'needs-fix'] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

export const ChapterDocSchema = z.object({
  id: z.string(),
  no: z.number().int(),
  title: z.string(),
  paragraphs: z.array(z.string()),
  status: z.enum(CHAPTER_STATUSES),
  scenesCount: z.number().int().nonnegative().nullable(),
  durationSec: z.number().nonnegative().nullable(),
});
export type ChapterDoc = z.infer<typeof ChapterDocSchema>;

export const ChapterSnapshotSchema = z.object({
  takenAt: z.date(),
  chapters: z.array(ChapterDocSchema),
});
export type ChapterSnapshot = z.infer<typeof ChapterSnapshotSchema>;
