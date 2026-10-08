import { getAiClient } from '../../shared/ai';
import { getProject } from '../project';
import { buildQaPrompt } from './ai/build-prompt';
import { parseQaResult } from './ai/parse-output';
import type { QAResult } from './ai/qa-schema';

export type FinalQaJobContext = {
  reportProgress: (percent: number, result?: unknown) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
};

export async function runFinalQa(projectId: string, context: FinalQaJobContext): Promise<QAResult> {
  const project = await getProject(projectId);
  if (await context.isCancelled()) return { issues: [] };
  const prompt = buildQaPrompt(project);
  const client = getAiClient(project.aiProvider, project.aiModel);
  const raw = await client.chat([
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ]);
  if (await context.isCancelled()) return { issues: [] };
  const result = parseQaResult(raw);
  const reviewed = { ...result, reviewedBy: { provider: project.aiProvider, model: client.model } };
  await context.reportProgress(100);
  await context.appendLog(`Final QA finished by ${project.aiProvider}/${client.model}: ${result.issues.length} issue${result.issues.length === 1 ? '' : 's'} found.`);
  return reviewed;
}
