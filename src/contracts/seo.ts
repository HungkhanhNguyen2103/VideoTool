import { z } from 'zod';

export const SEO_SECTIONS = ['titles', 'description', 'tags', 'pinnedComment', 'thumbnail', 'shorts'] as const;
export type SeoSection = (typeof SEO_SECTIONS)[number];

// YouTube limits checked on 2026-10-02 against the platform's upload guidance; keep these
// named so the UI and server share one source and can be tuned when the platform changes.
export const SEO_TITLE_MAX_CHARS = 100;
export const SEO_TITLE_RECOMMENDED_MAX_CHARS = 70;
export const SEO_DESCRIPTION_MAX_CHARS = 5000;
export const SEO_DESCRIPTION_KEYWORDS_MAX_CHARS = 800;
export const SEO_DESCRIPTION_KEYWORDS_MIN_WORDS = 40;
export const SEO_DESCRIPTION_KEYWORDS_MAX_WORDS = 100;
export const SEO_DESCRIPTION_HINT_MIN_WORDS = 150;
export const SEO_DESCRIPTION_HINT_MAX_WORDS = 300;
export const SEO_TAGS_MAX_CHARS = 500;
export const SEO_HASHTAGS_MAX_COUNT = 15;
export const SEO_HASHTAGS_VISIBLE_COUNT = 3;
export const SEO_SHORTS_MAX_COUNT = 3;
export const SEO_SHORTS_HASHTAGS_MAX_COUNT = 5;
export const SEO_SHORTS_HOOK_MAX_CHARS = 200;
export const SEO_SHORTS_TITLE_MAX_CHARS = 100;
export const SEO_SHORTS_CAPTION_MAX_CHARS = 500;
export const SEO_SHORTS_REASON_MAX_CHARS = 300;
export const SEO_LONG_VIDEO_URL_MAX_CHARS = 500;
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

/** Canonicalize a Shorts hashtag list, reserving one of its five slots for #Shorts. */
export function ensureShortsHashtag(values: readonly string[]): string[] {
  const normalized = normalizeHashtags(values);
  const shortsIndex = normalized.findIndex((value) => comparable(value) === 'shorts');
  const others = normalized.filter((value) => comparable(value) !== 'shorts').slice(0, SEO_SHORTS_HASHTAGS_MAX_COUNT - 1);
  if (shortsIndex < 0 || shortsIndex >= SEO_SHORTS_HASHTAGS_MAX_COUNT) return [...others, '#Shorts'];

  const insertionIndex = Math.min(shortsIndex, others.length);
  return [...others.slice(0, insertionIndex), '#Shorts', ...others.slice(insertionIndex)];
}

const ShortsHashtagsSchema = z.array(z.string()).max(SEO_SHORTS_HASHTAGS_MAX_COUNT).transform(ensureShortsHashtag);

export const SeoShortSchema = z.object({
  id: z.string().min(1),
  startSec: z.number().finite().nonnegative(),
  endSec: z.number().finite().positive(),
  chapterNo: z.number().int(),
  hookLine: z.string().max(SEO_SHORTS_HOOK_MAX_CHARS),
  title: z.string().max(SEO_SHORTS_TITLE_MAX_CHARS),
  caption: z.string().max(SEO_SHORTS_CAPTION_MAX_CHARS),
  hashtags: ShortsHashtagsSchema,
  reason: z.string().max(SEO_SHORTS_REASON_MAX_CHARS),
}).strict().superRefine((value, ctx) => {
  if (value.endSec <= value.startSec) ctx.addIssue({ code: 'custom', path: ['endSec'], message: 'Thời điểm kết thúc phải sau thời điểm bắt đầu.' });
});
export type SeoShort = z.infer<typeof SeoShortSchema>;

function isHttpUrlOrEmpty(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const SeoPackageObjectSchema = z.object({
  titles: z.array(TitleOptionSchema).default([]),
  chosenTitleId: z.string().nullable().default(null),
  descriptionIntro: z.string().max(SEO_DESCRIPTION_MAX_CHARS).default(''),
  descriptionKeywords: z.string().max(SEO_DESCRIPTION_KEYWORDS_MAX_CHARS).default(''),
  tags: z.array(z.string()).default([]),
  hashtags: z.array(z.string().regex(/^#[A-Z][A-Za-z0-9]*$/, 'Hashtag phải bắt đầu bằng #, không có khoảng trắng và dùng CamelCase.')).max(SEO_HASHTAGS_MAX_COUNT).default([]),
  pinnedComment: z.string().default(''),
  thumbnail: SeoThumbnailSchema.default({ ideas: [], chosenIdeaId: null, fileId: null }),
  shorts: z.array(SeoShortSchema).max(SEO_SHORTS_MAX_COUNT).default([]),
  longVideoUrl: z.string().max(SEO_LONG_VIDEO_URL_MAX_CHARS).refine(isHttpUrlOrEmpty, 'URL video dài phải bắt đầu bằng http:// hoặc https://.').default(''),
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
  descriptionKeywords: z.string().max(SEO_DESCRIPTION_KEYWORDS_MAX_CHARS).optional(),
  tags: z.array(z.string()).optional(),
  hashtags: z.array(z.string()).max(SEO_HASHTAGS_MAX_COUNT).optional(),
  pinnedComment: z.string().optional(),
  thumbnail: SeoThumbnailSchema.optional(),
  shorts: z.array(SeoShortSchema).max(SEO_SHORTS_MAX_COUNT).optional(),
  longVideoUrl: z.string().max(SEO_LONG_VIDEO_URL_MAX_CHARS).refine(isHttpUrlOrEmpty, 'URL video dài phải bắt đầu bằng http:// hoặc https://.').optional(),
  generatedBy: SeoGeneratedBySchema.nullable().optional(),
}).strict();
export type SeoPatch = z.input<typeof SeoPatchSchema>;

export type GeneratedSeoSections = Partial<Pick<SeoPackage, 'titles' | 'descriptionIntro' | 'descriptionKeywords' | 'tags' | 'hashtags' | 'pinnedComment' | 'thumbnail' | 'shorts'>> & {
  generatedBy: SeoGeneratedBy;
};

export function emptySeoPackage(): SeoPackage {
  return SeoPackageSchema.parse({});
}
