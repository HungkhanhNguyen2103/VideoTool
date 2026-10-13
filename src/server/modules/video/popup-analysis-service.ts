import { z } from 'zod';
import { getDefaultAiModelId, isAiModelForProvider } from '../../../contracts/ai-models';
import { PopupBackendSchema, POPUP_DENSITIES, type PopupBackend, type PopupDensity } from '../../../contracts/popup-analysis';
import { hashNarration } from '../../../contracts/name-keywords';
import type { ProjectDetail, Scene } from '../../../contracts/project';
import { activeScenes, countInactiveScenes } from '../../../contracts/scene-active';
import type { Config } from '../../config';
import { loadConfig } from '../../config';
import { AppError } from '../../shared/errors';
import { getAiClient, type AiProvider, type ChatMessage } from '../../shared/ai';
import { getClaudeCliStatus, runClaudeCli, type ClaudeCliRunOptions, type ClaudeCliRunResult, type ClaudeCliStatus } from '../../shared/claude-cli/cli-runner';
import { logger } from '../../shared/logger';
import { getProject, setProjectScenePopupPlans, type ProjectScenePopupPlanUpdate } from '../project';
import { assemblePopupPlans, type PopupAssemblyScene, type PopupPlanAssemblyResult } from './popup-plan';
import { buildPopupAnalysisPrompt, POPUP_AI_OUTPUT_JSON_SCHEMA, type PopupPromptScene } from './ai/build-prompt';
import { parsePopupAiOutputForScenes, PopupAiOutputError } from './ai/parse-output';
import type { PopupAiOutput } from './ai/output-schema';

export const POPUP_ANALYSIS_JOB_TYPE = 'analyze-popups';
export const POPUP_ANALYSIS_MAX_PROMPT_BYTES = 48_000;
const POPUP_ANALYSIS_MAX_TOKENS = 32_000;
const POPUP_CONTEXT_OVERLAP_SCENES = 1;

export const PopupAnalysisRequestSchema = z.object({
  backend: PopupBackendSchema,
  density: z.enum(POPUP_DENSITIES),
  cliModel: z.string().trim().min(1).optional(),
}).strict();
export type PopupAnalysisRequest = z.infer<typeof PopupAnalysisRequestSchema> & {
  backend: PopupBackend;
  density: PopupDensity;
};

export type PopupAnalysisContext = {
  reportProgress: (pct: number, result?: unknown) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
};

type PopupCliConfig = Pick<Config, 'CLAUDE_CLI_PATH' | 'CLAUDE_CLI_TIMEOUT_MS' | 'CLAUDE_CLI_MAX_OUTPUT_BYTES' | 'FILES_DIR'>;

export type PopupAnalysisDependencies = {
  getProject?: typeof getProject;
  setProjectScenePopupPlans?: typeof setProjectScenePopupPlans;
  getAiClient?: typeof getAiClient;
  getClaudeCliStatus?: (options: { executablePath: string; env?: NodeJS.ProcessEnv }) => Promise<ClaudeCliStatus>;
  runCli?: (options: ClaudeCliRunOptions) => Promise<ClaudeCliRunResult>;
  config?: PopupCliConfig;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  maxPromptBytes?: number;
};

export type PopupAnalysisScene = PopupAssemblyScene & { sceneNo: number };
type PopupPromptAnalysisScene = Pick<PopupAnalysisScene, 'sceneNo' | 'sceneStartSec' | 'narration'>;

export type PopupAnalysisChunk = {
  primarySceneNumbers: number[];
  scenes: PopupPromptScene[];
  prompt: string;
};

export type PopupAnalysisResult = {
  backend: PopupBackend;
  provider: AiProvider;
  model: string;
  density: PopupDensity;
  scenesExpected: number;
  scenesApplied: number;
  summary: PopupPlanAssemblyResult['summary'];
  runDirectories: string[];
  cancelled: boolean;
  skippedInactive: number;
};

