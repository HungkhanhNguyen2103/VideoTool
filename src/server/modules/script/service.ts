import type { ProjectDetail } from '../../../contracts/project';
import { estimateNarrationDurationSec, NARRATION_WORDS_PER_MINUTE, type ChapterDoc, type ChapterSnapshot, type HubrisMotif, type OpenLoop } from '../../../contracts/script';
import { getAiModelDefinition } from '../../../contracts/ai-models';
import { getAiClient, type AiChatMetadata, type AiClient, type ChatMessage } from '../../shared/ai';
import { aiRequestTimeoutMs, normalizeAiError, withAiRequestTimeout, type AiProviderName } from '../../shared/ai/errors';
import { AppError, NotFound } from '../../shared/errors';
import { newId } from '../../shared/ids';
import {
  getProject,
  getProjectHistory,
  patchProjectChapter,
  replaceProjectChapters,
  replaceProjectScript,
  replaceProjectScenes,
  restoreProjectChapters,
} from '../project';
import type { SceneDoc } from '../project';
import { buildChapterExpansionPrompt, buildOutlinePrompt, buildRegenerationPrompt, type BuiltPrompt } from './ai/build-prompt';
import { parseChapterExpansion, parseRegeneratedParagraphs, parseScriptOutline, validateScriptOutlineChapterCount } from './ai/parse-output';
import { countNarrationWords } from '../../../contracts/script';
import { getOutlineOutputBudgets, getShortReferenceWarning, recommendScriptChapterCount, validateScriptOutline } from './ai/outline-validation';
import { summarizeManualScriptQuality } from './quality';

export function snapshotOf(chapters: ChapterDoc[], historyBatchId?: string): ChapterSnapshot {
  return {
    takenAt: new Date(),
    ...(historyBatchId ? { historyBatchId } : {}),
    chapters: chapters.map((chapter) => ({
      ...chapter,
      paragraphs: [...chapter.paragraphs],
      ...(chapter.sourceFacts ? { sourceFacts: [...chapter.sourceFacts] } : {}),
      ...(chapter.holdBack ? { holdBack: [...chapter.holdBack] } : {}),
    })),
  };
}

function paragraphsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((paragraph, index) => paragraph === right[index]);
}

export async function patchChapter(
  projectId: string,
  chapterId: string,
  patch: Partial<Pick<ChapterDoc, 'paragraphs' | 'status' | 'title'>>,
  historyBatchId?: string,
): Promise<ChapterDoc[]> {
  const project = await getProject(projectId);
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new NotFound('Không tìm thấy chương.');
  const normalizedParagraphs = patch.paragraphs?.map((paragraph) => paragraph.trim()).filter(Boolean);
  const paragraphsChanged = normalizedParagraphs !== undefined && !paragraphsEqual(normalizedParagraphs, chapter.paragraphs);
  const titleChanged = patch.title !== undefined && patch.title !== chapter.title;
  const acknowledgesUpstreamChange = paragraphsChanged || titleChanged || patch.status === 'approved';
  const normalizedPatch = {
    ...(paragraphsChanged ? { paragraphs: normalizedParagraphs, status: 'pending' as const } : {}),
    ...(titleChanged ? { title: patch.title } : {}),
    ...(!paragraphsChanged && patch.status !== undefined ? { status: patch.status } : {}),
    ...(acknowledgesUpstreamChange ? { reviewStatus: 'clean' as const } : {}),
  };
  if (Object.keys(normalizedPatch).length === 0) return project.chapters;
  const updated = await patchProjectChapter(projectId, chapterId, normalizedPatch, paragraphsChanged || titleChanged ? snapshotOf(project.chapters, historyBatchId) : null);
  if (paragraphsChanged) {
    const nextChapter = project.chapters.find((item) => item.no === chapter.no + 1);
    if (nextChapter) await patchProjectChapter(projectId, nextChapter.id, { reviewStatus: 'upstream-changed' });
  }
  return paragraphsChanged ? (await getProject(projectId)).chapters : updated.chapters;
}

export async function getChapterHistory(projectId: string): Promise<ChapterSnapshot[]> {
  return getProjectHistory(projectId);
}

export type GeneratedScriptChapter = Pick<ChapterDoc, 'no' | 'title' | 'paragraphs'> &
  Partial<Pick<ChapterDoc, 'scenesCount' | 'durationSec' | 'role' | 'beat' | 'targetWords' | 'endsOnTension' | 'sourceFacts' | 'holdBack' | 'chapterSummary' | 'avoidRepeating' | 'persistentFacts' | 'reviewStatus'>>;

