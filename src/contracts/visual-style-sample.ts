import { z } from 'zod';
import { VISUAL_STYLE_IDS } from './project';

export const VisualStyleSampleSchema = z.object({
  url: z.string(),
  filename: z.string(),
  source: z.enum(['shared', 'project']),
  updatedAt: z.string(),
});
export type VisualStyleSample = z.infer<typeof VisualStyleSampleSchema>;

export const VisualStyleSamplesSchema = z.partialRecord(z.enum(VISUAL_STYLE_IDS), VisualStyleSampleSchema);
export type VisualStyleSamples = z.infer<typeof VisualStyleSamplesSchema>;