function eligibleScenes(project: ProjectDetail): PopupAnalysisScene[] {
  let sceneStartSec = 0;
  const eligible: PopupAnalysisScene[] = [];
  const timeline = activeScenes(project.scenes.map((scene, index) => ({ scene, index, active: scene.active })));
  for (const { scene, index } of timeline) {
    if (scene.narration.trim() && scene.audioFileId && scene.wordTimings?.audioFileId === scene.audioFileId && scene.wordTimings.words.length > 0) {
      eligible.push({
        sceneNo: index + 1,
        id: scene.id,
        scene: index + 1,
        sceneStartSec,
        narration: scene.narration,
        audioFileId: scene.audioFileId,
        words: scene.wordTimings.words,
      });
    }
    sceneStartSec += scene.durationSec;
  }
  return eligible;
}

function scenePrompt(scene: PopupPromptAnalysisScene): PopupPromptScene {
  return { scene: scene.sceneNo, startSec: scene.sceneStartSec, narration: scene.narration };
}

function chunkPrompt(project: ProjectDetail, scenes: readonly PopupPromptAnalysisScene[], primarySceneNumbers: readonly number[], density: PopupDensity): string {
  return buildPopupAnalysisPrompt({
    title: project.title,
    brief: project.brief,
    referencesText: project.referencesText,
    language: project.language,
    density,
    primarySceneNumbers,
    scenes: scenes.map(scenePrompt),
  });
}

/** Split by measured UTF-8 prompt size while retaining one neighboring scene for context. */
export function buildPopupAnalysisChunks(
  project: ProjectDetail,
  scenes: readonly PopupPromptAnalysisScene[],
  density: PopupDensity,
  maxPromptBytes = POPUP_ANALYSIS_MAX_PROMPT_BYTES,
): PopupAnalysisChunk[] {
  const chunks: PopupAnalysisChunk[] = [];
  let cursor = 0;
  while (cursor < scenes.length) {
    let end = cursor + 1;
    while (end < scenes.length) {
      const primary = scenes.slice(cursor, end + 1).map((scene) => scene.sceneNo);
      const contextStart = Math.max(0, cursor - POPUP_CONTEXT_OVERLAP_SCENES);
      const contextEnd = Math.min(scenes.length, end + 1 + POPUP_CONTEXT_OVERLAP_SCENES);
      const prompt = chunkPrompt(project, scenes.slice(contextStart, contextEnd), primary, density);
      if (Buffer.byteLength(prompt, 'utf8') > maxPromptBytes && end > cursor) break;
      end += 1;
    }
    const primarySceneNumbers = scenes.slice(cursor, end).map((scene) => scene.sceneNo);
    const contextStart = Math.max(0, cursor - POPUP_CONTEXT_OVERLAP_SCENES);
    const contextEnd = Math.min(scenes.length, end + POPUP_CONTEXT_OVERLAP_SCENES);
    const chunkScenes = scenes.slice(contextStart, contextEnd);
    chunks.push({
      primarySceneNumbers,
      scenes: chunkScenes.map(scenePrompt),
      prompt: chunkPrompt(project, chunkScenes, primarySceneNumbers, density),
    });
    cursor = end;
  }
  return chunks;
}

function invalidResponse(error: unknown): AppError {
  const detail = error instanceof Error ? error.message : String(error);
  return new AppError(`AI trả về popup không hợp lệ; dữ liệu hiện tại được giữ nguyên. ${detail}`, 422, 'POPUP_ANALYSIS_INVALID_RESPONSE');
}

function watchCancellation(context: PopupAnalysisContext, controller: AbortController): () => void {
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void context.isCancelled()
      .then((cancelled) => { if (cancelled && !controller.signal.aborted) controller.abort(); })
      .catch(() => undefined)
      .finally(() => { checking = false; });
  }, 250);
  return () => clearInterval(timer);
}

function cliFailure(result: ClaudeCliRunResult, config: PopupCliConfig): AppError | null {
  if (result.timedOut) return new AppError('Claude CLI đã hết thời gian khi phân tích popup.', 503, 'CLAUDE_CLI_TIMEOUT');
  if (result.outputTooLarge) return new AppError(`Kết quả Claude CLI vượt quá giới hạn ${config.CLAUDE_CLI_MAX_OUTPUT_BYTES} byte.`, 413, 'CLAUDE_CLI_OUTPUT_TOO_LARGE');
  if (result.spawnError) return new AppError('Claude Code CLI chưa khả dụng trên máy chủ này.', 503, 'CLAUDE_CLI_UNAVAILABLE');
  if (result.exitCode !== 0) return new AppError(`Claude CLI thất bại khi phân tích popup (mã thoát ${result.exitCode ?? 'không xác định'}).`, 503, 'CLAUDE_CLI_FAILED');
  if (!result.output.trim()) return new AppError('Claude CLI không trả về nội dung popup.', 503, 'CLAUDE_CLI_FAILED');
  return null;
}

