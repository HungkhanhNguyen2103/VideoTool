import type { JobHandler } from '../server/modules/job';
import { handleGenerateScript, handleGenerateVisualPrompts } from '../server/modules/script';
import { generateProjectVoiceovers, renderFullProject } from '../server/modules/video';

function projectIdFrom(job: { payload: unknown }): string {
  const projectId = (job.payload as { projectId?: unknown } | null)?.projectId;
  if (typeof projectId !== 'string' || !projectId) throw new Error('Job payload is missing projectId.');
  return projectId;
}

const handleGenerateVoiceover: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  await generateProjectVoiceovers(projectIdFrom(job), context.appendLog);
};

const handleRenderFullVideo: JobHandler = async (job, context) => {
  if (await context.isCancelled()) return;
  await renderFullProject(projectIdFrom(job), context.appendLog);
};

export const jobHandlers: Record<string, JobHandler> = {
  'generate-script': handleGenerateScript,
  'generate-visual-prompts': handleGenerateVisualPrompts,
  'generate-voiceover': handleGenerateVoiceover,
  'render-full-video': handleRenderFullVideo,
};
