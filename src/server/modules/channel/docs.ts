import { z } from 'zod';
import { CHANNEL_LANGUAGES, CHANNEL_DEFAULT_HASHTAGS_MAX_COUNT } from '../../../contracts/channel';
import { normalizeHashtags } from '../../../contracts/seo';

const channelFields = {
  name: z.string().trim().min(1).max(100),
  nameSearch: z.string(),
  handle: z.string().optional(),
  tagline: z.string().max(200).default(''),
  description: z.string().max(1000).default(''),
  language: z.enum(CHANNEL_LANGUAGES).default('vi'),
  links: z.array(z.object({ label: z.string().trim().min(1).max(40), url: z.string().url() }).strict()).max(10).default([]),
  defaultHashtags: z.array(z.string()).default([]).transform((values) => normalizeHashtags(values).slice(0, CHANNEL_DEFAULT_HASHTAGS_MAX_COUNT)),
  descriptionFooter: z.string().max(1500).default(''),
  aiDisclosureText: z.string().max(500).optional(),
  thumbnailTemplate: z.string().max(4000).optional(),
  publishSchedule: z.unknown().nullable().default(null),
};

/** The `channels` collection. `docs.ts` owns the persisted shape. */
export const ChannelDocSchema = z.object({
  _id: z.string(),
  schemaVersion: z.literal(1),
  ...channelFields,
  createdAt: z.date(),
  updatedAt: z.date(),
}).strict();

export type ChannelDoc = z.infer<typeof ChannelDocSchema>;
