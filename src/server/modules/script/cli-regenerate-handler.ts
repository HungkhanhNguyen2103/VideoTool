import { z } from 'zod';
import type { ChildProcess } from 'node:child_process';
import { CliRegenerateRequestSchema, type ScriptQualitySummary } from '../../../contracts/script';
import type { Config } from '../../config';
import { loadConfig } from '../../config';
import { AppError } from '../../shared/errors';
import { getProject } from '../project';
import { parseRegeneratedParagraphs, translateManualParseError } from './ai/parse-output';
import {
  getClaudeCliStatus,
  runClaudeCli,
  type ClaudeCliRunOptions,
  type ClaudeCliRunResult,
  type ClaudeCliSpawn,
} from '../../shared/claude-cli/cli-runner';
import { buildRegenerationPromptForChapter, formatRegenerationPrompt, importRegeneratedChapter, patchChapter } from './service';

export const CliRegenerationJobPayloadSchema = CliRegenerateRequestSchema.extend({
  projectId: z.string().min(1),
  historyBatchId: z.string().uuid().optional(),
}).strict();
export type CliRegenerationJobPayload = z.infer<typeof CliRegenerationJobPayloadSchema>;

export type ScriptCliJobContext = {
  reportProgress: (pct: number, result?: unknown) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
};

export type CliRegenerationJobResult = {
  updatedChapterIds: string[];
  runDirectories: string[];
  chapterDurationsMs: Array<{ chapterId: string; chapterNo: number; durationMs: number }>;
  cancelled: boolean;
  quality: ScriptQualitySummary | null;
};

type RunnerConfig = Pick<Config,
  'CLAUDE_CLI_PATH' | 'CLAUDE_CLI_TIMEOUT_MS' | 'CLAUDE_CLI_MAX_OUTPUT_BYTES' | 'FILES_DIR'
>;

export type CliRegenerationDependencies = {
  config?: RunnerConfig;
  env?: NodeJS.ProcessEnv;
  spawnProcess?: ClaudeCliSpawn;
  killProcessTree?: (child: ChildProcess) => void;
  runCli?: (options: ClaudeCliRunOptions) => Promise<ClaudeCliRunResult>;
  cancellationPollMs?: number;
};

function watchCancellation(context: ScriptCliJobContext, controller: AbortController, pollMs: number): () => void {
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void context.isCancelled()
      .then((cancelled) => { if (cancelled && !controller.signal.aborted) controller.abort(); })
      .catch(() => undefined)
      .finally(() => { checking = false; });
  }, pollMs);
  return () => clearInterval(timer);
}

function hasRateLimitOrAuthMessage(text: string): boolean {
  return /rate[\s_-]?limit|too many requests|\b429\b|not logged in|not authenticated|authentication (?:failed|required)|unauthori[sz]ed|invalid (?:anthropic )?api.?key|credit balance|overloaded_error/iu.test(text);
}

function malformedJson(error: unknown): boolean {
  return error instanceof AppError && error.code === 'SCRIPT_PARSE_ERROR' && error.message.includes('root: invalid JSON');
}

function translatedParseError(error: unknown): Error {
  try {
    translateManualParseError(error, 'chapter');
  } catch (translated) {
    return translated instanceof Error ? translated : new Error(String(translated));
  }
  return new Error('JSON của chương không hợp lệ.');
}

function processFailure(result: ClaudeCliRunResult, timeoutMs: number, maxOutputBytes: number): string | null {
  if (result.cancelled) return null;
  if (result.timedOut) return `Claude CLI đã hết thời gian chờ sau ${Math.ceil(timeoutMs / 1000)} giây.`;
  if (result.outputTooLarge) return `Kết quả Claude CLI vượt quá giới hạn ${maxOutputBytes} byte.`;
  if (result.spawnError) return 'Không thể chạy Claude Code CLI. Hãy kiểm tra CLAUDE_CLI_PATH.';
  if (result.exitCode !== 0) {
    return hasRateLimitOrAuthMessage(`${result.stderr}\n${result.output}`)
      ? 'Claude CLI yêu cầu đăng nhập hoặc đang bị giới hạn tốc độ. Hãy kiểm tra phiên đăng nhập hoặc thử lại sau.'
      : `Claude CLI kết thúc với mã ${result.exitCode ?? 'không xác định'}.`;
  }
  if (!result.output.trim()) return 'Claude CLI không trả về nội dung.';
  return null;
}