export type ScriptGenerationJobContext = {
  reportProgress: (pct: number, result?: unknown) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
  signal?: AbortSignal;
};

export type ScriptChatCallContext = {
  stepLabel: string;
  signal?: AbortSignal;
  appendLog: (message: string) => Promise<void>;
};

export type ScriptChatBackend = {
  label: string;
  model: string;
  outputTokenCap?: number;
  logRawParseFailures?: boolean;
  chat: (messages: ChatMessage[], options: Parameters<AiClient['chat']>[1], context: ScriptChatCallContext) => Promise<AiChatMetadata>;
};

type JsonChatOptions = { maxTokens: number; json: true; truncationRetryMaxTokens?: number };

function aiProviderName(provider: ProjectDetail['aiProvider']): AiProviderName {
  return provider === 'deepseek' ? 'DeepSeek' : 'Claude';
}

async function logScriptParseFailure(context: ScriptGenerationJobContext, error: unknown, raw: string): Promise<void> {
  if (error instanceof AppError && error.code === 'SCRIPT_PARSE_ERROR') {
    await context.appendLog(`AI response validation failed: ${error.message}\nRaw response (first 400 chars): ${raw.slice(0, 400)}`);
  }
}

function apiScriptChatBackend(provider: ProjectDetail['aiProvider'], aiClient: AiClient): ScriptChatBackend {
  return {
    label: `${provider}/${aiClient.model}`,
    model: aiClient.model,
    outputTokenCap: getAiModelDefinition(provider, aiClient.model)?.capabilities.maxOutputTokens ?? 32_000,
    chat: async (messages, opts, callContext) => {
      try {
        const response = await withAiRequestTimeout(() => opts !== undefined && aiClient.chatWithMetadata
          ? aiClient.chatWithMetadata(messages, opts)
          : aiClient.chat(messages, opts).then((text) => ({ text, truncated: false })), aiRequestTimeoutMs());
        return response;
      } catch (error) {
        const normalized = normalizeAiError(aiProviderName(provider), aiClient.model, error);
        await callContext.appendLog(`AI request failed: ${normalized.message}`);
        throw normalized;
      }
    },
  };
}

async function chatWithFailureLog(
  backend: ScriptChatBackend,
  messages: ChatMessage[],
  context: ScriptGenerationJobContext,
  opts?: JsonChatOptions,
  stepLabel = 'script',
): Promise<AiChatMetadata> {
  const chatOptions = opts ? { maxTokens: opts.maxTokens, json: opts.json } : undefined;
  return backend.chat(messages, chatOptions, { stepLabel, signal: context.signal, appendLog: context.appendLog });
}

function isScriptParseFailure(error: unknown): error is AppError {
  return error instanceof AppError && error.code === 'SCRIPT_PARSE_ERROR';
}

function scriptParseIssue(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^AI returned invalid script structure:\s*/, '') : String(error);
}

type ParseTruncationNotice = (message: string) => void;
type ParseLeadingTextNotice = (text: string) => void;

