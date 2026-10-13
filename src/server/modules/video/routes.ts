import { Router } from 'express';
import { z } from 'zod';
import { getProject, setProjectFilmLook, setProjectKeywordPopups, setProjectParallax, setProjectPopupDensity, setProjectRenderEngine, setProjectSceneTailSec, setProjectSfxVolume, setProjectTransitionStyle, setProjectVoiceSpeed } from '../project';
import { FILM_LOOK_STYLES, PARALLAX_STYLES, RENDER_ENGINES, SfxVolumeSchema, TRANSITION_STYLES } from '../../../contracts/project';
import { POPUP_DENSITIES, PopupBackendSchema } from '../../../contracts/popup-analysis';
import { isAiModelForProvider } from '../../../contracts/ai-models';
import { SceneTailSecSchema } from '../../../contracts/scene-duration';
import { VoiceSpeedSchema } from '../../../contracts/voiceover';
import { getActiveJobByType, getActiveJobDetailsByType } from '../job';
import { AppError } from '../../shared/errors';
import { uploadLogo } from '../../shared/upload';
import {
  generateProjectBgm,
  generateSceneSfx,
  generateSceneVoiceover,
  assertProjectRenderReady,
  renderScenePreviewBuffer,
} from './service';
import { recomputeProjectSceneDurations } from './scene-duration-service';
import { LOGO_MIME_TYPES, removeProjectLogo, replaceProjectLogo } from './logo-service';
import { analyzeProjectNameKeywords, type NameKeywordAnalysisSummary } from './name-keyword-service';
import { selectProjectSceneKeywords } from './keywords';
import { POPUP_ANALYSIS_JOB_TYPE } from './popup-analysis-service';
import { getClaudeCliStatus as readClaudeCliStatus } from '../../shared/claude-cli/cli-runner';
import { loadConfig } from '../../config';

type EnqueueVideoJob = (input: { type: string; projectId: string; payload: unknown }) => Promise<{ id: string }>;
type AnalyzeNameKeywords = (projectId: string) => Promise<NameKeywordAnalysisSummary>;
type GetActiveVideoJob = (projectId: string, type: string) => Promise<{ id: string; payload: unknown } | null>;
type ReadClaudeCliStatus = () => ReturnType<typeof readClaudeCliStatus>;

const VoiceoverOptionsSchema = z.object({
  voice: z.string().optional(),
  speed: z.number().positive().optional(),
  temperature: z.number().nonnegative().optional(),
  refAudioPath: z.string().optional(),
  refAudioText: z.string().optional(),
}).default({});

const BgmSchema = z.object({ mood: z.string().trim().min(1) });
const RenderEngineSchema = z.object({ engine: z.enum(RENDER_ENGINES) });
const KeywordPopupsSchema = z.object({ enabled: z.boolean() }).strict();
const TransitionStyleSchema = z.object({ style: z.enum(TRANSITION_STYLES) }).strict();
const FilmLookSchema = z.object({ style: z.enum(FILM_LOOK_STYLES) }).strict();
const ParallaxSchema = z.object({ style: z.enum(PARALLAX_STYLES) }).strict();
const SceneTailSchema = z.object({ sceneTailSec: SceneTailSecSchema }).strict();
const SfxVolumeSettingSchema = z.object({ sfxVolume: SfxVolumeSchema }).strict();
const VoiceSpeedSettingSchema = z.object({ voiceSpeed: VoiceSpeedSchema }).strict();
const GenerateVoiceoverSchema = z.object({ startSceneId: z.string().trim().min(1).optional() }).strict();
const GenerateSfxSchema = z.object({ onlyMissing: z.boolean().optional().default(false) }).strict();
const RenderSchema = z.object({ draft: z.boolean().optional().default(false) }).strict();
const PopupAnalysisSchema = z.object({
  backend: PopupBackendSchema.default('api'),
  cliModel: z.string().trim().min(1).optional(),
  density: z.enum(POPUP_DENSITIES).optional(),
}).strict();
const PopupDensitySettingSchema = z.object({ density: z.enum(POPUP_DENSITIES) }).strict();

