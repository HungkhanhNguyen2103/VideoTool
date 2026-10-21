import { z } from 'zod';
import { SEO_DESCRIPTION_KEYWORDS_MAX_CHARS, SEO_SHORTS_CAPTION_MAX_CHARS, SEO_SHORTS_HASHTAGS_MAX_COUNT, SEO_SHORTS_HOOK_MAX_CHARS, SEO_SHORTS_REASON_MAX_CHARS, SEO_SHORTS_TITLE_MAX_CHARS, SEO_TITLE_ANGLES } from '../../../../contracts/seo';

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
  description_keywords: z.string().max(SEO_DESCRIPTION_KEYWORDS_MAX_CHARS).optional(),
  tags: z.array(z.string()).optional(),
  hashtags: z.array(z.string()).optional(),
  pinned_comment: z.string().optional(),
  thumbnail: z.object({ ideas: z.array(SeoAiThumbnailIdeaSchema) }).strict().optional(),
}).strict();

export type SeoAiOutput = z.infer<typeof SeoAiOutputSchema>;

export const SeoAiShortEntrySchema = z.object({
  window_id: z.string().min(1),
  hook_line: z.string().max(SEO_SHORTS_HOOK_MAX_CHARS),
  title: z.string().max(SEO_SHORTS_TITLE_MAX_CHARS),
  caption: z.string().max(SEO_SHORTS_CAPTION_MAX_CHARS),
  hashtags: z.array(z.string()).max(SEO_SHORTS_HASHTAGS_MAX_COUNT),
  reason: z.string().max(SEO_SHORTS_REASON_MAX_CHARS),
}).strict();

export const SeoAiShortsOutputSchema = z.object({ shorts: z.array(SeoAiShortEntrySchema).max(3) }).strict();
export type SeoAiShortsOutput = z.infer<typeof SeoAiShortsOutputSchema>;