async function requestJsonWithRepair<T>(
  backend: ScriptChatBackend,
  messages: ChatMessage[],
  parse: (raw: string, onTruncate: ParseTruncationNotice, onLeadingText: ParseLeadingTextNotice) => T,
  context: ScriptGenerationJobContext,
  opts: JsonChatOptions,
  stepLabel: string,
  preambleCounter: { count: number },
): Promise<T> {
  let truncationRetryUsed = false;
  const requestText = async (requestMessages: ChatMessage[], requestStepLabel: string): Promise<string> => {
    let response = await chatWithFailureLog(backend, requestMessages, context, opts, requestStepLabel);
    if (response.truncated) {
      const retryMaxTokens = opts.truncationRetryMaxTokens;
      if (!truncationRetryUsed && retryMaxTokens !== undefined && retryMaxTokens > opts.maxTokens) {
        truncationRetryUsed = true;
        await context.appendLog(`AI response truncated at ${opts.maxTokens} output tokens; retrying once with ${retryMaxTokens}.`);
        response = await chatWithFailureLog(backend, requestMessages, context, { ...opts, maxTokens: retryMaxTokens }, `${requestStepLabel}-truncation-retry-1`);
      }
      if (response.truncated) {
        const message = retryMaxTokens && retryMaxTokens > opts.maxTokens
          ? `AI response remained truncated after one retry at ${retryMaxTokens} output tokens.`
          : `AI response was truncated at the ${opts.maxTokens}-token output budget; the selected model has no larger available output budget.`;
        await context.appendLog(message);
        throw new AppError(`AI response remained truncated: ${message}`, 503, 'AI_RESPONSE_TRUNCATED');
      }
    }
    return response.text;
  };
  const parseResponse = async (raw: string): Promise<T> => {
    const notices: string[] = [];
    const preambles: string[] = [];
    let result: T;
    try {
      result = parse(raw, (notice) => notices.push(notice), (text) => preambles.push(text));
    } finally {
      for (const notice of notices) await context.appendLog(notice);
      for (const preamble of preambles) {
        preambleCounter.count += 1;
        await context.appendLog(`${backend.label} response had leading text before JSON at ${stepLabel} (occurrence ${preambleCounter.count}; ${Buffer.byteLength(preamble)} preamble bytes).`);
      }
    }
    return result;
  };
  const raw = await requestText(messages, stepLabel);
  try {
    return await parseResponse(raw);
  } catch (error) {
    if (!isScriptParseFailure(error)) throw error;
    const issue = scriptParseIssue(error);
    await context.appendLog(`AI response invalid; retrying once: ${issue}`);
    const lastMessage = messages[messages.length - 1];
    const repairMessages: ChatMessage[] = [
      ...messages.slice(0, -1),
      {
        role: lastMessage?.role ?? 'user',
        content: `${lastMessage?.content ?? ''}\n\nFailed response:\n${raw}\n\nYour JSON was invalid: ${issue}. Return the corrected JSON only.`,
      },
    ];
    const repairedRaw = await requestText(repairMessages, `${stepLabel}-repair`);
    try {
      return await parseResponse(repairedRaw);
    } catch (repairError) {
      if (backend.logRawParseFailures !== false) await logScriptParseFailure(context, repairError, repairedRaw);
      throw repairError;
    }
  }
}

export async function saveGeneratedScript(
  projectId: string,
  chapters: GeneratedScriptChapter[],
  openLoops: OpenLoop[] = [],
  motif: HubrisMotif | null = null,
  coreQuestion = '',
  openingHook = '',
  snapshot: ChapterSnapshot | null = null,
): Promise<ProjectDetail> {
  const saved: ChapterDoc[] = chapters.map((chapter, index) => ({
    ...chapter,
    id: newId(),
    no: index + 1,
    status: 'pending',
    scenesCount: chapter.scenesCount ?? null,
    durationSec: chapter.durationSec ?? null,
    role: chapter.role ?? null,
    beat: chapter.beat ?? '',
    targetWords: chapter.targetWords ?? null,
    endsOnTension: chapter.endsOnTension ?? false,
    chapterSummary: chapter.chapterSummary ?? null,
    avoidRepeating: chapter.avoidRepeating ?? [],
    persistentFacts: chapter.persistentFacts ?? [],
    reviewStatus: chapter.reviewStatus ?? 'clean',
  }));
  return replaceProjectScript(projectId, saved, openLoops, motif, coreQuestion, openingHook, snapshot, 'script');
}

export async function restoreChapters(projectId: string, index: number, expectedVersion?: number): Promise<ChapterDoc[]> {
  const project = await getProject(projectId);
  const history = await getChapterHistory(projectId);
  const snapshot = history[index];
  if (!snapshot) throw new AppError('History snapshot not found.', 422, 'INVALID_HISTORY_INDEX');
  const updated = await restoreProjectChapters(projectId, snapshot.chapters, snapshotOf(project.chapters), expectedVersion);
  return updated.chapters;
}

export type GenerateScriptOptions = { resume?: boolean; backend?: ScriptChatBackend };

function getChapterOutputBudgets(targetWords: number, modelOutputCap: number): JsonChatOptions {
  const initial = Math.min(modelOutputCap, Math.max(3_000, Math.ceil(targetWords * 8 + 1_000)));
  const retry = Math.min(modelOutputCap, Math.ceil(initial * 1.5));
  return { json: true, maxTokens: initial, ...(retry > initial ? { truncationRetryMaxTokens: retry } : {}) };
}

function wordsInChapter(chapter: ChapterDoc): number {
  return countNarrationWords(chapter.paragraphs.join(' '));
}

function firstOrLastSentence(text: string, useLast: boolean): string {
  const sentences = text.trim().split(/(?<=[.!?。！？])\s+/u).filter(Boolean);
  return useLast ? sentences.at(-1) ?? text.trim() : sentences[0] ?? text.trim();
}

