import type { JobHandler } from '../server/modules/job';
import { handleCliRegeneration, handleFinalQa, handleGenerateScript, handleGenerateVisualPrompts, handleSplitScenes } from '../server/modules/script';
import { getProject } from '../server/modules/project';
import { generateSeoPackage } from '../server/modules/seo';
import { SEO_SECTIONS, type SeoSection } from '../contracts/seo';
import { alignProjectWordTimings, autoAnalyzeProjectNameKeywordsIfStale, generateProjectDepthMaps, generateSceneDepthMap, generateProjectSfx, generateProjectVoiceovers, renderFullProject } from '../server/modules/video';
import { AiRequestError } from '../server/shared/ai/errors';
import { logger } from '../server/shared/logger';

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
  await alignProjectWordTimings(projectId, context.appendLog, context.reportProgress, context.isCancelled);
  if (await context.isCancelled()) return;
  await autoAnalyzeProjectNameKeywordsIfStale(projectId, context.appendLog);
};

const handleGenerateAllSfx: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  const payload = job.payload as { onlyMissing?: unknown };
  return generateProjectSfx(projectIdFrom(job), context.appendLog, context.reportProgress, { onlyMissing: payload.onlyMissing === true });
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
  const payload = job.payload as { draft?: unknown };
  await renderFullProject(projectIdFrom(job), context.appendLog, context.reportProgress, payload.draft === true ? { draft: true } : undefined);
};

const handleGenerateSeo: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  const payload = job.payload as { sections?: unknown };
  const sections = Array.isArray(payload.sections)
    ? payload.sections as SeoSection[]
    : [...SEO_SECTIONS];
  await generateSeoPackage(projectIdFrom(job), sections, context);
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
  'generate-all-sfx': handleGenerateAllSfx,
  'generate-depth-maps': handleGenerateDepthMaps,
  'generate-depth-map': handleGenerateDepthMap,
  'render-full-video': handleRenderFullVideo,
  'generate-seo': handleGenerateSeo,
};
