import { z } from 'zod';
import { ASPECT_RATIOS, AI_PROVIDERS, FILM_LOOK_STYLES, LIGHT_TYPES, NameCandidatesSchema, PARALLAX_STYLES, PROJECT_STATUSES, RENDER_ENGINES, SCRIPT_PRESET_IDS, SHOT_TYPES, SfxVolumeSchema, TRANSITION_STYLES, VISUAL_STYLE_IDS, WordTimingsSchema, type LightType, type ShotType } from '../../../contracts/project';
import { PopupDensitySchema, PopupPlanSchema } from '../../../contracts/popup-analysis';
import { ChapterDocSchema, ChapterSnapshotSchema, HubrisMotifSchema, OpenLoopSchema } from '../../../contracts/script';
import { SeoPackageSchema } from '../../../contracts/seo';
import { DEFAULT_SCENE_TAIL_SEC, SceneDurationSecSchema, SceneTailSecSchema } from '../../../contracts/scene-duration';
import { DEFAULT_VOICE_SPEED, VoiceSpeedSchema, VoiceoverInputSchema } from '../../../contracts/voiceover';

export const SceneDocSchema = z.object({
  id: z.string(),
  narration: z.string(),
  visualPrompt: z.string(),
  shotType: z.enum(SHOT_TYPES).nullable().default(null),
  lightType: z.enum(LIGHT_TYPES).nullable().default(null),
  durationSec: SceneDurationSecSchema,
  active: z.boolean().default(true),
  assetType: z.enum(['image', 'video']).default('image'),
  assetFileId: z.string().nullable().default(null),
  audioFileId: z.string().nullable().default(null),
  voiceoverDurationSec: z.number().finite().nonnegative().nullable().default(null),
  voiceoverInput: VoiceoverInputSchema.nullable().default(null),
  wordTimings: WordTimingsSchema.nullable().default(null),
  nameCandidates: NameCandidatesSchema.nullable().default(null),
  popupPlan: PopupPlanSchema.default(null),
  sfxPrompt: z.string().default(''),
  motionPrompt: z.string().default(''),
  sfxFileId: z.string().nullable().default(null),
  videoKeyframeFileId: z.string().nullable().default(null),
  videoTailFileId: z.string().nullable().default(null),
  videoDurationSec: z.number().positive().nullable().default(null),
  depthMap: z.object({ assetFileId: z.string(), fileId: z.string(), score: z.number().finite() }).nullable().default(null),
});
/** Mongo reads are normalized by the schema, while legacy-shaped write fixtures may omit this additive field. */
export type SceneDoc = Omit<z.infer<typeof SceneDocSchema>, 'popupPlan' | 'shotType' | 'lightType'> & { popupPlan?: z.infer<typeof PopupPlanSchema>; shotType?: ShotType | null; lightType?: LightType | null };

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
  channelId: z.string().min(1).nullable().default(null),
  aiProvider: z.enum(AI_PROVIDERS).default('deepseek'),
  aiModel: z.string().optional(),
  renderEngine: z.enum(RENDER_ENGINES).default('ffmpeg'),
  keywordPopupsEnabled: z.boolean().default(true),
  popupDensity: PopupDensitySchema,
  transitionStyle: z.enum(TRANSITION_STYLES).default('varied'),
  filmLook: z.enum(FILM_LOOK_STYLES).default('auto'),
  parallax: z.enum(PARALLAX_STYLES).default('off'),
  voiceoverVoice: z.string().default('Truc Ly'),
  voiceSpeed: VoiceSpeedSchema.default(DEFAULT_VOICE_SPEED),
  sceneTailSec: SceneTailSecSchema.default(DEFAULT_SCENE_TAIL_SEC),
  sfxVolume: SfxVolumeSchema.default(0.5),
  renderFileId: z.string().nullable().default(null),
  renderedActiveSceneIds: z.array(z.string()).optional(),
  draftRenderFileId: z.string().nullable().default(null),
  bgmMood: z.string().default(''),
  bgmFileId: z.string().nullable().default(null),
  logoFileId: z.string().nullable().default(null),
  customStyleReferenceFileId: z.string().nullable().default(null),
  seo: SeoPackageSchema,
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
