import type { ProjectDetail } from '../../../contracts/project';
import { SEO_SECTIONS, type GeneratedSeoSections, type SeoSection } from '../../../contracts/seo';
import { getAiClient } from '../../shared/ai';
import { getProject, applyGeneratedSeoSections } from '../project';
import { buildSeoPrompt } from './ai/build-prompt';
import { parseSeoOutput, SeoAiOutputError } from './ai/parse-output';

export type SeoGenerationContext = {
  reportProgress: (percent: number, result?: unknown) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
};

function uniqueSections(sections: readonly SeoSection[]): SeoSection[] {
  return [...new Set(sections.length > 0 ? sections : SEO_SECTIONS)];
}

export async function generateSeoPackage(
  projectId: string,
  sections: readonly SeoSection[] = SEO_SECTIONS,
  context: SeoGenerationContext,
): Promise<ProjectDetail> {
  const project = await getProject(projectId);
  const requested = uniqueSections(sections);
  if (await context.isCancelled()) return project;

  const prompt = buildSeoPrompt(project, requested);
  const client = getAiClient(project.aiProvider, project.aiModel);
  let parsed: Omit<GeneratedSeoSections, 'generatedBy'> | undefined;
  let validationError = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await context.isCancelled()) return getProject(projectId);
    const user = validationError
      ? `${prompt.user}\n\nValidation error: ${validationError}\nReturn corrected JSON for exactly the requested sections.`
      : prompt.user;
    const raw = await client.chat([
      { role: 'system', content: prompt.system },
      { role: 'user', content: user },
    ], { json: true });
    if (await context.isCancelled()) return getProject(projectId);
    try {
      parsed = parseSeoOutput(raw, requested);
      break;
    } catch (error) {
      if (!(error instanceof SeoAiOutputError) || attempt === 1) throw error;
      validationError = error.message;
      await context.appendLog(`SEO response invalid; retrying once: ${validationError}`);
    }
  }

  if (!parsed) throw new SeoAiOutputError('root: empty parsed output');
  if (await context.isCancelled()) return getProject(projectId);
  const generated: GeneratedSeoSections = {
    ...parsed,
    generatedBy: {
      provider: project.aiProvider,
      model: client.model,
      promptVersion: prompt.promptVersion,
      generatedAt: new Date().toISOString(),
    },
  };
  const saved = await applyGeneratedSeoSections(projectId, requested, generated);
  await context.reportProgress(100, saved.seo);
  return saved;
}
