import type { ProjectDetail } from '../../../contracts/project';
import type { Channel } from '../../../contracts/channel';
import { getDefaultAiModelId } from '../../../contracts/ai-models';
import { ensureShortsHashtag, SEO_SECTIONS, type GeneratedSeoSections, type SeoSection } from '../../../contracts/seo';
import { mergeChannelHashtags } from '../../../contracts/seo-format';
import { pickShortsWindows } from '../../../contracts/seo-shorts';
import { getAiClient } from '../../shared/ai';
import { NotFound } from '../../shared/errors';
import { getChannel } from '../channel';
import { getProject, applyGeneratedSeoSections } from '../project';
import { buildSeoPrompt, buildShortsPrompt, SEO_SHORTS_PROMPT_VERSION } from './ai/build-prompt';
import { parseSeoOutput, parseShortsOutput, SeoAiOutputError } from './ai/parse-output';

export type SeoGenerationContext = {
  reportProgress: (percent: number, result?: unknown) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
};

function uniqueSections(sections: readonly SeoSection[]): SeoSection[] {
  return [...new Set(sections.length > 0 ? sections : SEO_SECTIONS)];
}

export async function getSeoChannel(project: ProjectDetail): Promise<Channel | undefined> {
  if (!project.channelId) return undefined;
  try {
    return await getChannel(project.channelId);
  } catch (error) {
    if (error instanceof NotFound) return undefined;
    throw error;
  }
}

export function mergeGeneratedChannelDefaults(
  sections: readonly SeoSection[],
  generated: Omit<GeneratedSeoSections, 'generatedBy'>,
  channel?: Channel,
): Omit<GeneratedSeoSections, 'generatedBy'> {
  if (!channel || !sections.includes('tags') || !generated.hashtags) return generated;
  return { ...generated, hashtags: mergeChannelHashtags(generated.hashtags, channel.defaultHashtags, generated.tags ?? []) };
}

export function mergeGeneratedShortsChannelDefaults(
  generated: Pick<GeneratedSeoSections, 'shorts'>,
  channel?: Channel,
): Pick<GeneratedSeoSections, 'shorts'> {
  return {
    shorts: (generated.shorts ?? []).map((short) => ({
      ...short,
      hashtags: ensureShortsHashtag(channel
        ? mergeChannelHashtags(short.hashtags, channel.defaultHashtags)
        : short.hashtags),
    })),
  };
}

type SeoPrompt = { system: string; user: string; promptVersion: string };

async function requestValidatedOutput<T>(
  client: ReturnType<typeof getAiClient>,
  prompt: SeoPrompt,
  parse: (raw: string) => T,
  context: SeoGenerationContext,
  label: string,
): Promise<T | undefined> {
  let validationError = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await context.isCancelled()) return undefined;
    const user = validationError
      ? `${prompt.user}\n\nValidation error: ${validationError}\nReturn corrected JSON for exactly the requested ${label}.`
      : prompt.user;
    const raw = await client.chat([
      { role: 'system', content: prompt.system },
      { role: 'user', content: user },
    ], { json: true });
    if (await context.isCancelled()) return undefined;
    try {
      return parse(raw);
    } catch (error) {
      if (!(error instanceof SeoAiOutputError) || attempt === 1) throw error;
      validationError = error.message;
      await context.appendLog(`SEO ${label} response invalid; retrying once: ${validationError}`);
    }
  }
  return undefined;
}

export async function generateSeoPackage(
  projectId: string,
  sections: readonly SeoSection[] = SEO_SECTIONS,
  context: SeoGenerationContext,
): Promise<ProjectDetail> {
  const project = await getProject(projectId);
  const requested = uniqueSections(sections);
  if (await context.isCancelled()) return project;

  const channel = await getSeoChannel(project);
  const mainSections = requested.filter((section) => section !== 'shorts');
  const wantsShorts = requested.includes('shorts');
  const windows = wantsShorts ? pickShortsWindows(project).windows : [];
  const parsed: Partial<Omit<GeneratedSeoSections, 'generatedBy'>> = {};
  let client: ReturnType<typeof getAiClient> | undefined;
  let promptVersion = SEO_SHORTS_PROMPT_VERSION;

  if (mainSections.length > 0) {
    const prompt = buildSeoPrompt(project, mainSections, channel);
    client = getAiClient(project.aiProvider, project.aiModel);
    const mainParsed = await requestValidatedOutput(client, prompt, (raw) => parseSeoOutput(raw, mainSections), context, 'requested sections');
    if (!mainParsed) return getProject(projectId);
    Object.assign(parsed, mergeGeneratedChannelDefaults(mainSections, mainParsed, channel));
    promptVersion = prompt.promptVersion;
  }

  if (wantsShorts) {
    if (windows.length === 0) {
      parsed.shorts = [];
    } else {
      const prompt = buildShortsPrompt(project, windows, channel);
      client ??= getAiClient(project.aiProvider, project.aiModel);
      const shortsParsed = await requestValidatedOutput(client, prompt, (raw) => parseShortsOutput(raw, windows), context, 'Shorts windows');
      if (!shortsParsed) return getProject(projectId);
      Object.assign(parsed, mergeGeneratedShortsChannelDefaults(shortsParsed, channel));
      if (mainSections.length === 0) promptVersion = prompt.promptVersion;
    }
  }

  if (await context.isCancelled()) return getProject(projectId);
  const activeClient = client;
  const generated: GeneratedSeoSections = {
    ...parsed,
    generatedBy: {
      provider: project.aiProvider,
      model: activeClient?.model ?? project.aiModel ?? getDefaultAiModelId(project.aiProvider),
      promptVersion,
      generatedAt: new Date().toISOString(),
    },
  };
  const saved = await applyGeneratedSeoSections(projectId, requested, generated);
  await context.reportProgress(100, saved.seo);
  return saved;
}