export function createVideoRouter(options: { enqueueJob: EnqueueVideoJob; analyzeNameKeywords?: AnalyzeNameKeywords; getActiveJob?: GetActiveVideoJob; getClaudeCliStatus?: ReadClaudeCliStatus }): Router {
  const router = Router();

  router.post('/:id/scenes/generate-voiceover', async (req, res) => {
    const { startSceneId } = GenerateVoiceoverSchema.parse(req.body ?? {});
    const project = await getProject(req.params.id);
    if (startSceneId !== undefined && !project.scenes.some((scene) => scene.id === startSceneId)) {
      throw new AppError('Không tìm thấy scene bắt đầu voiceover.', 400, 'VOICEOVER_START_SCENE_NOT_FOUND');
    }
    const payload = startSceneId === undefined ? { projectId: project.id } : { projectId: project.id, startSceneId };
    const job = await options.enqueueJob({ type: 'generate-voiceover', projectId: project.id, payload });
    res.status(201).json({ jobId: job.id });
  });

  router.post('/:id/scenes/align-words', async (req, res) => {
    const project = await getProject(req.params.id);
    const job = await options.enqueueJob({ type: 'align-word-timings', projectId: project.id, payload: { projectId: project.id } });
    res.status(201).json({ jobId: job.id });
  });

  router.post('/:id/name-keywords/analyze', async (req, res) => {
    const project = await getProject(req.params.id);
    const activeRender = await getActiveJobByType(project.id, 'render-full-video');
    if (activeRender) throw new AppError('Không thể phân tích tên popup khi render đang chạy.', 409, 'RENDER_IN_PROGRESS');
    const summary = await (options.analyzeNameKeywords ?? analyzeProjectNameKeywords)(project.id);
    res.json(summary);
  });

  router.post('/:id/popup-analysis', async (req, res) => {
    const body = PopupAnalysisSchema.parse(req.body ?? {});
    const project = await getProject(req.params.id);
    const density = body.density ?? project.popupDensity;
    const activeRender = await getActiveJobByType(project.id, 'render-full-video');
    if (activeRender) throw new AppError('Không thể phân tích popup khi render đang chạy.', 409, 'RENDER_IN_PROGRESS');
    if (body.backend === 'cli') {
      if (body.cliModel && !isAiModelForProvider('claude', body.cliModel)) throw new AppError(`Model ${body.cliModel} không thuộc Claude.`, 422, 'AI_MODEL_UNAVAILABLE');
      const status = await (options.getClaudeCliStatus ?? (async () => {
        const config = loadConfig();
        return readClaudeCliStatus({ executablePath: config.CLAUDE_CLI_PATH, env: process.env });
      }))();
      if (!status.available) throw new AppError(status.reason ?? 'Claude Code CLI chưa khả dụng trên máy chủ này.', 503, 'CLAUDE_CLI_UNAVAILABLE');
    }
    const active = await (options.getActiveJob ?? getActiveJobDetailsByType)(project.id, POPUP_ANALYSIS_JOB_TYPE);
    if (active) {
      const payload = z.object({ backend: PopupBackendSchema, density: z.enum(POPUP_DENSITIES), cliModel: z.string().nullable().optional() }).passthrough().safeParse(active.payload);
      const activeModel = payload.success ? payload.data.cliModel ?? null : null;
      if (!payload.success || payload.data.backend !== body.backend || payload.data.density !== density || activeModel !== (body.cliModel ?? null)) {
        throw new AppError('Đang có job phân tích popup với backend, model hoặc mật độ khác.', 409, 'POPUP_ANALYSIS_BACKEND_MISMATCH');
      }
      res.status(200).json({ jobId: active.id });
      return;
    }
    const payload = {
      projectId: project.id,
      backend: body.backend,
      density,
      ...(body.cliModel ? { cliModel: body.cliModel } : {}),
    };
    const job = await options.enqueueJob({ type: POPUP_ANALYSIS_JOB_TYPE, projectId: project.id, payload });
    res.status(201).json({ jobId: job.id });
  });

  router.get('/:id/name-keywords/previews', async (req, res) => {
    const project = await getProject(req.params.id);
    const selections = project.keywordPopupsEnabled ? selectProjectSceneKeywords(project.scenes) : project.scenes.map((scene) => ({ sceneId: scene.id, popup: null }));
    res.json(selections.map(({ sceneId, popup }) => ({ sceneId, popup })));
  });

  router.post('/:id/scenes/generate-all-sfx', async (req, res) => {
    const { onlyMissing } = GenerateSfxSchema.parse(req.body ?? {});
    const project = await getProject(req.params.id);
    const job = await options.enqueueJob({ type: 'generate-all-sfx', projectId: project.id, payload: { projectId: project.id, onlyMissing } });
    res.status(201).json({ jobId: job.id });
  });

  router.post('/:id/scenes/generate-depth-maps', async (req, res) => {
    const project = await getProject(req.params.id);
    const active = await getActiveJobByType(project.id, 'generate-depth-maps');
    if (active) { res.status(200).json({ jobId: active.id }); return; }
    const job = await options.enqueueJob({ type: 'generate-depth-maps', projectId: project.id, payload: { projectId: project.id } });
    res.status(201).json({ jobId: job.id });
  });

  router.post('/:id/scenes/:sceneId/regenerate-voiceover', async (req, res) => {
    const opts = VoiceoverOptionsSchema.parse(req.body ?? {});
    await generateSceneVoiceover(req.params.id, req.params.sceneId, opts);
    res.json(await getProject(req.params.id));
  });

  router.get('/:id/scenes/:sceneId/render-preview', async (req, res) => {
    const buffer = await renderScenePreviewBuffer(req.params.id, req.params.sceneId);
    res.type('video/mp4').send(buffer);
  });

  router.post('/:id/scenes/:sceneId/generate-sfx', async (req, res) => {
    await generateSceneSfx(req.params.id, req.params.sceneId);
    res.json(await getProject(req.params.id));
  });

  router.post('/:id/generate-bgm', async (req, res) => {
    const { mood } = BgmSchema.parse(req.body);
    await generateProjectBgm(req.params.id, mood);
    res.json(await getProject(req.params.id));
  });

  router.put('/:id/logo', uploadLogo, async (req, res) => {
    const file = req.file;
    if (!file) throw new AppError('Vui lòng chọn tệp logo.', 400, 'FILE_REQUIRED');
    if (!LOGO_MIME_TYPES.has(file.mimetype)) throw new AppError('Logo phải là PNG, JPEG hoặc WebP.', 400, 'INVALID_FILE_TYPE');
    res.json(await replaceProjectLogo(String(req.params.id), file));
  });

  router.delete('/:id/logo', async (req, res) => {
    res.json(await removeProjectLogo(String(req.params.id)));
  });

  router.post('/:id/render', async (req, res) => {
    const { draft } = RenderSchema.parse(req.body ?? {});
    const project = await getProject(req.params.id);
    const activePopupAnalysis = await getActiveJobByType(project.id, POPUP_ANALYSIS_JOB_TYPE);
    if (activePopupAnalysis) throw new AppError('Không thể render khi phân tích popup đang ghi dữ liệu.', 409, 'POPUP_ANALYSIS_IN_PROGRESS');
    assertProjectRenderReady(project);
    if (draft && project.renderEngine === 'ffmpeg') throw new AppError('Draft render is available only with Remotion.', 422, 'DRAFT_REQUIRES_REMOTION');
    const job = await options.enqueueJob({ type: 'render-full-video', projectId: project.id, payload: { projectId: project.id, draft } });
    res.status(201).json({ jobId: job.id });
  });

  router.patch('/:id/render-engine', async (req, res) => {
    const { engine } = RenderEngineSchema.parse(req.body);
    res.json(await setProjectRenderEngine(req.params.id, engine));
  });

  router.patch('/:id/keyword-popups', async (req, res) => {
    const { enabled } = KeywordPopupsSchema.parse(req.body);
    res.json(await setProjectKeywordPopups(req.params.id, enabled));
  });

  router.patch('/:id/popup-density', async (req, res) => {
    const { density } = PopupDensitySettingSchema.parse(req.body);
    res.json(await setProjectPopupDensity(req.params.id, density));
  });

  router.patch('/:id/transition-style', async (req, res) => {
    const { style } = TransitionStyleSchema.parse(req.body);
    res.json(await setProjectTransitionStyle(req.params.id, style));
  });

  router.patch('/:id/film-look', async (req, res) => {
    const { style } = FilmLookSchema.parse(req.body);
    res.json(await setProjectFilmLook(req.params.id, style));
  });

  router.patch('/:id/parallax', async (req, res) => {
    const { style } = ParallaxSchema.parse(req.body);
    res.json(await setProjectParallax(req.params.id, style));
  });

  router.patch('/:id/scene-tail', async (req, res) => {
    const { sceneTailSec } = SceneTailSchema.parse(req.body);
    res.json(await setProjectSceneTailSec(req.params.id, sceneTailSec));
  });

  router.patch('/:id/sfx-volume', async (req, res) => {
    const { sfxVolume } = SfxVolumeSettingSchema.parse(req.body);
    res.json(await setProjectSfxVolume(req.params.id, sfxVolume));
  });

  router.patch('/:id/voice-speed', async (req, res) => {
    const { voiceSpeed } = VoiceSpeedSettingSchema.parse(req.body);
    res.json(await setProjectVoiceSpeed(req.params.id, voiceSpeed));
  });

  router.post('/:id/scenes/recompute-durations', async (req, res) => {
    const project = await getProject(req.params.id);
    const activeRender = await getActiveJobByType(project.id, 'render-full-video');
    if (activeRender) throw new AppError('Không thể tính lại thời lượng khi render đang chạy.', 409, 'RENDER_IN_PROGRESS');
    const result = await recomputeProjectSceneDurations(project.id, async () => undefined, async () => undefined);
    res.json(result);
  });

  return router;
}
