import type { JobHandler } from '../server/modules/job';
import { handleFinalQa, handleGenerateScript, handleGenerateVisualPrompts, handleSplitScenes } from '../server/modules/script';
import { generateProjectSfx, generateProjectVoiceovers, renderFullProject } from '../server/modules/video';

function projectIdFrom(job: { payload: unknown }): string {
  const projectId = (job.payload as { projectId?: unknown } | null)?.projectId;
  if (typeof projectId !== 'string' || !projectId) throw new Error('Job payload is missing projectId.');
  return projectId;
}

const handleGenerateVoiceover: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  await generateProjectVoiceovers(projectIdFrom(job), context.appendLog, context.reportProgress);
};

const handleGenerateAllSfx: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  await generateProjectSfx(projectIdFrom(job), context.appendLog, context.reportProgress);
};

const handleRenderFullVideo: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  await renderFullProject(projectIdFrom(job), context.appendLog, context.reportProgress);
};

export const jobHandlers: Record<string, JobHandler> = {
  'generate-script': handleGenerateScript,
  'generate-visual-prompts': handleGenerateVisualPrompts,
  'split-scenes': handleSplitScenes,
  'final-qa': handleFinalQa,
  'generate-voiceover': handleGenerateVoiceover,
  'generate-all-sfx': handleGenerateAllSfx,
  'render-full-video': handleRenderFullVideo,
};