function resultSnapshot(result: CliRegenerationJobResult): CliRegenerationJobResult {
  return {
    updatedChapterIds: [...result.updatedChapterIds],
    runDirectories: [...result.runDirectories],
    chapterDurationsMs: result.chapterDurationsMs.map((item) => ({ ...item })),
    cancelled: result.cancelled,
    quality: result.quality,
  };
}

export async function handleCliRegeneration(
  job: { payload: unknown },
  context: ScriptCliJobContext,
  dependencies: CliRegenerationDependencies = {},
): Promise<CliRegenerationJobResult> {
  const payload = CliRegenerationJobPayloadSchema.parse(job.payload);
  const result: CliRegenerationJobResult = {
    updatedChapterIds: [],
    runDirectories: [],
    chapterDurationsMs: [],
    cancelled: false,
    quality: null,
  };
  if (await context.isCancelled()) return { ...result, cancelled: true };

  const config = dependencies.config ?? loadConfig();
  const env = dependencies.env ?? process.env;
  const status = await getClaudeCliStatus({
    executablePath: config.CLAUDE_CLI_PATH,
    env,
    ...(dependencies.spawnProcess ? { spawnProcess: dependencies.spawnProcess } : {}),
  });
  if (!status.available) throw new AppError(status.reason ?? 'Claude Code CLI hiện chưa sẵn sàng.', 503, 'CLAUDE_CLI_UNAVAILABLE');

  const project = await getProject(payload.projectId);
  const selectedIds = new Set(payload.chapterIds);
  const missingIds = payload.chapterIds.filter((chapterId) => !project.chapters.some((chapter) => chapter.id === chapterId));
  if (missingIds.length > 0) throw new AppError('Có chương được chọn không còn trong dự án.', 422, 'CHAPTER_NOT_FOUND');
  const ordered = project.chapters.filter((chapter) => selectedIds.has(chapter.id)).sort((left, right) => left.no - right.no);
  const runCli = dependencies.runCli ?? runClaudeCli;
  const total = ordered.length;

  for (let index = 0; index < ordered.length; index += 1) {
    if (await context.isCancelled()) return { ...resultSnapshot(result), cancelled: true };
    const chapterTarget = ordered[index]!;
    const currentProject = await getProject(payload.projectId);
    const { chapter } = buildRegenerationPromptForChapter(currentProject, chapterTarget.id, {
      instruction: payload.instruction,
      level: payload.level,
      ...(payload.historyBatchId ? { historyBatchId: payload.historyBatchId } : {}),
    });
    await context.appendLog(`Đang tái tạo lần ${index + 1}/${total} (chương ${chapter.no}) bằng Claude CLI.`);

    let accumulatedDurationMs = 0;
    let validOutput: string | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { prompt } = buildRegenerationPromptForChapter(currentProject, chapter.id, {
        instruction: payload.instruction,
        level: payload.level,
        ...(payload.historyBatchId ? { historyBatchId: payload.historyBatchId } : {}),
      });
      const controller = new AbortController();
      const stopWatching = watchCancellation(context, controller, dependencies.cancellationPollMs ?? 250);
      let cliResult: ClaudeCliRunResult;
      try {
        cliResult = await runCli({
          ...config,
          projectId: payload.projectId,
          chapterId: chapter.id,
          promptText: formatRegenerationPrompt(prompt),
          ...(payload.model ? { model: payload.model } : {}),
          cliVersion: status.version,
          signal: controller.signal,
          env,
          ...(dependencies.spawnProcess ? { spawnProcess: dependencies.spawnProcess } : {}),
          ...(dependencies.killProcessTree ? { killProcessTree: dependencies.killProcessTree } : {}),
        });
      } finally {
        stopWatching();
      }
      accumulatedDurationMs += cliResult.durationMs;
      result.runDirectories.push(cliResult.displayPath);
      await context.appendLog(`Tệp Claude CLI: ${cliResult.displayPath}`);
      if (cliResult.cancelled || controller.signal.aborted || await context.isCancelled()) {
        return { ...resultSnapshot(result), cancelled: true };
      }

      const failure = processFailure(cliResult, config.CLAUDE_CLI_TIMEOUT_MS, config.CLAUDE_CLI_MAX_OUTPUT_BYTES);
      if (failure) {
        result.chapterDurationsMs.push({ chapterId: chapter.id, chapterNo: chapter.no, durationMs: accumulatedDurationMs });
        await context.reportProgress(Math.round((index / total) * 100), resultSnapshot(result));
        await patchChapter(payload.projectId, chapter.id, { status: 'needs-fix' });
        await context.appendLog(`Chương ${chapter.no} thất bại: ${failure}`);
        throw new AppError(`Chương ${chapter.no} thất bại: ${failure}`, 502, 'CLAUDE_CLI_REGENERATION_FAILED');
      }

      try {
        parseRegeneratedParagraphs(cliResult.output);
        validOutput = cliResult.output;
        break;
      } catch (error) {
        if (hasRateLimitOrAuthMessage(`${cliResult.stderr}\n${cliResult.output}`)) {
          const message = 'Claude CLI yêu cầu đăng nhập hoặc đang bị giới hạn tốc độ. Hãy kiểm tra phiên đăng nhập hoặc thử lại sau.';
          result.chapterDurationsMs.push({ chapterId: chapter.id, chapterNo: chapter.no, durationMs: accumulatedDurationMs });
          await context.reportProgress(Math.round((index / total) * 100), resultSnapshot(result));
          await patchChapter(payload.projectId, chapter.id, { status: 'needs-fix' });
          await context.appendLog(`Chương ${chapter.no} thất bại: ${message}`);
          throw new AppError(`Chương ${chapter.no} thất bại: ${message}`, 502, 'CLAUDE_CLI_REGENERATION_FAILED');
        }
        if (attempt === 0 && malformedJson(error)) {
          await context.appendLog(`JSON của chương ${chapter.no} không hợp lệ; thử lại Claude CLI một lần.`);
          continue;
        }
        const parseError = translatedParseError(error);
        result.chapterDurationsMs.push({ chapterId: chapter.id, chapterNo: chapter.no, durationMs: accumulatedDurationMs });
        await context.reportProgress(Math.round((index / total) * 100), resultSnapshot(result));
        await patchChapter(payload.projectId, chapter.id, { status: 'needs-fix' });
        await context.appendLog(`Chương ${chapter.no} thất bại: ${parseError.message}`);
        throw new AppError(`Chương ${chapter.no} thất bại: ${parseError.message}`, 422, 'SCRIPT_PARSE_ERROR');
      }
    }

    if (validOutput === null) throw new AppError(`Chương ${chapter.no} thất bại: Claude CLI không trả về JSON hợp lệ.`, 422, 'SCRIPT_PARSE_ERROR');
    if (await context.isCancelled()) return { ...resultSnapshot(result), cancelled: true };
    const imported = await importRegeneratedChapter(payload.projectId, chapter.id, validOutput, payload.historyBatchId);
    result.updatedChapterIds.push(chapter.id);
    result.chapterDurationsMs.push({ chapterId: chapter.id, chapterNo: chapter.no, durationMs: accumulatedDurationMs });
    result.quality = imported.quality;
    await context.appendLog(`Đã tái tạo chương ${chapter.no} trong ${(accumulatedDurationMs / 1000).toFixed(1)} giây.`);
    await context.reportProgress(Math.round(((index + 1) / total) * 100), resultSnapshot(result));
  }

  return result;
}
