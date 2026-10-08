import { getAiClient } from '../../shared/ai';
import { getAiModelDefinition } from '../../../contracts/ai-models';
import { AppError } from '../../shared/errors';
import { getProject } from '../project';
import { buildQaPrompt } from './ai/build-prompt';
import { parseQaResult } from './ai/parse-output';
import type { QAResult } from './ai/qa-schema';

export type FinalQaJobContext = {
  reportProgress: (percent: number, result?: unknown) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
};

function getQaOutputBudgets(chapterCount: number, modelOutputCap: number): { initial: number; retry: number } {
  const cap = Math.min(16_000, modelOutputCap);
  const initial = Math.min(cap, 2_000 + chapterCount * 800);
  return { initial, retry: Math.min(cap, Math.ceil(initial * 1.5)) };
}

export async function runFinalQa(projectId: string, context: FinalQaJobContext): Promise<QAResult> {
  const project = await getProject(projectId);
  if (await context.isCancelled()) return { issues: [] };
  const prompt = buildQaPrompt(project);
  const client = getAiClient(project.aiProvider, project.aiModel);
  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ] as const;
  const modelOutputCap = getAiModelDefinition(project.aiProvider, client.model)?.capabilities.maxOutputTokens ?? 16_000;
  const chapterCount = Math.max(1, project.chapters.length, project.chapterCount ?? 0);
  const budgets = getQaOutputBudgets(chapterCount, modelOutputCap);
  const call = async (maxTokens: number) => client.chatWithMetadata
    ? client.chatWithMetadata([...messages], { maxTokens, json: true })
    : client.chat([...messages], { maxTokens, json: true }).then((text) => ({ text, truncated: false }));
  let response = await call(budgets.initial);
  if (await context.isCancelled()) return { issues: [] };
  if (response.truncated) {
    if (budgets.retry > budgets.initial) {
      await context.appendLog(`Final QA response truncated at ${budgets.initial} output tokens; retrying once with ${budgets.retry}.`);
      if (await context.isCancelled()) return { issues: [] };
      response = await call(budgets.retry);
    } else {
      await context.appendLog(`Final QA response truncated at the ${budgets.initial}-token output budget; the selected model has no larger available output budget.`);
    }
    if (await context.isCancelled()) return { issues: [] };
    if (response.truncated) {
      throw new AppError('AI response remained truncated after the one larger final QA request.', 503, 'AI_RESPONSE_TRUNCATED');
    }
  }
  if (await context.isCancelled()) return { issues: [] };
  const result = parseQaResult(response.text);
  const reviewed = { ...result, reviewedBy: { provider: project.aiProvider, model: client.model } };
  await context.reportProgress(100);
  await context.appendLog(`Final QA finished by ${project.aiProvider}/${client.model}: ${result.issues.length} issue${result.issues.length === 1 ? '' : 's'} found.`);
  return reviewed;
}
