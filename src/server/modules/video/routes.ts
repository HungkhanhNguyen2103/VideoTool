import { Router } from 'express';
import { z } from 'zod';
import { getProject, setProjectFilmLook, setProjectKeywordPopups, setProjectParallax, setProjectRenderEngine, setProjectSceneTailSec, setProjectTransitionStyle } from '../project';
import { FILM_LOOK_STYLES, PARALLAX_STYLES, RENDER_ENGINES, TRANSITION_STYLES } from '../../../contracts/project';
import { SceneTailSecSchema } from '../../../contracts/scene-duration';
import { getActiveJobByType } from '../job';
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

type EnqueueVideoJob = (input: { type: string; projectId: string; payload: unknown }) => Promise<{ id: string }>;
type AnalyzeNameKeywords = (projectId: string) => Promise<NameKeywordAnalysisSummary>;

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
const RenderSchema = z.object({ draft: z.boolean().optional().default(false) }).strict();

export function createVideoRouter(options: { enqueueJob: EnqueueVideoJob; analyzeNameKeywords?: AnalyzeNameKeywords }): Router {
  const router = Router();

  router.post('/:id/scenes/generate-voiceover', async (req, res) => {
    const project = await getProject(req.params.id);
    const job = await options.enqueueJob({ type: 'generate-voiceover', projectId: project.id, payload: { projectId: project.id } });
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

  router.get('/:id/name-keywords/previews', async (req, res) => {
    const project = await getProject(req.params.id);
    const selections = project.keywordPopupsEnabled ? selectProjectSceneKeywords(project.scenes) : project.scenes.map((scene) => ({ sceneId: scene.id, popup: null }));
    res.json(selections.map(({ sceneId, popup }) => ({ sceneId, popup })));
  });

  router.post('/:id/scenes/generate-all-sfx', async (req, res) => {
    const project = await getProject(req.params.id);
    const job = await options.enqueueJob({ type: 'generate-all-sfx', projectId: project.id, payload: { projectId: project.id } });
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

  router.post('/:id/scenes/recompute-durations', async (req, res) => {
    const project = await getProject(req.params.id);
    const activeRender = await getActiveJobByType(project.id, 'render-full-video');
    if (activeRender) throw new AppError('Không thể tính lại thời lượng khi render đang chạy.', 409, 'RENDER_IN_PROGRESS');
    const result = await recomputeProjectSceneDurations(project.id, async () => undefined, async () => undefined);
    res.json(result);
  });

  return router;
}