function apiMessages(prompt: string, correction?: string): ChatMessage[] {
  return [
    { role: 'system', content: `Return only valid JSON matching this exact popup analysis schema: ${JSON.stringify(POPUP_AI_OUTPUT_JSON_SCHEMA)}. Do not include markdown or prose outside JSON.` },
    { role: 'user', content: correction ? `${prompt}\n\n${correction}` : prompt },
  ];
}

async function parseChunkWithRetry(
  request: (correction?: string) => Promise<string>,
  primarySceneNumbers: readonly number[],
  appendLog: (message: string) => Promise<void>,
): Promise<PopupAiOutput> {
  let correction: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await request(correction);
    try {
      return parsePopupAiOutputForScenes(raw, primarySceneNumbers);
    } catch (error) {
      if (error instanceof PopupAiOutputError && attempt === 0) {
        correction = `Lần trước JSON sai vì: ${error.message}. Sửa lại đúng schema.`;
        await appendLog(`Popup chunk ${primarySceneNumbers[0]}-${primarySceneNumbers.at(-1)} sai JSON/schema; thử lại một lần.`);
        continue;
      }
      throw invalidResponse(error);
    }
  }
  throw invalidResponse('empty popup response');
}

async function getCliConfig(dependencies: PopupAnalysisDependencies): Promise<PopupCliConfig> {
  return dependencies.config ?? loadConfig();
}

async function assertCliAvailable(dependencies: PopupAnalysisDependencies, config: PopupCliConfig): Promise<ClaudeCliStatus> {
  const status = await (dependencies.getClaudeCliStatus ?? getClaudeCliStatus)({ executablePath: config.CLAUDE_CLI_PATH, env: dependencies.env ?? process.env });
  if (!status.available) throw new AppError(status.reason ?? 'Claude Code CLI chưa khả dụng trên máy chủ này.', 503, 'CLAUDE_CLI_UNAVAILABLE');
  return status;
}

function mergeOutputs(scenes: readonly PopupAnalysisScene[], outputs: readonly PopupAiOutput[]): PopupAiOutput {
  const byScene = new Map(outputs.flatMap((output) => output.scenes).map((verdict) => [verdict.scene, verdict]));
  const merged = scenes.map((scene) => byScene.get(scene.sceneNo));
  if (merged.some((verdict) => verdict === undefined)) throw invalidResponse('Popup AI không trả verdict cho mọi scene được yêu cầu.');
  return { scenes: merged as PopupAiOutput['scenes'] };
}

function currentPlans(project: ProjectDetail): Map<string, NonNullable<Scene['popupPlan']> | null> {
  return new Map(project.scenes.map((scene) => [scene.id, scene.popupPlan ?? null]));
}

