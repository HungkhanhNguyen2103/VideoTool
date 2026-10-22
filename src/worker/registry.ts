import { z } from 'zod';
import type { JobHandler } from '../server/modules/job';
import { handleCliRegeneration, handleFinalQa, handleGenerateScript, handleGenerateVisualPrompts, handleSplitScenes } from '../server/modules/script';
import { getProject } from '../server/modules/project';
import { generateSeoPackage } from '../server/modules/seo';
import { SEO_SECTIONS, type SeoSection } from '../contracts/seo';
import { alignProjectWordTimings, analyzeProjectPopups, autoAnalyzeProjectPopupsIfStale, generateProjectDepthMaps, generateSceneDepthMap, generateProjectSfx, generateProjectVoiceovers, PopupAnalysisRequestSchema, renderFullProject } from '../server/modules/video';
import { AiRequestError } from '../server/shared/ai/errors';
import { logger } from '../server/shared/logger';
import { isSceneActive } from '../contracts/scene-active';
import { generateYoutubeReviewV2, syncYoutubeChannel } from '../server/modules/youtube';
import { loadConfig } from '../server/config';
import { isAiModelForProvider } from '../contracts/ai-models';
import { AppError } from '../server/shared/errors';
import { createClaudeCliChat } from '../server/shared/claude-cli/cli-chat';

function projectIdFrom(job: { payload: unknown }): string {
  const projectId = (job.payload as { projectId?: unknown } | null)?.projectId;
  if (typeof projectId !== 'string' || !projectId) throw new Error('Job payload is missing projectId.');
  return projectId;
}

const handleGenerateVoiceover: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  const payload = job.payload as { startSceneId?: unknown };
  return generateProjectVoiceovers(projectIdFrom(job), context.appendLog, context.reportProgress, {
    startSceneId: typeof payload.startSceneId === 'string' ? payload.startSceneId : undefined,
    isCancelled: context.isCancelled,
  });
};

const handleAlignWordTimings: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  const projectId = projectIdFrom(job);
  const result = await alignProjectWordTimings(projectId, context.appendLog, context.reportProgress, context.isCancelled);
  if (await context.isCancelled()) return;
  await autoAnalyzeProjectPopupsIfStale(projectId, context.appendLog);
  return result;
};

const handleAnalyzePopups: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  const payload = job.payload as { backend?: unknown; density?: unknown; cliModel?: unknown };
  return analyzeProjectPopups(projectIdFrom(job), PopupAnalysisRequestSchema.parse({
    backend: payload.backend,
    density: payload.density,
    ...(typeof payload.cliModel === 'string' ? { cliModel: payload.cliModel } : {}),
  }), context);
};

const handleGenerateAllSfx: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  const payload = job.payload as { onlyMissing?: unknown };
  return generateProjectSfx(projectIdFrom(job), context.appendLog, context.reportProgress, { onlyMissing: payload.onlyMissing === true });
};

const handleGenerateDepthMaps: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  return generateProjectDepthMaps(projectIdFrom(job), context.appendLog, context.reportProgress, context.isCancelled);
};

const handleGenerateDepthMap: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  const payload = job.payload as { projectId?: unknown; sceneId?: unknown };
  if (typeof payload.sceneId !== 'string' || !payload.sceneId) throw new Error('Job payload is missing sceneId.');
  const loaded = await getProject(projectIdFrom(job));
  const scene = loaded.scenes.find((candidate) => candidate.id === payload.sceneId);
  if (!scene) return;
  if (!isSceneActive(scene)) {
    await context.appendLog(`Scene ${loaded.scenes.findIndex((candidate) => candidate.id === scene.id) + 1}: đang tắt, bỏ qua tạo depth map; skippedInactive: 1.`);
    await context.reportProgress(100);
    return { skipped: 1, skippedInactive: 1 };
  }
  return { outcome: await generateSceneDepthMap(projectIdFrom(job), scene), skippedInactive: 0 };
};

