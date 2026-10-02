import { z } from 'zod';
import { SEO_TITLE_ANGLES } from '../../../../contracts/seo';

export const SeoAiTitleSchema = z.object({
  text: z.string().min(1),
  angle: z.enum(SEO_TITLE_ANGLES),
}).strict();

export const SeoAiThumbnailIdeaSchema = z.object({
  overlay_text: z.string().min(1),
  concept: z.string().min(1),
  image_prompt: z.string().min(1),
}).strict();

export const SeoAiOutputSchema = z.object({
  titles: z.array(SeoAiTitleSchema).optional(),
  description_intro: z.string().optional(),
  tags: z.array(z.string()).optional(),
  hashtags: z.array(z.string()).optional(),
  pinned_comment: z.string().optional(),
  thumbnail: z.object({ ideas: z.array(SeoAiThumbnailIdeaSchema) }).strict().optional(),
}).strict();

export type SeoAiOutput = z.infer<typeof SeoAiOutputSchema>;