async function runCliChunk(
  project: ProjectDetail,
  chunk: PopupAnalysisChunk,
  chunkIndex: number,
  context: PopupAnalysisContext,
  dependencies: PopupAnalysisDependencies,
  config: PopupCliConfig,
  status: ClaudeCliStatus,
  model: string,
): Promise<{ output: PopupAiOutput; runDirectory: string } | { cancelled: true }> {
  let correction: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const stopWatching = watchCancellation(context, controller);
    let result: ClaudeCliRunResult;
    const promptText = correction ? `${chunk.prompt}\n\n${correction}` : chunk.prompt;
    try {
      result = await (dependencies.runCli ?? runClaudeCli)({
        ...config,
        projectId: project.id,
        chapterId: 'popup-analysis',
        stepLabel: `chunk-${chunkIndex + 1}${attempt ? '-retry' : ''}`,
        promptText,
        model,
        cliVersion: status.version,
        signal: controller.signal,
        env: dependencies.env ?? process.env,
      });
    } finally {
      stopWatching();
    }
    await context.appendLog(`Claude CLI popup chunk ${chunkIndex + 1}: prompt ${Buffer.byteLength(promptText, 'utf8')} bytes; ${result.durationMs} ms; audit folder ${result.displayPath}.`);
    if (result.cancelled || controller.signal.aborted || await context.isCancelled()) return { cancelled: true };
    const failure = cliFailure(result, config);
    if (failure) throw failure;
    try {
      return { output: parsePopupAiOutputForScenes(result.output, chunk.primarySceneNumbers), runDirectory: result.displayPath };
    } catch (error) {
      if (error instanceof PopupAiOutputError && attempt === 0) {
        correction = `Lần trước JSON sai vì: ${error.message}. Sửa lại đúng schema.`;
        await context.appendLog(`Popup chunk ${chunk.primarySceneNumbers[0]}-${chunk.primarySceneNumbers.at(-1)} sai JSON/schema; thử lại một lần.`);
        continue;
      }
      throw invalidResponse(error);
    }
  }
  throw invalidResponse('empty popup response');
}

export async function analyzeProjectPopups(
  projectId: string,
  request: PopupAnalysisRequest,
  context: PopupAnalysisContext,
  dependencies: PopupAnalysisDependencies = {},
): Promise<PopupAnalysisResult> {
  const loadProject = dependencies.getProject ?? getProject;
  const project = await loadProject(projectId);
  const scenes = eligibleScenes(project);
  const resultBase = {
    backend: request.backend,
    provider: request.backend === 'cli' ? 'claude' as const : project.aiProvider,
    model: request.backend === 'cli' ? request.cliModel ?? getDefaultAiModelId('claude') : project.aiModel ?? getDefaultAiModelId(project.aiProvider),
    density: request.density,
    scenesExpected: scenes.length,
    scenesApplied: 0,
    summary: { scenesNeeded: 0, scenesNotNeeded: 0, keptPopups: 0, droppedPopups: 0, rejectedByValidation: 0 },
    runDirectories: [] as string[],
    cancelled: false,
    skippedInactive: countInactiveScenes(project.scenes),
  } satisfies PopupAnalysisResult;
  const cancelledResult = async (patch: Partial<PopupAnalysisResult> = {}): Promise<PopupAnalysisResult> => {
    const result: PopupAnalysisResult = { ...resultBase, ...patch, cancelled: true };
    await context.appendLog(`Popup analysis cancelled; skippedInactive: ${result.skippedInactive}.`);
    return result;
  };
  if (await context.isCancelled()) return cancelledResult();
  if (scenes.length === 0) {
    if (resultBase.skippedInactive === project.scenes.length && project.scenes.length > 0) {
      await context.appendLog(`Không có scene nào đang bật để phân tích popup; skippedInactive: ${resultBase.skippedInactive}.`);
    } else {
      await context.appendLog(`Không có scene nào đủ điều kiện phân tích popup; skippedInactive: ${resultBase.skippedInactive}.`);
    }
    await context.reportProgress(100, resultBase);
    return resultBase;
  }

  let model = resultBase.model;
  let status: ClaudeCliStatus | undefined;
  let config: PopupCliConfig | undefined;
  if (request.backend === 'api') {
    const client = (dependencies.getAiClient ?? getAiClient)(project.aiProvider, project.aiModel);
    model = client.model;
  } else {
    if (request.cliModel && !isAiModelForProvider('claude', request.cliModel)) throw new AppError(`Model ${request.cliModel} không thuộc Claude.`, 422, 'AI_MODEL_UNAVAILABLE');
    config = await getCliConfig(dependencies);
    status = await assertCliAvailable(dependencies, config);
  }

  const chunks = buildPopupAnalysisChunks(project, scenes, request.density, dependencies.maxPromptBytes);
  const outputs: PopupAiOutput[] = [];
  const getClient = request.backend === 'api' ? (dependencies.getAiClient ?? getAiClient)(project.aiProvider, project.aiModel) : null;
  for (const [index, chunk] of chunks.entries()) {
    if (await context.isCancelled()) return cancelledResult({ model });
    let parsed: PopupAiOutput | null = null;
    if (request.backend === 'api') {
      parsed = await parseChunkWithRetry(
        (correction) => getClient!.chat(apiMessages(chunk.prompt, correction), { json: true, maxTokens: POPUP_ANALYSIS_MAX_TOKENS, temperature: 0 }),
        chunk.primarySceneNumbers,
        context.appendLog,
      );
    } else {
      const cliResult = await runCliChunk(project, chunk, index, context, dependencies, config!, status!, model);
      if ('cancelled' in cliResult) return cancelledResult({ model, runDirectories: [...resultBase.runDirectories] });
      parsed = cliResult.output;
      resultBase.runDirectories.push(cliResult.runDirectory);
    }
    outputs.push(parsed);
    await context.reportProgress(Math.round(((index + 1) / chunks.length) * 85), { chunksCompleted: index + 1, chunksExpected: chunks.length });
  }

  if (await context.isCancelled()) return cancelledResult({ model, runDirectories: [...resultBase.runDirectories] });
  const assembled = assemblePopupPlans({
    scenes,
    aiOutput: mergeOutputs(scenes, outputs),
    previousPlans: currentPlans(project),
    brief: project.brief,
    referencesText: project.referencesText,
    density: request.density,
    backend: request.backend,
    provider: resultBase.provider,
    model,
    now: dependencies.now?.() ?? new Date(),
  });
  if (await context.isCancelled()) return cancelledResult({ model, runDirectories: [...resultBase.runDirectories] });
  const updates: ProjectScenePopupPlanUpdate[] = assembled.plans.map(({ sceneId, plan }) => {
    const scene = scenes.find((candidate) => candidate.id === sceneId)!;
    return { sceneId, expectedNarration: scene.narration, expectedAudioFileId: scene.audioFileId, popupPlan: plan };
  });
  const applied = await (dependencies.setProjectScenePopupPlans ?? setProjectScenePopupPlans)(projectId, updates);
  if (applied < updates.length) logger.warn(`Popup analysis wrote ${applied}/${updates.length} scenes; some scene snapshots changed while AI was running.`);
  const result: PopupAnalysisResult = { ...resultBase, model, scenesApplied: applied, summary: assembled.summary, runDirectories: [...resultBase.runDirectories], cancelled: false };
  await context.appendLog(`Popup analysis ${request.backend}: applied ${applied}/${updates.length} scene plans; skippedInactive: ${result.skippedInactive}.`);
  await context.reportProgress(100, result);
  return result;
}

