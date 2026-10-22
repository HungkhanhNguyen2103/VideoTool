import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../../config';
import { getAiModelDefinition } from '../../../contracts/ai-models';
import { AppError } from '../../shared/errors';
import { CLAUDE_CLI_DEFAULT_EFFORT, CLAUDE_CLI_DEFAULT_MODEL, getClaudeCliStatus, runClaudeCli, type ClaudeCliEffort, type ClaudeCliRunOptions, type ClaudeCliRunResult, type ClaudeCliStatus } from '../../shared/claude-cli/cli-runner';
import { formatChatMessages, type ScriptChatBackend, type ScriptGenerationJobContext } from './service';

type ScriptCliJobContext = Pick<ScriptGenerationJobContext, 'isCancelled' | 'appendLog'>;

export type ClaudeCliScriptBackendOptions = {
  projectId: string;
  model?: string;
  config: Pick<Config, 'CLAUDE_CLI_PATH' | 'CLAUDE_CLI_TIMEOUT_MS' | 'CLAUDE_CLI_MAX_OUTPUT_BYTES' | 'FILES_DIR'>;
  context: ScriptCliJobContext;
  env?: NodeJS.ProcessEnv;
  getStatus?: (options: { executablePath: string; env?: NodeJS.ProcessEnv }) => Promise<ClaudeCliStatus>;
  runCli?: (options: ClaudeCliRunOptions) => Promise<ClaudeCliRunResult>;
  spawnProcess?: ClaudeCliRunOptions['spawnProcess'];
  killProcessTree?: ClaudeCliRunOptions['killProcessTree'];
  pollIntervalMs?: number;
};

function cliFailure(result: ClaudeCliRunResult, stepLabel: string): AppError | null {
  if (result.timedOut) return new AppError(`Claude CLI đã hết thời gian khi chạy bước ${stepLabel}.`, 503, 'CLAUDE_CLI_TIMEOUT');
  if (result.outputTooLarge) return new AppError(`Claude CLI trả về quá nhiều dữ liệu ở bước ${stepLabel}.`, 413, 'CLAUDE_CLI_OUTPUT_TOO_LARGE');
  if (result.spawnError) return new AppError(`Không thể khởi chạy Claude Code CLI ở bước ${stepLabel}. Kiểm tra cài đặt CLI trên máy chủ.`, 503, 'CLAUDE_CLI_UNAVAILABLE');
  if (result.exitCode === 0) return null;
  const output = `${result.stderr}\n${result.output}`.toLowerCase();
  if (/\b429\b|rate.?limit|too many requests/u.test(output)) {
    return new AppError(`Claude CLI bị giới hạn lượt gọi ở bước ${stepLabel}. Hãy thử tiếp tục sau.`, 429, 'CLAUDE_CLI_RATE_LIMITED');
  }
  if (/\blogin\b|unauthori[sz]ed|not authenticated|authentication|invalid api key/u.test(output)) {
    return new AppError(`Claude CLI chưa đăng nhập hoặc xác thực thất bại ở bước ${stepLabel}.`, 401, 'CLAUDE_CLI_AUTH_FAILED');
  }
  return new AppError(`Claude CLI thất bại ở bước ${stepLabel} (mã thoát ${result.exitCode ?? 'không rõ'}).`, 503, 'CLAUDE_CLI_FAILED');
}

export async function createClaudeCliScriptBackend(options: ClaudeCliScriptBackendOptions): Promise<ScriptChatBackend> {
  const status = await (options.getStatus ?? getClaudeCliStatus)({ executablePath: options.config.CLAUDE_CLI_PATH, env: options.env });
  if (!status.available) {
    throw new AppError('Claude Code CLI chưa khả dụng trên máy chủ này. Hãy kiểm tra cài đặt và đăng nhập rồi thử lại.', 503, 'CLAUDE_CLI_UNAVAILABLE');
  }
  const model = options.model ?? CLAUDE_CLI_DEFAULT_MODEL;
  const effort: ClaudeCliEffort = CLAUDE_CLI_DEFAULT_EFFORT;
  const modelCap = getAiModelDefinition('claude', model)?.capabilities.maxOutputTokens;
  const runCli = options.runCli ?? runClaudeCli;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  let callCount = 0;

  return {
    label: `claude-cli:${model}`,
    model,
    outputTokenCap: modelCap ?? 32_000,
    logRawParseFailures: false,
    chat: async (messages, _chatOptions, callContext) => {
      if (await options.context.isCancelled()) throw new DOMException('Aborted', 'AbortError');
      const stepLabel = callContext.stepLabel;
      const promptText = formatChatMessages(messages);
      const promptBytes = Buffer.byteLength(promptText, 'utf8');
      const controller = new AbortController();
      const callerAborted = () => controller.abort();
      if (callContext.signal?.aborted) controller.abort();
      callContext.signal?.addEventListener('abort', callerAborted, { once: true });
      let checkingCancellation = false;
      const timer = setInterval(() => {
        if (checkingCancellation) return;
        checkingCancellation = true;
        void options.context.isCancelled()
          .then((cancelled) => { if (cancelled) controller.abort(); })
          .catch(() => undefined)
          .finally(() => { checkingCancellation = false; });
      }, pollIntervalMs);
      callCount += 1;
      let result!: ClaudeCliRunResult;
      try {
        result = await runCli({
          ...options.config,
          projectId: options.projectId,
          chapterId: 'script-generation',
          stepLabel,
          promptText,
          model,
          effort,
          cliVersion: status.version,
          signal: controller.signal,
          env: options.env,
          ...(options.spawnProcess ? { spawnProcess: options.spawnProcess } : {}),
          ...(options.killProcessTree ? { killProcessTree: options.killProcessTree } : {}),
        });
      } finally {
        clearInterval(timer);
        callContext.signal?.removeEventListener('abort', callerAborted);
      }
      await callContext.appendLog(`Claude CLI call ${callCount}: ${stepLabel}; model ${model}; effort ${effort}; prompt ${promptBytes} bytes; ${result.durationMs} ms; audit folder ${result.displayPath}.`);
      if (result.cancelled || controller.signal.aborted || await options.context.isCancelled()) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const failure = cliFailure(result, stepLabel);
      if (failure) throw failure;
      const output = await readFile(path.join(result.runDirectory, 'output.txt'), 'utf8');
      return { text: output, truncated: false };
    },
  };
}
