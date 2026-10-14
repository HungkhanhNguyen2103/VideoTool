import { z } from 'zod';

export const SEO_SECTIONS = ['titles', 'description', 'tags', 'pinnedComment', 'thumbnail'] as const;
export type SeoSection = (typeof SEO_SECTIONS)[number];

// YouTube limits checked on 2026-10-02 against the platform's upload guidance; keep these
// named so the UI and server share one source and can be tuned when the platform changes.
export const SEO_TITLE_MAX_CHARS = 100;
export const SEO_TITLE_RECOMMENDED_MAX_CHARS = 70;
export const SEO_DESCRIPTION_MAX_CHARS = 5000;
export const SEO_TAGS_MAX_CHARS = 500;
export const SEO_HASHTAGS_MAX_COUNT = 15;
export const SEO_HASHTAGS_VISIBLE_COUNT = 3;
export const SEO_THUMBNAIL_WIDTH = 1280;
export const SEO_THUMBNAIL_HEIGHT = 720;
export const SEO_THUMBNAIL_MIN_WIDTH = 640;
export const SEO_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
export const SEO_THUMBNAIL_MAX_WORDS = 8;

export const SEO_TITLE_ANGLES = ['curiosity', 'stakes', 'number', 'question', 'contrarian'] as const;
export type SeoTitleAngle = (typeof SEO_TITLE_ANGLES)[number];

export const TitleOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(SEO_TITLE_MAX_CHARS),
  angle: z.enum(SEO_TITLE_ANGLES),
}).strict();
export type TitleOption = z.infer<typeof TitleOptionSchema>;

export const ThumbnailIdeaSchema = z.object({
  id: z.string().min(1),
  overlayText: z.string().max(200),
  concept: z.string(),
  imagePrompt: z.string(),
}).strict();
export type ThumbnailIdea = z.infer<typeof ThumbnailIdeaSchema>;

export const SeoGeneratedBySchema = z.object({
  provider: z.enum(['deepseek', 'claude', 'manual']),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  generatedAt: z.string().min(1),
}).strict();
export type SeoGeneratedBy = z.infer<typeof SeoGeneratedBySchema>;

export const SeoThumbnailSchema = z.object({
  ideas: z.array(ThumbnailIdeaSchema).default([]),
  chosenIdeaId: z.string().nullable().default(null),
  fileId: z.string().nullable().default(null),
}).strict();

function comparable(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

/** Convert a pasted hashtag into the server's canonical, accent-free CamelCase form. */
export function normalizeHashtag(value: string): string {
  const body = value.trim().replace(/^#+/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd');
  const parts = body.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length === 0) return '#';
  const normalized = parts.length === 1
    ? `${parts[0]![0]!.toUpperCase()}${parts[0]!.slice(1)}`
    : parts.map((part) => `${part[0]!.toUpperCase()}${part.slice(1).toLowerCase()}`).join('');
  return `#${normalized}`;
}

export function normalizeHashtags(values: readonly string[], tags: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const tagValues = new Set(tags.map(comparable));
  return values
    .map(normalizeHashtag)
    .filter((value) => /^#[A-Z][A-Za-z0-9]*$/.test(value))
    .filter((value) => {
      const key = comparable(value);
      if (seen.has(key) || tagValues.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, SEO_HASHTAGS_MAX_COUNT);
}

const SeoPackageObjectSchema = z.object({
  titles: z.array(TitleOptionSchema).default([]),
  chosenTitleId: z.string().nullable().default(null),
  descriptionIntro: z.string().max(SEO_DESCRIPTION_MAX_CHARS).default(''),
  tags: z.array(z.string()).default([]),
  hashtags: z.array(z.string().regex(/^#[A-Z][A-Za-z0-9]*$/, 'Hashtag phải bắt đầu bằng #, không có khoảng trắng và dùng CamelCase.')).max(SEO_HASHTAGS_MAX_COUNT).default([]),
  pinnedComment: z.string().default(''),
  thumbnail: SeoThumbnailSchema.default({ ideas: [], chosenIdeaId: null, fileId: null }),
  generatedBy: SeoGeneratedBySchema.nullable().default(null),
}).strict().superRefine((value, ctx) => {
  const seen = new Set<string>();
  const tags = new Set(value.tags.map(comparable));
  value.hashtags.forEach((hashtag, index) => {
    const key = comparable(hashtag);
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['hashtags', index], message: 'Hashtag không được trùng.' });
    if (tags.has(key)) ctx.addIssue({ code: 'custom', path: ['hashtags', index], message: 'Hashtag không được lặp lại tags.' });
    seen.add(key);
  });
});
export const SeoPackageSchema = z.preprocess((value) => value === undefined ? {} : value, SeoPackageObjectSchema);
export type SeoPackage = z.infer<typeof SeoPackageSchema>;
export type SeoPackageInput = z.input<typeof SeoPackageSchema>;

export const SeoPatchSchema = z.object({
  titles: z.array(TitleOptionSchema).optional(),
  chosenTitleId: z.string().nullable().optional(),
  descriptionIntro: z.string().max(SEO_DESCRIPTION_MAX_CHARS).optional(),
  tags: z.array(z.string()).optional(),
  hashtags: z.array(z.string()).max(SEO_HASHTAGS_MAX_COUNT).optional(),
  pinnedComment: z.string().optional(),
  thumbnail: SeoThumbnailSchema.optional(),
  generatedBy: SeoGeneratedBySchema.nullable().optional(),
}).strict();
export type SeoPatch = z.input<typeof SeoPatchSchema>;

export type GeneratedSeoSections = Partial<Pick<SeoPackage, 'titles' | 'descriptionIntro' | 'tags' | 'hashtags' | 'pinnedComment' | 'thumbnail'>> & {
  generatedBy: SeoGeneratedBy;
};

export function emptySeoPackage(): SeoPackage {
  return SeoPackageSchema.parse({});
}
