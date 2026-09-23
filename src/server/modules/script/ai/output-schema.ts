import { z } from 'zod';

export const GeneratedChapterSchema = z.object({
  no: z.number().int().positive(),
  title: z.string(),
  paragraphs: z.array(z.string()).min(1),
  scenesCount: z.null(),
  durationSec: z.null(),
});

export const RegeneratedParagraphsSchema = z.union([
  z.array(z.string()).min(1),
  z.object({ paragraphs: z.array(z.string()).min(1) }).transform((value) => value.paragraphs),
]);

export const VisualPromptBatchSchema = z.object({
  styleNote: z.string().max(500),
  prompts: z.array(z.object({
    sceneIndex: z.number().int().positive(),
    visualPrompt: z.string().trim().min(1),
  })),
});
