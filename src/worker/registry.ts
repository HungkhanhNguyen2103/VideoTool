import type { JobHandler } from '../server/modules/job';
import { handleFinalQa, handleGenerateScript, handleGenerateVisualPrompts, handleSplitScenes } from '../server/modules/script';
import { getProject } from '../server/modules/project';
import { alignProjectWordTimings, generateProjectDepthMaps, generateSceneDepthMap, generateProjectSfx, generateProjectVoiceovers, renderFullProject } from '../server/modules/video';
import { AiRequestError } from '../server/shared/ai/errors';
import { logger } from '../server/shared/logger';

function projectIdFrom(job: { payload: unknown }): string {
  const projectId = (job.payload as { projectId?: unknown } | null)?.projectId;
  if (typeof projectId !== 'string' || !projectId) throw new Error('Job payload is missing projectId.');
  return projectId;
}

const handleGenerateVoiceover: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  return generateProjectVoiceovers(projectIdFrom(job), context.appendLog, context.reportProgress);
};

const handleAlignWordTimings: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  await alignProjectWordTimings(projectIdFrom(job), context.appendLog, context.reportProgress, context.isCancelled);
};

const handleGenerateAllSfx: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  await generateProjectSfx(projectIdFrom(job), context.appendLog, context.reportProgress);
};

const handleGenerateDepthMaps: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  await generateProjectDepthMaps(projectIdFrom(job), context.appendLog, context.reportProgress, context.isCancelled);
};

const handleGenerateDepthMap: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  const payload = job.payload as { projectId?: unknown; sceneId?: unknown };
  if (typeof payload.sceneId !== 'string' || !payload.sceneId) throw new Error('Job payload is missing sceneId.');
  const loaded = await getProject(projectIdFrom(job));
  const scene = loaded.scenes.find((candidate) => candidate.id === payload.sceneId);
  if (!scene) return;
  await generateSceneDepthMap(projectIdFrom(job), scene);
};

const handleRenderFullVideo: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  await renderFullProject(projectIdFrom(job), context.appendLog, context.reportProgress);
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
  'generate-voiceover': handleGenerateVoiceover,
  'align-word-timings': handleAlignWordTimings,
  'generate-all-sfx': handleGenerateAllSfx,
  'generate-depth-maps': handleGenerateDepthMaps,
  'generate-depth-map': handleGenerateDepthMap,
  'render-full-video': handleRenderFullVideo,
};
