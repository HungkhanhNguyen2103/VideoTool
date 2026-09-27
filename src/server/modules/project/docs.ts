import { z } from 'zod';
import { ASPECT_RATIOS, AI_PROVIDERS, PROJECT_STATUSES, RENDER_ENGINES, SCRIPT_PRESET_IDS, TRANSITION_STYLES, VISUAL_STYLE_IDS, WordTimingsSchema } from '../../../contracts/project';
import { ChapterDocSchema, ChapterSnapshotSchema, HubrisMotifSchema, OpenLoopSchema } from '../../../contracts/script';

export const SceneDocSchema = z.object({
  id: z.string(),
  narration: z.string(),
  visualPrompt: z.string(),
  durationSec: z.number().int().nonnegative(),
  assetType: z.enum(['image', 'video']).default('image'),
  assetFileId: z.string().nullable().default(null),
  audioFileId: z.string().nullable().default(null),
  wordTimings: WordTimingsSchema.nullable().default(null),
  sfxPrompt: z.string().default(''),
  sfxFileId: z.string().nullable().default(null),
});
export type SceneDoc = z.infer<typeof SceneDocSchema>;

/** The `projects` collection. `docs.ts` is the single source of truth for its shape. */
export const ProjectDocSchema = z.object({
  _id: z.string(),
  schemaVersion: z.literal(1),
  title: z.string(),
  /** Accent-stripped, lowercased title. Kept in sync with `title` on write. See title-search.ts. */
  titleSearch: z.string(),
  language: z.enum(['vi', 'en']),
  brief: z.string(),
  referencesText: z.string(),
  scriptPresetId: z.enum(SCRIPT_PRESET_IDS),
  visualStylePresetId: z.enum(VISUAL_STYLE_IDS).default('cinematic'),
  targetDurationSec: z.number().int(),
  chapterCount: z.number().int().nullable(),
  voiceId: z.string().nullable(),
  aiProvider: z.enum(AI_PROVIDERS).default('deepseek'),
  renderEngine: z.enum(RENDER_ENGINES).default('ffmpeg'),
  keywordPopupsEnabled: z.boolean().default(true),
  transitionStyle: z.enum(TRANSITION_STYLES).default('varied'),
  voiceoverVoice: z.string().default('Truc Ly'),
  renderFileId: z.string().nullable().default(null),
  bgmMood: z.string().default(''),
  bgmFileId: z.string().nullable().default(null),
  customStyleReferenceFileId: z.string().nullable().default(null),
  renderSettings: z.object({
    aspect: z.enum(ASPECT_RATIOS),
    width: z.number().int(),
    height: z.number().int(),
    fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
  }),
  status: z.enum(PROJECT_STATUSES),
  /** Embedded scenes, in order. Empty until the `script` module writes them (Phase 3). */
  scenes: z.array(SceneDocSchema),
  chapters: z.array(ChapterDocSchema).default([]),
  openLoops: z.array(OpenLoopSchema).default([]),
  motif: HubrisMotifSchema.nullable().default(null),
  coreQuestion: z.string().default(''),
  openingHook: z.string().default(''),
  chapterHistory: z.array(ChapterSnapshotSchema).default([]),
  /** Optimistic lock: bump on every write, compare-and-swap on update. */
  version: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ProjectDoc = z.infer<typeof ProjectDocSchema>;