function fallbackChapterSummary(chapter: ChapterDoc): string {
  const firstParagraph = chapter.paragraphs[0] ?? '';
  const lastParagraph = chapter.paragraphs.at(-1) ?? firstParagraph;
  const first = firstOrLastSentence(firstParagraph, false);
  const last = firstOrLastSentence(lastParagraph, true);
  return first === last ? first : `${first} ${last}`;
}

function loopStateForChapter(loop: OpenLoop, chapterNo: number): 'upcoming' | 'plant' | 'pending' | 'resolve' | 'resolved' {
  if (chapterNo < loop.plantedInChapter) return 'upcoming';
  if (chapterNo === loop.plantedInChapter) return 'plant';
  if (chapterNo < loop.resolvedInChapter) return 'pending';
  if (chapterNo === loop.resolvedInChapter) return 'resolve';
  return 'resolved';
}

function isTransientChapterFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ('code' in error && typeof (error as { code?: unknown }).code === 'string' && (error as { code: string }).code.startsWith('CLAUDE_CLI_')) return false;
  if ('code' in error && (error as { code?: unknown }).code === 'AI_RESPONSE_TRUNCATED') return true;
  const status = 'status' in error ? (error as { status?: unknown }).status : undefined;
  return typeof status === 'number' && (status === 408 || status === 425 || status === 429 || status >= 500);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateScript(
  projectId: string,
  context: ScriptGenerationJobContext,
  options: GenerateScriptOptions = {},
): Promise<void> {
  const project = await getProject(projectId);
  await context.appendLog(options.backend ? `Loading project and ${options.backend.label} backend…` : 'Loading project and AI client…');
  const aiClient = options.backend ? null : getAiClient(project.aiProvider, project.aiModel);
  const backend = options.backend ?? apiScriptChatBackend(project.aiProvider, aiClient!);
  if (await context.isCancelled()) return;

  let openLoops: OpenLoop[];
  let motif = project.motif;
  let coreQuestion = project.coreQuestion;
  let openingHook = project.openingHook;
  let saved = project;
  const modelOutputCap = backend.outputTokenCap ?? getAiModelDefinition(project.aiProvider, backend.model)?.capabilities.maxOutputTokens ?? 32_000;
  const preambleCounter = { count: 0 };

  if (options.resume) {
    if (project.chapters.length === 0) throw new AppError('There is no saved outline to resume.', 422, 'SCRIPT_NOT_RESUMABLE');
    openLoops = project.openLoops;
    const incompleteIndex = project.chapters.findIndex((chapter) => chapter.paragraphs.length === 0);
    if (incompleteIndex < 0) {
      await context.appendLog('No empty chapters remain; script generation is already complete.');
      return;
    }
    await context.appendLog(`Resuming from chapter ${project.chapters[incompleteIndex]!.no} using the saved outline; no outline request will be made.`);
  } else {
    const chapterCount = project.chapterCount ?? recommendScriptChapterCount(project.targetDurationSec);
    const outlineProject = project.chapterCount === chapterCount ? project : { ...project, chapterCount };
    const shortReferenceWarning = getShortReferenceWarning(project);
    if (shortReferenceWarning) await context.appendLog(shortReferenceWarning);
    const outlinePrompt = buildOutlinePrompt(outlineProject);
    await context.appendLog('Sending outline request to AI…');
    const outlineMessages: ChatMessage[] = [
      { role: 'system', content: outlinePrompt.system },
      { role: 'user', content: outlinePrompt.user },
    ];
    const outlineBudgets = getOutlineOutputBudgets(chapterCount, project.referencesText.trim().length, modelOutputCap);
    let outlineWarnings: string[] = [];
    const outline = await requestJsonWithRepair(
      backend,
      outlineMessages,
      (raw, _onTruncate, onLeadingText) => {
        const parsed = validateScriptOutlineChapterCount(parseScriptOutline(raw, project.scriptPresetId, onLeadingText), chapterCount);
        outlineWarnings = validateScriptOutline(parsed, outlineProject);
        return parsed;
      },
      context,
      { json: true, maxTokens: outlineBudgets.initial, truncationRetryMaxTokens: outlineBudgets.retry },
      'outline',
      preambleCounter,
    );
    for (const warning of outlineWarnings) await context.appendLog(warning);
    if (await context.isCancelled()) return;
    coreQuestion = outline.coreQuestion;
    openingHook = outline.openingHook;
    openLoops = outline.openLoops;
    motif = 'motif' in outline ? outline.motif : null;
    saved = await saveGeneratedScript(projectId, outline.chapters.map((chapter) => ({
      ...chapter,
      paragraphs: [],
      sourceFacts: chapter.sourceFacts ?? [],
      holdBack: chapter.holdBack ?? [],
      scenesCount: null,
      durationSec: null,
    })), openLoops, motif, coreQuestion, openingHook);
    await context.reportProgress(0, { chapters: saved.chapters.length });
  }

  const totalBudgetWords = Math.round(project.targetDurationSec / 60 * NARRATION_WORDS_PER_MINUTE);
  const firstEmptyIndex = saved.chapters.findIndex((chapter) => chapter.paragraphs.length === 0);
  if (firstEmptyIndex < 0) return;
  if (options.resume) await context.reportProgress(Math.round((firstEmptyIndex / saved.chapters.length) * 100));
  let styleNote = '';

  for (let index = firstEmptyIndex; index < saved.chapters.length; index += 1) {
    const chapter = saved.chapters[index]!;
    if (chapter.paragraphs.length > 0) continue;
    if (await context.isCancelled()) return;
    try {
      const chapterTarget = chapter.targetWords ?? Math.max(1, Math.round(totalBudgetWords / saved.chapters.length));
      const alreadyWrittenWords = saved.chapters.reduce((sum, item, itemIndex) => itemIndex === index || item.paragraphs.length === 0 ? sum : sum + wordsInChapter(item), 0);
      const remainingBudgetWords = Math.max(0, totalBudgetWords - alreadyWrittenWords);
      const unfilledChapters = saved.chapters.filter((item) => item.paragraphs.length === 0);
      const plannedRemainingWords = unfilledChapters.reduce((sum, item) => sum + (item.targetWords ?? chapterTarget), 0);
      const driftPerChapter = (remainingBudgetWords - plannedRemainingWords) / Math.max(1, unfilledChapters.length);
      const generationTargetWords = Math.max(1, Math.round(chapterTarget + driftPerChapter));
      const priorChapters = saved.chapters.slice(0, index).filter((item) => item.paragraphs.length > 0);
      const storySoFar: Array<{ chapterNo: number; title: string; summary: string; fallback: boolean }> = [];
      for (const item of priorChapters) {
        const summary = item.chapterSummary?.trim() || fallbackChapterSummary(item);
        const fallback = !item.chapterSummary?.trim();
        if (fallback) await context.appendLog(`Chapter ${item.no} has narration but no summary; derived a continuity summary for chapter ${item.no} from its first and last narration sentences.`);
        storySoFar.push({ chapterNo: item.no, title: item.title, summary, fallback });
      }
      const previousChapter = saved.chapters[index - 1];
      const avoidRepeating = [...new Set(priorChapters.flatMap((item) => item.avoidRepeating))].slice(-30);
      const loopStates = openLoops.map((loop) => ({ question: loop.question, state: loopStateForChapter(loop, chapter.no) }));
      const previousOpeners = priorChapters.map((item) => (item.paragraphs[0] ?? '').trim().split(/\s+/u).slice(0, 6).join(' ')).filter(Boolean);
      const voiceAnchorParagraphs = chapter.no > 1 ? (saved.chapters[0]?.paragraphs ?? []).slice(0, 2) : [];
      const prompt = buildChapterExpansionPrompt({
        project,
        chapter,
        outlineChapters: saved.chapters,
        motif,
        coreQuestion,
        openingHook,
        storySoFar,
        persistentFacts: previousChapter?.persistentFacts ?? [],
        avoidRepeating,
        loopStates,
        nextChapter: saved.chapters[index + 1] ?? null,
        previousTailParagraphs: previousChapter?.paragraphs.slice(-2) ?? [],
        previousOpeners,
        voiceAnchorParagraphs,
        remainingBudgetWords,
        generationTargetWords,
        styleNote,
      });
      const baseMessages: ChatMessage[] = [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ];
      const budgets = getChapterOutputBudgets(generationTargetWords, modelOutputCap);
      await context.appendLog(`Expanding chapter ${chapter.no}/${saved.chapters.length}…`);
      if ((chapter.sourceFacts?.length ?? 0) < 2 && chapterTarget > 150) {
        await context.appendLog(`Chapter ${chapter.no} has thin source coverage (${chapter.sourceFacts?.length ?? 0} source facts for ${chapterTarget} target words).`);
      }
      let selected: { expansion: Awaited<ReturnType<typeof parseChapterExpansion>>; words: number } | null = null;
      const candidates: Array<{ expansion: Awaited<ReturnType<typeof parseChapterExpansion>>; words: number }> = [];
      for (let lengthAttempt = 0; lengthAttempt <= 2; lengthAttempt += 1) {
        let expansion: Awaited<ReturnType<typeof parseChapterExpansion>> | null = null;
        for (let providerRetry = 0; ; providerRetry += 1) {
          if (await context.isCancelled()) return;
          try {
            const requestMessages = lengthAttempt === 0 ? baseMessages : [
              ...baseMessages.slice(0, -1),
              {
                role: 'user' as const,
                content: `${prompt.user}\n\nLength correction: the last response had actual ${candidates.at(-1)!.words} words versus target ${chapterTarget} words (acceptable 85–115%: ${Math.ceil(chapterTarget * 0.85)}–${Math.floor(chapterTarget * 1.15)}). The adjusted generation target is ${generationTargetWords}; use it as guidance to help the remaining project budget. Retry by shortening or extending with distinct evidence from sourceFacts only. Never invent facts or add generic padding.`,
              },
            ];
            expansion = await requestJsonWithRepair(
              backend,
              requestMessages,
              parseChapterExpansion,
              context,
              budgets,
              `chapter-${chapter.no}${lengthAttempt > 0 ? `-length-retry-${lengthAttempt}` : ''}`,
              preambleCounter,
            );
            break;
          } catch (error) {
            if (!isTransientChapterFailure(error) || providerRetry >= 2) throw error;
            const backoffMs = 500 * (2 ** providerRetry);
            await context.appendLog(`Chapter ${chapter.no} transient failure; retrying after ${backoffMs} ms (attempt ${providerRetry + 2}/3): ${error instanceof Error ? error.message : String(error)}`);
            await delay(backoffMs);
          }
        }
        if (!expansion || await context.isCancelled()) return;
        const actualWords = countNarrationWords(expansion.paragraphs.join(' '));
        candidates.push({ expansion, words: actualWords });
        const minimumWords = chapterTarget * 0.85;
        const maximumWords = chapterTarget * 1.15;
        if (actualWords >= minimumWords && actualWords <= maximumWords) {
          selected = { expansion, words: actualWords };
          break;
        }
        if (lengthAttempt < 2) {
        await context.appendLog(`Chapter ${chapter.no} length ${actualWords} is outside 85–115% of ${chapterTarget}; retry ${lengthAttempt + 1}/2.`);
        }
      }
      selected ??= [...candidates].sort((left, right) => Math.abs(left.words - chapterTarget) - Math.abs(right.words - chapterTarget))[0]!;
      if (selected.words < chapterTarget * 0.85 || selected.words > chapterTarget * 1.15) {
        await context.appendLog(`Chapter ${chapter.no} accepted the closest result at ${selected.words} words versus ${chapterTarget}; it remains outside 85–115%.`);
      }
      if (await context.isCancelled()) return;
      const updated = await patchProjectChapter(projectId, chapter.id, {
        paragraphs: selected.expansion.paragraphs,
        status: 'pending',
        chapterSummary: selected.expansion.chapterSummary,
        avoidRepeating: selected.expansion.avoidRepeating,
        persistentFacts: selected.expansion.persistentFactsNext,
      });
      saved.chapters = updated.chapters;
      styleNote = selected.expansion.styleNote;
    } catch (error) {
      if (await context.isCancelled()) return;
      await patchProjectChapter(projectId, chapter.id, { status: 'needs-fix' });
      await context.appendLog(`Chapter ${chapter.no} failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      await context.appendLog(`Generation stopped at chapter ${chapter.no}; earlier chapters are saved. Resume with “Viết tiếp từ chương ${chapter.no}”.`);
      throw error;
    }
    await context.reportProgress(Math.round(((index + 1) / saved.chapters.length) * 100));
  }
  const finalTotalWords = saved.chapters.reduce((sum, chapter) => sum + wordsInChapter(chapter), 0);
  await context.appendLog(`Final narration total: ${finalTotalWords} words versus ${totalBudgetWords}-word budget.`);
  await context.appendLog(`Script saved — ${saved.chapters.length} chapters.`);
  if (backend.label.startsWith('claude-cli:')) {
    await context.appendLog(`Claude CLI preamble-before-JSON occurrences: ${preambleCounter.count}.`);
  }
}

export type RegenerationOptions = { instruction: string; level: 'light' | 'medium' | 'rewrite'; historyBatchId?: string };

export function buildRegenerationPromptForChapter(
  project: ProjectDetail,
  chapterId: string,
  opts: RegenerationOptions,
): { prompt: BuiltPrompt; chapter: ChapterDoc; nextChapter: ChapterDoc | undefined } {
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new NotFound('Không tìm thấy chương.');
  const chapterIndex = project.chapters.findIndex((item) => item.id === chapterId);
  const previousChapter = chapter.no === 1 ? undefined : project.chapters[chapterIndex - 1];
  const nextChapter = project.chapters.find((item) => item.no === chapter.no + 1);
  const priorChapters = project.chapters.slice(0, chapterIndex).filter((item) => item.paragraphs.length > 0);
  const storySoFar = priorChapters.map((item) => ({
    chapterNo: item.no,
    title: item.title,
    summary: item.chapterSummary?.trim() || fallbackChapterSummary(item),
    fallback: !item.chapterSummary?.trim(),
  }));
  const loopStates = project.openLoops.map((loop) => ({ question: loop.question, state: loopStateForChapter(loop, chapter.no) }));
  const previousOpeners = priorChapters.map((item) => (item.paragraphs[0] ?? '').trim().split(/\s+/u).slice(0, 6).join(' ')).filter(Boolean);
  const avoidRepeating = [...new Set(priorChapters.flatMap((item) => item.avoidRepeating))].slice(-30);
  const prompt = buildRegenerationPrompt(project, chapter, opts.instruction, opts.level, {
    coreQuestion: project.coreQuestion,
    openingHook: project.openingHook,
    openLoops: project.openLoops,
    previousChapterSummary: storySoFar.at(-1)?.summary ?? null,
    previousAvoidRepeating: previousChapter?.avoidRepeating ?? [],
    previousPersistentFacts: previousChapter?.persistentFacts ?? [],
    outlineChapters: project.chapters,
    motif: project.motif,
    storySoFar,
    persistentFacts: previousChapter?.persistentFacts ?? [],
    avoidRepeating,
    loopStates,
    nextChapter: nextChapter ?? null,
    previousTailParagraphs: previousChapter?.paragraphs.slice(-2) ?? [],
    previousOpeners,
    voiceAnchorParagraphs: chapter.no > 1 ? (project.chapters[0]?.paragraphs ?? []).slice(0, 2) : [],
  });
  return { prompt, chapter, nextChapter };
}

export function formatChatMessages(messages: readonly ChatMessage[]): string {
  const system = messages.find((message) => message.role === 'system')?.content ?? '';
  const user = messages.filter((message) => message.role === 'user').map((message) => message.content).join('\n\n');
  return `SYSTEM\n${system}\n\nUSER\n${user}`;
}

export function formatRegenerationPrompt(prompt: BuiltPrompt): string {
  return formatChatMessages([
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ]);
}

export async function applyRegeneratedChapter(
  projectId: string,
  chapter: ChapterDoc,
  nextChapter: ChapterDoc | undefined,
  raw: string | ReturnType<typeof parseRegeneratedParagraphs>,
  snapshot: ChapterSnapshot | null = null,
): Promise<ChapterDoc> {
  const regenerated = typeof raw === 'string' ? parseRegeneratedParagraphs(raw) : raw;
  const updated: ChapterDoc = {
    ...chapter,
    paragraphs: regenerated.paragraphs,
    status: 'pending',
    chapterSummary: regenerated.chapterSummary,
    avoidRepeating: regenerated.avoidRepeating,
    persistentFacts: regenerated.persistentFactsNext,
    reviewStatus: 'clean',
  };
  const result = await patchProjectChapter(projectId, chapter.id, {
    paragraphs: updated.paragraphs,
    status: updated.status,
    chapterSummary: updated.chapterSummary,
    avoidRepeating: updated.avoidRepeating,
    persistentFacts: updated.persistentFacts,
    reviewStatus: updated.reviewStatus,
  }, snapshot);
  if (nextChapter) await patchProjectChapter(projectId, nextChapter.id, { reviewStatus: 'upstream-changed' }, null);
  return result.chapters.find((item) => item.id === chapter.id) ?? updated;
}

export async function importRegeneratedChapter(
  projectId: string,
  chapterId: string,
  raw: string,
  historyBatchId?: string,
): Promise<{ chapter: ChapterDoc; quality: ReturnType<typeof summarizeManualScriptQuality> }> {
  const regenerated = parseRegeneratedParagraphs(raw);
  const project = await getProject(projectId);
  const snapshot = snapshotOf(project.chapters, historyBatchId);
  const { chapter, nextChapter } = buildRegenerationPromptForChapter(project, chapterId, { instruction: '', level: 'medium' });
  const updatedChapter = await applyRegeneratedChapter(project.id, chapter, nextChapter, regenerated, snapshot);
  const updatedProject = await getProject(projectId);
  const quality = summarizeManualScriptQuality({
    targetDurationSec: updatedProject.targetDurationSec,
    scriptPresetId: updatedProject.scriptPresetId,
    chapters: updatedProject.chapters,
  });
  return { chapter: updatedChapter, quality };
}

export async function regenerateChapter(
  projectId: string,
  chapterId: string,
  opts: RegenerationOptions,
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<ChapterDoc> {
  const project = await getProject(projectId);
  const { prompt, chapter, nextChapter } = buildRegenerationPromptForChapter(project, chapterId, opts);
  const snapshot = snapshotOf(project.chapters, opts.historyBatchId);
  await patchProjectChapter(projectId, chapterId, { status: 'generating' }, snapshot);

  try {
    const aiClient = getAiClient(project.aiProvider, project.aiModel);
    const streamResponse = async (messages: ChatMessage[]): Promise<string> => {
      let raw = '';
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      for await (const chunk of aiClient.stream(messages, { signal })) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        raw += chunk;
        onChunk(chunk);
      }
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return raw;
    };
    const messages: ChatMessage[] = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ];
    let regenerated = parseRegeneratedParagraphs(await streamResponse(messages));
    const targetWords = chapter.targetWords;
    if (targetWords != null && !opts.instruction.trim() && countNarrationWords(regenerated.paragraphs.join(' ')) < targetWords * 0.8) {
      const currentWords = countNarrationWords(regenerated.paragraphs.join(' '));
      const retryMessages: ChatMessage[] = [
        { role: 'system', content: prompt.system },
        {
          role: 'user',
          content: `${prompt.user}\n\nPrevious response was ${currentWords} words; target is ${targetWords}. Retry once and reach at least 80% of the target. Every added sentence must provide meaningful progression: new evidence, a concrete consequence, a causal explanation, or escalation. Do not paraphrase the same content, add generic padding, or repeat an already-stated fact just to raise the word count.`,
        },
      ];
      regenerated = parseRegeneratedParagraphs(await streamResponse(retryMessages));
    }
    return applyRegeneratedChapter(projectId, chapter, nextChapter, regenerated);
  } catch (error) {
    const aborted = signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
    await patchProjectChapter(projectId, chapterId, { status: 'needs-fix' });
    if (aborted && error instanceof DOMException) throw error;
    throw error;
  }
}

export async function finalizeScript(projectId: string): Promise<void> {
  const project: ProjectDetail = await getProject(projectId);
  if (project.chapters.length === 0) {
    throw new AppError('At least one chapter is required before finalizing.', 422, 'NO_CHAPTERS');
  }
  if (project.chapters.some((chapter) => chapter.status !== 'approved')) {
    throw new AppError('All chapters must be approved before finalizing.', 422, 'NOT_ALL_APPROVED');
  }
  for (const chapter of project.chapters) {
    if (!chapter.paragraphs.some((paragraph) => paragraph.trim())) {
      throw new AppError(`Chapter ${chapter.no} "${chapter.title}" has no narration paragraphs. Regenerate or edit this chapter before finalizing.`, 422, 'EMPTY_CHAPTER');
    }
  }
  const snapshot = snapshotOf(project.chapters);
  const scenes: SceneDoc[] = [];
  const finalizedChapters = project.chapters.map((chapter) => {
    const paragraphs = chapter.paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean);
    const chapterDurations = paragraphs.map(estimateNarrationDurationSec);
    scenes.push(...paragraphs.map((narration, index) => ({
      id: newId(),
      narration,
      visualPrompt: '',
      durationSec: chapterDurations[index]!,
      assetType: 'image' as const,
      assetFileId: null,
      audioFileId: null,
      voiceoverDurationSec: null,
      voiceoverInput: null,
      wordTimings: null,
      sfxPrompt: '',
      motionPrompt: '',
      sfxFileId: null,
      videoKeyframeFileId: null,
      videoTailFileId: null,
      videoDurationSec: null,
      depthMap: null,
      nameCandidates: null,
      popupPlan: null,
    })));
    return { ...chapter, scenesCount: paragraphs.length, durationSec: chapterDurations.reduce((sum, value) => sum + value, 0) };
  });
  await replaceProjectChapters(projectId, finalizedChapters, snapshot);
  await replaceProjectScenes(projectId, scenes, 'assets');
}
