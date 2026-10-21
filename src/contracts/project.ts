import { z } from 'zod';
import { ChapterDocSchema, HubrisMotifSchema, OpenLoopSchema } from './script';
import { SeoPackageSchema } from './seo';
import { DEFAULT_SCENE_TAIL_SEC, SceneDurationSecSchema, SceneTailSecSchema } from './scene-duration';
import { DEFAULT_VOICE_SPEED, VoiceSpeedSchema, VoiceoverInputSchema } from './voiceover';
import { PopupDensitySchema, PopupPlanSchema } from './popup-analysis';

export const PROJECT_STATUSES = ['draft', 'script', 'assets', 'rendered'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const RENDER_ENGINES = ['ffmpeg', 'remotion'] as const;
export type RenderEngine = (typeof RENDER_ENGINES)[number];

export const TRANSITION_STYLES = ['crossfade', 'varied'] as const;
export type TransitionStyle = (typeof TRANSITION_STYLES)[number];

export const FILM_LOOK_STYLES = ['auto', 'always', 'off'] as const;
export type FilmLookStyle = (typeof FILM_LOOK_STYLES)[number];

export const PARALLAX_STYLES = ['auto', 'off'] as const;
export type ParallaxStyle = (typeof PARALLAX_STYLES)[number];

export const SfxVolumeSchema = z.number().min(0).max(1).multipleOf(0.01);

export const AI_PROVIDERS = ['deepseek', 'claude'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const SCRIPT_PRESET_IDS = ['documentary', 'explainer', 'hubris-trap', 'strategist'] as const;
export type ScriptPresetId = (typeof SCRIPT_PRESET_IDS)[number];

export const VISUAL_STYLE_IDS = ['cinematic', 'anime', 'watercolor', 'photorealistic', 'flat-cartoon', 'strategic-map'] as const;
export type VisualStyleId = (typeof VISUAL_STYLE_IDS)[number];

export const SHOT_TYPES = ['wide', 'medium', 'close', 'detail', 'high-angle', 'low-angle'] as const;
export type ShotType = (typeof SHOT_TYPES)[number];
export const LIGHT_TYPES = ['daylight', 'overcast', 'golden-hour', 'night', 'firelight', 'interior'] as const;
export type LightType = (typeof LIGHT_TYPES)[number];

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/** Resolutions allowed per aspect ratio. Source of truth for the `renderSettings` cross-field check. */
export const ASPECT_RESOLUTIONS: Record<AspectRatio, readonly (readonly [number, number])[]> = {
  '16:9': [
    [1920, 1080],
    [1280, 720],
  ],
  '9:16': [
    [1080, 1920],
    [720, 1280],
  ],
  '1:1': [[1080, 1080]],
};

export const RenderSettingsSchema = z.object({
  aspect: z.enum(ASPECT_RATIOS),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
});
export type RenderSettings = z.infer<typeof RenderSettingsSchema>;

/**
 * Validation rules and Vietnamese messages copied from
 * docs/prototypes/khoi-tao-du-an/app.js (`validate()`), one message per field.
 */
export const CreateProjectRequestBase = z.object({
  title: z.string(),
  brief: z.string(),
  language: z.enum(['vi', 'en']),
  referencesText: z.string(),
  scriptPresetId: z.enum(SCRIPT_PRESET_IDS),
  visualStylePresetId: z.enum(VISUAL_STYLE_IDS).default('cinematic'),
  targetDurationSec: z.number(),
  chapterCount: z.number().nullable(),
  voiceId: z.string().nullable(),
  channelId: z.string().min(1).nullable().default(null),
  aiProvider: z.enum(AI_PROVIDERS).default('deepseek'),
  aiModel: z.string().optional(),
  renderEngine: z.enum(RENDER_ENGINES).default('ffmpeg'),
  voiceoverVoice: z.string().default('Truc Ly'),
  voiceSpeed: VoiceSpeedSchema.default(DEFAULT_VOICE_SPEED),
  popupDensity: PopupDensitySchema,
  renderFileId: z.string().nullable().default(null),
  bgmMood: z.string().default(''),
  bgmFileId: z.string().nullable().default(null),
  renderSettings: RenderSettingsSchema,
});

const ProjectImportRenderSettingsSchema = z.object({
  aspect: z.enum(ASPECT_RATIOS).optional(),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).optional(),
}).strict();

/** Optional create-project fields accepted by the root project.json import seed. */
export const ProjectImportSeedSchema = CreateProjectRequestBase.pick({
  title: true,
  language: true,
  brief: true,
  referencesText: true,
  scriptPresetId: true,
  visualStylePresetId: true,
  aiProvider: true,
  aiModel: true,
  targetDurationSec: true,
  chapterCount: true,
  voiceId: true,
}).partial().extend({
  visualStylePresetId: z.enum(VISUAL_STYLE_IDS).optional(),
  aiProvider: z.enum(AI_PROVIDERS).optional(),
  aiModel: z.string().optional(),
  renderSettings: ProjectImportRenderSettingsSchema.optional(),
}).strict();
export type ProjectImportSeed = z.infer<typeof ProjectImportSeedSchema>;

export const CreateProjectRequestSchema = CreateProjectRequestBase.transform((val) => ({
  ...val,
  title: val.title.trim(),
  brief: val.brief.trim(),
  referencesText: val.referencesText.trim(),
})).superRefine((val, ctx) => {
  if (!val.title) {
    ctx.addIssue({ code: 'custom', path: ['title'], message: 'Vui lòng nhập tên dự án.' });
  } else if (val.title.length > 120) {
    ctx.addIssue({ code: 'custom', path: ['title'], message: 'Tên dự án tối đa 120 ký tự.' });
  }

  if (val.brief.length < 10) {
    ctx.addIssue({
      code: 'custom',
      path: ['brief'],
      message: `Brief cần tối thiểu 10 ký tự (hiện có ${val.brief.length}).`,
    });
  }

  if (!Number.isInteger(val.targetDurationSec) || val.targetDurationSec < 30 || val.targetDurationSec > 3600) {
    ctx.addIssue({ code: 'custom', path: ['targetDurationSec'], message: 'Nhập số nguyên từ 30 đến 3600 giây.' });
  }

  if (
    val.chapterCount !== null &&
    (!Number.isInteger(val.chapterCount) || val.chapterCount < 1 || val.chapterCount > 20)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['chapterCount'],
      message: 'Nhập số nguyên từ 1 đến 20, hoặc để trống.',
    });
  }

  const allowedResolutions = ASPECT_RESOLUTIONS[val.renderSettings.aspect];
  const resolutionOk = allowedResolutions.some(
    ([w, h]) => w === val.renderSettings.width && h === val.renderSettings.height,
  );
  if (!resolutionOk) {
    ctx.addIssue({
      code: 'custom',
      path: ['renderSettings', 'height'],
      message: 'Độ phân giải không khớp với khổ hình đã chọn.',
    });
  }
});
export type CreateProjectRequest = z.input<typeof CreateProjectRequestSchema>;
export type CreateProject = z.output<typeof CreateProjectRequestSchema>;

