import type { ProjectDetail } from '../../../contracts/project';
import type { Channel } from '../../../contracts/channel';
import { getDefaultAiModelId } from '../../../contracts/ai-models';
import { ensureShortsHashtag, SEO_SECTIONS, type GeneratedSeoSections, type SeoSection } from '../../../contracts/seo';
import { mergeChannelHashtags } from '../../../contracts/seo-format';
import { pickShortsWindows } from '../../../contracts/seo-shorts';
import { getAiClient } from '../../shared/ai';
import type { ChatMessage } from '../../shared/ai';
import { parseJsonWithLeadingText } from '../../shared/claude-cli/json-output';
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

export type SeoGenerationBackend = {
  kind: 'api' | 'cli';
  model: string;
  chat: (messages: ChatMessage[], options?: { stepLabel?: string }) => Promise<string>;
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
  backend: SeoGenerationBackend,
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
    let raw: string;
    try {
      raw = await backend.chat([
        { role: 'system', content: prompt.system },
        { role: 'user', content: user },
      ], { stepLabel: `${label.replaceAll(' ', '-')}${attempt ? '-retry' : ''}` });
    } catch (error) {
      if (await context.isCancelled()) return undefined;
      throw error;
    }
    if (await context.isCancelled()) return undefined;
    try {
      let output = raw;
      if (backend.kind === 'cli') {
        let leadingTextBytes = 0;
        try {
          output = JSON.stringify(parseJsonWithLeadingText(raw, (leadingText) => {
            leadingTextBytes = Buffer.byteLength(leadingText, 'utf8');
          }));
        } catch {
          throw new SeoAiOutputError('root: invalid JSON');
        }
        if (leadingTextBytes > 0) await context.appendLog(`Claude CLI SEO ${label} response had leading text before JSON (${leadingTextBytes} bytes).`);
      }
      return parse(output);
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
  backend?: SeoGenerationBackend,
): Promise<ProjectDetail> {
  const project = await getProject(projectId);
  const requested = uniqueSections(sections);
  if (await context.isCancelled()) return project;

  const channel = await getSeoChannel(project);
  const mainSections = requested.filter((section) => section !== 'shorts');
  const wantsShorts = requested.includes('shorts');
  const windows = wantsShorts ? pickShortsWindows(project).windows : [];
  const parsed: Partial<Omit<GeneratedSeoSections, 'generatedBy'>> = {};
  let activeBackend = backend;
  let promptVersion = SEO_SHORTS_PROMPT_VERSION;

  function getBackend(): SeoGenerationBackend {
    if (activeBackend) return activeBackend;
    const client = getAiClient(project.aiProvider, project.aiModel);
    activeBackend = {
      kind: 'api',
      model: client.model,
      chat: (messages) => client.chat(messages, { json: true }),
    };
    return activeBackend;
  }

  if (mainSections.length > 0) {
    const prompt = buildSeoPrompt(project, mainSections, channel);
    const mainParsed = await requestValidatedOutput(getBackend(), prompt, (raw) => parseSeoOutput(raw, mainSections), context, 'requested sections');
    if (!mainParsed) return getProject(projectId);
    Object.assign(parsed, mergeGeneratedChannelDefaults(mainSections, mainParsed, channel));
    promptVersion = prompt.promptVersion;
  }

  if (wantsShorts) {
    if (windows.length === 0) {
      parsed.shorts = [];
    } else {
      const prompt = buildShortsPrompt(project, windows, channel);
      const shortsParsed = await requestValidatedOutput(getBackend(), prompt, (raw) => parseShortsOutput(raw, windows), context, 'Shorts windows');
      if (!shortsParsed) return getProject(projectId);
      Object.assign(parsed, mergeGeneratedShortsChannelDefaults(shortsParsed, channel));
      if (mainSections.length === 0) promptVersion = prompt.promptVersion;
    }
  }

  if (await context.isCancelled()) return getProject(projectId);
  const generatedByBackend = activeBackend;
  const generated: GeneratedSeoSections = {
    ...parsed,
    generatedBy: {
      provider: generatedByBackend?.kind === 'cli' ? 'claude' : project.aiProvider,
      model: generatedByBackend?.model ?? (project.aiModel ?? getDefaultAiModelId(project.aiProvider)),
      backend: generatedByBackend?.kind ?? 'api',
      promptVersion,
      generatedAt: new Date().toISOString(),
    },
  };
  const saved = await applyGeneratedSeoSections(projectId, requested, generated);
  await context.reportProgress(100, saved.seo);
  return saved;
}
