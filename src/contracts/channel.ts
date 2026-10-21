import { z } from 'zod';
import { normalizeHashtags } from './seo';

export const CHANNEL_LANGUAGES = ['vi', 'en'] as const;
export const CHANNEL_DEFAULT_HASHTAGS_MAX_COUNT = 5;

const handleSchema = z.string().regex(/^@[\p{L}\p{N}_.-]{3,30}$/u, 'Handle phải bắt đầu bằng @ và có 3–30 ký tự chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.');
const linkSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: z.string().url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'Liên kết phải dùng HTTP hoặc HTTPS.'),
}).strict();
const hashtagsInputSchema = z.array(z.string()).transform((values) => normalizeHashtags(values).slice(0, CHANNEL_DEFAULT_HASHTAGS_MAX_COUNT));
const hashtagsSchema = hashtagsInputSchema.default([]);

export const ChannelSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(100),
  handle: handleSchema.optional(),
  tagline: z.string().max(200).default(''),
  description: z.string().max(1000).default(''),
  language: z.enum(CHANNEL_LANGUAGES).default('vi'),
  links: z.array(linkSchema).max(10).default([]),
  defaultHashtags: hashtagsSchema,
  descriptionFooter: z.string().max(1500).default(''),
  aiDisclosureText: z.string().max(500).optional(),
  thumbnailTemplate: z.string().max(4000).optional(),
  publishSchedule: z.unknown().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type Channel = z.infer<typeof ChannelSchema>;

const ChannelInputFields = {
  name: z.string().trim().min(1).max(100),
  handle: handleSchema.optional(),
  tagline: z.string().max(200).default(''),
  description: z.string().max(1000).default(''),
  language: z.enum(CHANNEL_LANGUAGES).default('vi'),
  links: z.array(linkSchema).max(10).default([]),
  defaultHashtags: hashtagsSchema,
  descriptionFooter: z.string().max(1500).default(''),
  aiDisclosureText: z.string().max(500).optional(),
  thumbnailTemplate: z.string().max(4000).optional(),
  publishSchedule: z.unknown().nullable().default(null),
};

export const CreateChannelRequestSchema = z.object(ChannelInputFields).strict();
export type CreateChannelRequest = z.input<typeof CreateChannelRequestSchema>;

export const UpdateChannelRequestSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  handle: handleSchema.nullable().optional(),
  tagline: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  language: z.enum(CHANNEL_LANGUAGES).optional(),
  links: z.array(linkSchema).max(10).optional(),
  defaultHashtags: hashtagsInputSchema.optional(),
  descriptionFooter: z.string().max(1500).optional(),
  aiDisclosureText: z.string().max(500).optional(),
  thumbnailTemplate: z.string().max(4000).optional(),
  publishSchedule: z.unknown().nullable().optional(),
}).strict();
export type UpdateChannelRequest = z.input<typeof UpdateChannelRequestSchema>;

export const ChannelSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  handle: handleSchema.optional(),
}).strict();
export type ChannelSummary = z.infer<typeof ChannelSummarySchema>;