function freshPlan(scene: Scene): boolean {
  return Boolean(scene.popupPlan && scene.audioFileId && scene.popupPlan.audioFileId === scene.audioFileId && scene.popupPlan.narrationHash === hashNarration(scene.narration));
}

export type PopupAnalysisRunner = (projectId: string, request: PopupAnalysisRequest, context: PopupAnalysisContext) => Promise<PopupAnalysisResult>;

export async function autoAnalyzeProjectPopupsIfStale(
  projectId: string,
  appendLog?: (message: string) => Promise<void>,
  runner: PopupAnalysisRunner = (id, request, context) => analyzeProjectPopups(id, request, context),
): Promise<boolean> {
  const project = await getProject(projectId);
  const eligible = eligibleScenes(project);
  if (eligible.length === 0 || eligible.some(({ id }) => freshPlan(project.scenes.find((scene) => scene.id === id)!))) return false;
  try {
    const result = await runner(projectId, { backend: 'api', density: project.popupDensity }, {
      reportProgress: async () => undefined,
      isCancelled: async () => false,
      appendLog: appendLog ?? (async () => undefined),
    });
    try { await appendLog?.(`Popup auto-analysis: ${JSON.stringify(result.summary)}; applied ${result.scenesApplied}/${result.scenesExpected}.`); }
    catch (error) { logger.warn('Popup auto-analysis log write failed.', error); }
    return !result.cancelled;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Popup auto-analysis failed for project ${projectId}; alignment remains complete: ${message}`);
    try { await appendLog?.(`Popup auto-analysis skipped: ${message}`); }
    catch (logError) { logger.warn('Popup auto-analysis failure log write failed.', logError); }
    return false;
  }
}
