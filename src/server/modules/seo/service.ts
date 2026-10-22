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

type SeoGenerationStep = { kind: 'main'; sections: SeoSection[]; name: 'Phần chính' } | { kind: 'shorts'; windows: ReturnType<typeof pickShortsWindows>['windows']; name: 'Shorts' };
type SeoStepProgress = { index: number; total: number; name: SeoGenerationStep['name'] };

const SEO_STEP_PROGRESS_START = 5;
const SEO_STEP_PROGRESS_END = 95;
const SEO_HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_SEO_HEARTBEATS_PER_STEP = 20;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function stepPrefix(step: SeoStepProgress): string {
  return `Bước ${step.index}/${step.total} — ${step.name}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requestValidatedOutput<T>(
  backend: SeoGenerationBackend,
  prompt: SeoPrompt,
  parse: (raw: string) => T,
  context: SeoGenerationContext,
  label: string,
  step: SeoStepProgress,
): Promise<T | undefined> {
  let validationError = '';
  let heartbeatCount = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await context.isCancelled()) return undefined;
    const user = validationError
      ? `${prompt.user}\n\nValidation error: ${validationError}\nReturn corrected JSON for exactly the requested ${label}.`
      : prompt.user;
    const messages: ChatMessage[] = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: user },
    ];
    const promptBytes = messages.reduce((sum, message) => sum + Buffer.byteLength(message.content, 'utf8'), 0);
    const startedAt = Date.now();
    await context.appendLog(`${stepPrefix(step)}: gửi yêu cầu (${promptBytes} byte).`);

    let raw = '';
    let chatError: unknown;
    let chatFailed = false;
    let heartbeatError: unknown;
    let heartbeatTask: Promise<void> | null = null;
    const heartbeatTimer = setInterval(() => {
      if (heartbeatTask || heartbeatCount >= MAX_SEO_HEARTBEATS_PER_STEP) {
        if (heartbeatCount >= MAX_SEO_HEARTBEATS_PER_STEP) clearInterval(heartbeatTimer);
        return;
      }
      heartbeatTask = (async () => {
        if (await context.isCancelled()) {
          clearInterval(heartbeatTimer);
          return;
        }
        if (heartbeatCount >= MAX_SEO_HEARTBEATS_PER_STEP) {
          clearInterval(heartbeatTimer);
          return;
        }
        heartbeatCount += 1;
        await context.appendLog(`${stepPrefix(step)}: vẫn đang chờ (${formatElapsed(Date.now() - startedAt)})…`);
        if (heartbeatCount >= MAX_SEO_HEARTBEATS_PER_STEP) clearInterval(heartbeatTimer);
      })().catch((error: unknown) => {
        heartbeatError = error;
        clearInterval(heartbeatTimer);
      }).finally(() => {
        heartbeatTask = null;
      });
    }, SEO_HEARTBEAT_INTERVAL_MS);
    try {
      raw = await backend.chat(messages, { stepLabel: `${label.replaceAll(' ', '-')}${attempt ? '-retry' : ''}` });
    } catch (error) {
      chatFailed = true;
      chatError = error;
    } finally {
      clearInterval(heartbeatTimer);
      if (heartbeatTask) await heartbeatTask;
    }
    if (heartbeatError) throw heartbeatError;
    if (await context.isCancelled()) return undefined;
    if (chatFailed) throw chatError;
    await context.appendLog(`${stepPrefix(step)}: nhận phản hồi sau ${formatElapsed(Date.now() - startedAt)} (${Buffer.byteLength(raw, 'utf8')} byte).`);
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
      await context.appendLog(`${stepPrefix(step)}: JSON chưa hợp lệ, thử lại 1 lần: ${validationError}`);
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
  const steps: SeoGenerationStep[] = [];
  if (mainSections.length > 0) steps.push({ kind: 'main', sections: mainSections, name: 'Phần chính' });
  if (wantsShorts && windows.length > 0) steps.push({ kind: 'shorts', windows, name: 'Shorts' });

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

  if (steps.length === 0 && wantsShorts) parsed.shorts = [];

  const generationStartedAt = Date.now();
  await context.reportProgress(SEO_STEP_PROGRESS_START);
  let backendSetupError: unknown;
  let backendSetupFailed = false;
  if (steps.length > 0) {
    try {
      getBackend();
    } catch (error) {
      backendSetupFailed = true;
      backendSetupError = error;
    }
  }
  const backendKind = activeBackend?.kind ?? 'api';
  const backendModel = activeBackend?.model ?? project.aiModel ?? getDefaultAiModelId(project.aiProvider);
  const stepNames = steps.map((step) => step.name);
  const stepList = stepNames.length > 0 ? stepNames.join(', ') : 'không có phần cần gọi AI';
  const generationMode = backendKind === 'cli' ? `Claude CLI ${backendModel}` : `API ${backendModel}`;
  await context.appendLog(`Bắt đầu tạo gói SEO: ${steps.length} bước (${stepList}). Cách sinh: ${generationMode}.`);
  if (backendSetupFailed) {
    const firstStep = steps[0];
    if (firstStep) await context.appendLog(`${stepPrefix({ index: 1, total: steps.length, name: firstStep.name })}: thất bại — ${errorMessage(backendSetupError)}`);
    throw backendSetupError;
  }

  let lastProgress = SEO_STEP_PROGRESS_START;
  async function reportStepProgress(progress: number): Promise<void> {
    if (progress === lastProgress) return;
    lastProgress = progress;
    await context.reportProgress(progress);
  }

  for (const [index, step] of steps.entries()) {
    const stepInfo: SeoStepProgress = { index: index + 1, total: steps.length, name: step.name };
    const startProgress = SEO_STEP_PROGRESS_START + (SEO_STEP_PROGRESS_END - SEO_STEP_PROGRESS_START) * index / steps.length;
    const endProgress = SEO_STEP_PROGRESS_START + (SEO_STEP_PROGRESS_END - SEO_STEP_PROGRESS_START) * (index + 1) / steps.length;
    await reportStepProgress(startProgress);
    if (await context.isCancelled()) {
      await context.appendLog(`Đã hủy ở bước ${stepInfo.index}/${stepInfo.total}.`);
      return getProject(projectId);
    }

    try {
      if (step.kind === 'main') {
        const prompt = buildSeoPrompt(project, step.sections, channel);
        const mainParsed = await requestValidatedOutput(getBackend(), prompt, (raw) => parseSeoOutput(raw, step.sections), context, 'requested sections', stepInfo);
        if (!mainParsed) {
          if (await context.isCancelled()) await context.appendLog(`Đã hủy ở bước ${stepInfo.index}/${stepInfo.total}.`);
          return getProject(projectId);
        }
        Object.assign(parsed, mergeGeneratedChannelDefaults(step.sections, mainParsed, channel));
        promptVersion = prompt.promptVersion;
      } else {
        const prompt = buildShortsPrompt(project, step.windows, channel);
        const shortsParsed = await requestValidatedOutput(getBackend(), prompt, (raw) => parseShortsOutput(raw, step.windows), context, 'Shorts windows', stepInfo);
        if (!shortsParsed) {
          if (await context.isCancelled()) await context.appendLog(`Đã hủy ở bước ${stepInfo.index}/${stepInfo.total}.`);
          return getProject(projectId);
        }
        Object.assign(parsed, mergeGeneratedShortsChannelDefaults(shortsParsed, channel));
        if (mainSections.length === 0) promptVersion = prompt.promptVersion;
      }
    } catch (error) {
      if (await context.isCancelled()) {
        await context.appendLog(`Đã hủy ở bước ${stepInfo.index}/${stepInfo.total}.`);
        return getProject(projectId);
      }
      await context.appendLog(`${stepPrefix(stepInfo)}: thất bại — ${errorMessage(error)}`);
      throw error;
    }

    if (await context.isCancelled()) {
      await context.appendLog(`Đã hủy ở bước ${stepInfo.index}/${stepInfo.total}.`);
      return getProject(projectId);
    }
    await reportStepProgress(endProgress);
    await context.appendLog(`${stepPrefix(stepInfo)}: xong.`);
  }

  if (await context.isCancelled()) {
    const lastStep = steps.at(-1);
    if (lastStep) await context.appendLog(`Đã hủy ở bước ${steps.length}/${steps.length}.`);
    return getProject(projectId);
  }
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
  await context.appendLog(`Đã lưu gói SEO. Tổng thời gian ${formatElapsed(Date.now() - generationStartedAt)}.`);
  return saved;
}
