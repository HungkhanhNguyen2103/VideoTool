import type { Config } from '../../config';
import type { ChatMessage } from '../ai';
import { AppError } from '../errors';
import {
  getClaudeCliStatus,
  runClaudeCli,
  CLAUDE_CLI_DEFAULT_EFFORT,
  CLAUDE_CLI_DEFAULT_MODEL,
  type ClaudeCliRunOptions,
  type ClaudeCliRunResult,
  type ClaudeCliEffort,
  type ClaudeCliStatus,
} from './cli-runner';

export type ClaudeCliChatConfig = Pick<Config,
  'CLAUDE_CLI_PATH' | 'CLAUDE_CLI_TIMEOUT_MS' | 'CLAUDE_CLI_MAX_OUTPUT_BYTES' | 'FILES_DIR'
>;

export type ClaudeCliChatContext = {
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
};

export type ClaudeCliChatOptions = {
  projectId: string;
  chapterId: string;
  label: string;
  model?: string;
  effort?: ClaudeCliEffort;
  config: ClaudeCliChatConfig;
  context: ClaudeCliChatContext;
  env?: NodeJS.ProcessEnv;
  getStatus?: (options: { executablePath: string; env?: NodeJS.ProcessEnv }) => Promise<ClaudeCliStatus>;
  runCli?: (options: ClaudeCliRunOptions) => Promise<ClaudeCliRunResult>;
  spawnProcess?: ClaudeCliRunOptions['spawnProcess'];
  killProcessTree?: ClaudeCliRunOptions['killProcessTree'];
  pollIntervalMs?: number;
};

export type ClaudeCliChat = {
  label: string;
  model: string;
  chat: (messages: ChatMessage[], options?: { stepLabel?: string }) => Promise<string>;
};

export function formatChatMessages(messages: readonly ChatMessage[]): string {
  const system = messages.find((message) => message.role === 'system')?.content ?? '';
  const user = messages.filter((message) => message.role === 'user').map((message) => message.content).join('\n\n');
  return `SYSTEM\n${system}\n\nUSER\n${user}`;
}

export function claudeCliFailure(result: ClaudeCliRunResult, stepLabel: string): AppError | null {
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

export function assertClaudeCliStatusAvailable(status: ClaudeCliStatus): ClaudeCliStatus {
  if (!status.available) {
    throw new AppError(status.reason ?? 'Claude Code CLI chưa khả dụng trên máy chủ này.', 503, 'CLAUDE_CLI_UNAVAILABLE');
  }
  return status;
}

export async function assertClaudeCliAvailable(
  config: Pick<ClaudeCliChatConfig, 'CLAUDE_CLI_PATH'>,
  options: {
    env?: NodeJS.ProcessEnv;
    getStatus?: ClaudeCliChatOptions['getStatus'];
  } = {},
): Promise<ClaudeCliStatus> {
  const status = await (options.getStatus ?? getClaudeCliStatus)({ executablePath: config.CLAUDE_CLI_PATH, env: options.env });
  return assertClaudeCliStatusAvailable(status);
}

export async function createClaudeCliChat(options: ClaudeCliChatOptions): Promise<ClaudeCliChat> {
  const env = options.env ?? process.env;
  const status = await assertClaudeCliAvailable(options.config, { env, getStatus: options.getStatus });
  const model = options.model ?? CLAUDE_CLI_DEFAULT_MODEL;
  const effort = options.effort ?? CLAUDE_CLI_DEFAULT_EFFORT;
  const runCli = options.runCli ?? runClaudeCli;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  let callCount = 0;

  return {
    label: `claude-cli:${model}`,
    model,
    chat: async (messages, callOptions = {}) => {
      if (await options.context.isCancelled()) throw new DOMException('Aborted', 'AbortError');
      const stepLabel = callOptions.stepLabel ?? options.label;
      const promptText = `${formatChatMessages(messages)}\n\nReturn only the JSON object, no commentary, no code fences.`;
      const promptBytes = Buffer.byteLength(promptText, 'utf8');
      const controller = new AbortController();
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
      let result: ClaudeCliRunResult;
      try {
        result = await runCli({
          ...options.config,
          projectId: options.projectId,
          chapterId: options.chapterId,
          stepLabel: `${stepLabel}${callCount > 1 ? `-${callCount}` : ''}`,
          promptText,
          model,
          effort,
          cliVersion: status.version,
          signal: controller.signal,
          env,
          ...(options.spawnProcess ? { spawnProcess: options.spawnProcess } : {}),
          ...(options.killProcessTree ? { killProcessTree: options.killProcessTree } : {}),
        });
      } finally {
        clearInterval(timer);
      }
      await options.context.appendLog(`Claude CLI ${options.label} call ${callCount}: ${stepLabel}; model ${model}; effort ${effort}; prompt ${promptBytes} bytes; ${result.durationMs} ms; audit folder ${result.displayPath}.`);
      if (result.cancelled || controller.signal.aborted || await options.context.isCancelled()) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const failure = claudeCliFailure(result, stepLabel);
      if (failure) throw failure;
      return result.output;
    },
  };
}