export const WordTimingsSchema = z.object({
  audioFileId: z.string(),
  words: z.array(z.object({ text: z.string(), startSec: z.number().nonnegative(), endSec: z.number().nonnegative() })),
});
export type WordTimings = z.infer<typeof WordTimingsSchema>;

export const NAME_CANDIDATE_KINDS = ['person', 'place', 'event', 'group'] as const;
export const NameCandidateSchema = z.object({
  phrase: z.string().trim().min(1),
  kind: z.enum(NAME_CANDIDATE_KINDS),
  role: z.string().optional(),
});
export const NameCandidatesSchema = z.object({
  narrationHash: z.string().min(1),
  audioFileId: z.string().min(1),
  provider: z.enum(AI_PROVIDERS),
  model: z.string().min(1),
  generatedAt: z.string().datetime(),
  candidates: z.array(NameCandidateSchema).max(2),
});
export type NameCandidate = z.infer<typeof NameCandidateSchema>;
export type NameCandidates = z.infer<typeof NameCandidatesSchema>;

export const SceneSchema = z.object({
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
  depthMap: z.object({
    assetFileId: z.string(),
    fileId: z.string(),
    score: z.number().finite(),
  }).nullable().default(null),
});
/** The parser supplies the additive popup-plan default; callers may omit it when constructing legacy-shaped scenes. */
export type Scene = Omit<z.infer<typeof SceneSchema>, 'popupPlan' | 'shotType' | 'lightType'> & { popupPlan?: z.infer<typeof PopupPlanSchema>; shotType?: ShotType | null; lightType?: LightType | null };

export const ProjectSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  channelId: z.string().min(1).nullable().default(null),
  youtubeVideoId: z.string().min(1).nullable().default(null),
  status: z.enum(PROJECT_STATUSES),
  scenesCount: z.number().int().nonnegative().nullable(),
  durationSec: SceneDurationSecSchema.nullable(),
  updatedAt: z.string(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  channelId: z.string().min(1).nullable().default(null),
  youtubeVideoId: z.string().min(1).nullable().default(null),
  status: z.enum(PROJECT_STATUSES),
  language: z.enum(['vi', 'en']),
  brief: z.string(),
  referencesText: z.string(),
  scriptPresetId: z.enum(SCRIPT_PRESET_IDS),
  visualStylePresetId: z.enum(VISUAL_STYLE_IDS).default('cinematic'),
  targetDurationSec: z.number().int(),
  chapterCount: z.number().int().nullable(),
  voiceId: z.string().nullable(),
  aiProvider: z.enum(AI_PROVIDERS).default('deepseek'),
  aiModel: z.string().optional(),
  renderEngine: z.enum(RENDER_ENGINES).default('ffmpeg'),
  keywordPopupsEnabled: z.boolean().default(true),
  transitionStyle: z.enum(TRANSITION_STYLES).default('varied'),
  filmLook: z.enum(FILM_LOOK_STYLES).default('auto'),
  parallax: z.enum(PARALLAX_STYLES).default('off'),
  voiceoverVoice: z.string().default('Truc Ly'),
  voiceSpeed: VoiceSpeedSchema.default(DEFAULT_VOICE_SPEED),
  popupDensity: PopupDensitySchema,
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
  renderSettings: RenderSettingsSchema,
  scenes: z.array(SceneSchema),
  chapters: z.array(ChapterDocSchema).default([]),
  openLoops: z.array(OpenLoopSchema).default([]),
  motif: HubrisMotifSchema.nullable().default(null),
  coreQuestion: z.string().default(''),
  openingHook: z.string().default(''),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

export const SetProjectChannelRequestSchema = z.object({ channelId: z.string().min(1).nullable() }).strict();
export type SetProjectChannelRequest = z.infer<typeof SetProjectChannelRequestSchema>;

export const ListProjectsQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
});
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;