const handleRenderFullVideo: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  const payload = job.payload as { draft?: unknown };
  return renderFullProject(projectIdFrom(job), context.appendLog, context.reportProgress, payload.draft === true ? { draft: true } : undefined);
};

const handleGenerateSeo: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  const payload = job.payload as { sections?: unknown; backend?: unknown; cliModel?: unknown };
  const sections = Array.isArray(payload.sections)
    ? payload.sections as SeoSection[]
    : [...SEO_SECTIONS];
  const projectId = projectIdFrom(job);
  if (payload.backend !== undefined && payload.backend !== 'api' && payload.backend !== 'cli') {
    throw new AppError('Backend tạo gói SEO không hợp lệ.', 422, 'validation_error');
  }
  if (payload.cliModel !== undefined && (typeof payload.cliModel !== 'string' || !isAiModelForProvider('claude', payload.cliModel))) {
    throw new AppError('Model Claude CLI không còn khả dụng; hãy chọn model khác.', 422, 'AI_MODEL_UNAVAILABLE');
  }
  if (payload.backend === 'cli') {
    const config = loadConfig();
    const backend = await createClaudeCliChat({
      projectId,
      chapterId: 'seo-generation',
      label: 'SEO',
      model: typeof payload.cliModel === 'string' ? payload.cliModel : undefined,
      config,
      context,
    });
    await generateSeoPackage(projectId, sections, context, { kind: 'cli', model: backend.model, chat: backend.chat });
    return;
  }
  await generateSeoPackage(projectId, sections, context);
};

const handleYoutubeSync: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  const payload = job.payload as { channelProfileId?: unknown };
  const profileId = typeof payload.channelProfileId === 'string' ? payload.channelProfileId : job.projectId;
  return syncYoutubeChannel(profileId, context);
};

const handleYoutubeReview: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  const payload = z.object({
    channelId: z.string().min(1),
    target: z.enum(['channel', 'video']),
    videoId: z.string().min(1).optional(),
    backend: z.enum(['cli', 'api']).default('cli'),
    cliModel: z.string().min(1).optional(),
  }).strict().refine((value) => value.target !== 'video' || Boolean(value.videoId), { message: 'videoId is required for a video review.' }).parse(job.payload);
  if (payload.cliModel !== undefined && !isAiModelForProvider('claude', payload.cliModel)) {
    throw new AppError('Model Claude CLI không còn khả dụng; hãy chọn model khác.', 422, 'AI_MODEL_UNAVAILABLE');
  }
  return generateYoutubeReviewV2({
    profileId: payload.channelId,
    target: payload.target,
    ...(payload.videoId ? { videoId: payload.videoId } : {}),
    request: { backend: payload.backend, ...(payload.cliModel ? { cliModel: payload.cliModel } : {}) },
    context,
    config: loadConfig(),
  });
};

const handleGenerateScriptWithLogging: JobHandler = async (job, context) => {
  try {
    await handleGenerateScript(job, context);
  } catch (error) {
    if (error instanceof AiRequestError) {
      logger.error('AI request failed.', {
        provider: error.provider,
        status: error.status,
        message: error.message,
      });
    }
    throw error;
  }
};

export const jobHandlers: Record<string, JobHandler> = {
  'generate-script': handleGenerateScriptWithLogging,
  'generate-visual-prompts': handleGenerateVisualPrompts,
  'split-scenes': handleSplitScenes,
  'final-qa': handleFinalQa,
  'regenerate-chapters-claude-cli': handleCliRegeneration,
  'generate-voiceover': handleGenerateVoiceover,
  'align-word-timings': handleAlignWordTimings,
  'analyze-popups': handleAnalyzePopups,
  'generate-all-sfx': handleGenerateAllSfx,
  'generate-depth-maps': handleGenerateDepthMaps,
  'generate-depth-map': handleGenerateDepthMap,
  'render-full-video': handleRenderFullVideo,
  'generate-seo': handleGenerateSeo,
  'youtube-sync': handleYoutubeSync,
  'youtube-review': handleYoutubeReview,
};
