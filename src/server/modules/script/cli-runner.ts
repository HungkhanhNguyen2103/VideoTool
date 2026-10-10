import { createRequire } from 'node:module';
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { access, mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Config } from '../../config';
import { newId } from '../../shared/ids';

const require = createRequire(import.meta.url);
const spawnWithWindowsShimSupport = require('cross-spawn') as typeof nodeSpawn;
const RUN_RETENTION_COUNT = 100;
const STDERR_CAPTURE_LIMIT = 64_000;

export type ClaudeCliSpawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export type ClaudeCliRunResult = {
  runId: string;
  runDirectory: string;
  displayPath: string;
  output: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  outputBytes: number;
  cancelled: boolean;
  timedOut: boolean;
  outputTooLarge: boolean;
  spawnError: string | null;
};

export type ClaudeCliRunOptions = Pick<Config,
  'CLAUDE_CLI_PATH' | 'CLAUDE_CLI_TIMEOUT_MS' | 'CLAUDE_CLI_MAX_OUTPUT_BYTES' | 'FILES_DIR'
> & {
  projectId: string;
  chapterId: string;
  stepLabel?: string;
  promptText: string;
  model?: string;
  cliVersion?: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  spawnProcess?: ClaudeCliSpawn;
  killProcessTree?: (child: ChildProcess) => void;
};

export type ClaudeCliStatus = {
  available: boolean;
  version?: string;
  reason?: string;
  authPathLikely: 'api-key' | 'subscription';
};

export type ClaudeCliStatusOptions = {
  executablePath: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  spawnProcess?: ClaudeCliSpawn;
};

type CaptureOptions = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: Buffer;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  spawnProcess: ClaudeCliSpawn;
  killProcessTree: (child: ChildProcess) => void;
};

type CapturedProcess = {
  stdout: Buffer;
  stderr: Buffer;
  outputBytes: number;
  stderrBytes: number;
  exitCode: number | null;
  durationMs: number;
  cancelled: boolean;
  timedOut: boolean;
  outputTooLarge: boolean;
  spawnError: string | null;
};

function safePathPart(value: string): boolean {
  return /^[a-zA-Z0-9_-]+$/u.test(value) && value !== '.' && value !== '..';
}

function cliArgs(model?: string): string[] {
  return [
    '--print',
    '--input-format', 'text',
    '--output-format', 'text',
    '--tools', '',
    '--safe-mode',
    '--no-session-persistence',
    ...(model ? ['--model', model] : []),
  ];
}

async function resolveExecutable(executablePath: string, env: NodeJS.ProcessEnv): Promise<string> {
  const platform = process.platform;
  const hasDirectory = path.isAbsolute(executablePath) || executablePath.includes('/') || executablePath.includes('\\');
  const extensions = platform === 'win32'
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const candidates: string[] = [];

  if (hasDirectory) {
    const absolute = path.resolve(executablePath);
    candidates.push(absolute);
    if (platform === 'win32' && !path.extname(absolute)) candidates.push(...extensions.map((extension) => `${absolute}${extension}`));
  } else {
    for (const directory of (env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
      candidates.push(path.join(directory, executablePath));
      if (platform === 'win32' && !path.extname(executablePath)) {
        candidates.push(...extensions.map((extension) => path.join(directory, `${executablePath}${extension}`)));
      }
    }
  }

  for (const candidate of candidates) {
    try {
      await access(candidate);
      if ((await stat(candidate)).isFile()) return path.resolve(candidate);
    } catch {
      // Try the next PATH candidate.
    }
  }
  throw new Error(`Không tìm thấy Claude Code CLI tại “${executablePath}”.`);
}

function killProcessTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    try {
      const killer = nodeSpawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', () => child.kill());
      killer.unref();
      return;
    } catch {
      child.kill();
      return;
    }
  }
  child.kill('SIGTERM');
}

function captureProcess(options: CaptureOptions): Promise<CapturedProcess> {
  const startedAt = Date.now();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let outputBytes = 0;
  let stderrBytes = 0;
  let capturedStdoutBytes = 0;
  let capturedStderrBytes = 0;
  let cancelled = Boolean(options.signal?.aborted);
  let timedOut = false;
  let outputTooLarge = false;
  let spawnError: string | null = null;

  if (cancelled) {
    return Promise.resolve({
      stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), outputBytes: 0, stderrBytes: 0,
      exitCode: null, durationMs: 0, cancelled, timedOut, outputTooLarge, spawnError,
    });
  }

  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = options.spawnProcess(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({
        stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), outputBytes: 0, stderrBytes: 0,
        exitCode: null, durationMs: Date.now() - startedAt, cancelled, timedOut, outputTooLarge,
        spawnError: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const stop = () => {
      try { options.killProcessTree(child); } catch { child.kill(); }
    };
    const onAbort = () => { cancelled = true; stop(); };
    if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += buffer.byteLength;
      const available = Math.max(0, options.maxOutputBytes - capturedStdoutBytes);
      if (available > 0) {
        const captured = buffer.subarray(0, available);
        stdoutChunks.push(captured);
        capturedStdoutBytes += captured.byteLength;
      }
      if (outputBytes > options.maxOutputBytes && !outputTooLarge) {
        outputTooLarge = true;
        stop();
      }
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += buffer.byteLength;
      const available = Math.max(0, STDERR_CAPTURE_LIMIT - capturedStderrBytes);
      if (available > 0) {
        const captured = buffer.subarray(0, available);
        stderrChunks.push(captured);
        capturedStderrBytes += captured.byteLength;
      }
    });
    child.stdin?.on('error', () => undefined);
    child.on('error', (error) => { spawnError = error.message; });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        outputBytes,
        stderrBytes,
        exitCode,
        durationMs: Date.now() - startedAt,
        cancelled,
        timedOut,
        outputTooLarge,
        spawnError,
      });
    });
    child.stdin?.end(options.stdin);
  });
}

function defaultEnvironment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return env ?? process.env;
}

export async function getClaudeCliStatus(options: ClaudeCliStatusOptions): Promise<ClaudeCliStatus> {
  const env = defaultEnvironment(options.env);
  const authPathLikely = env.ANTHROPIC_API_KEY?.trim() ? 'api-key' : 'subscription';
  let cwd: string | null = null;
  try {
    const executable = await resolveExecutable(options.executablePath, env);
    cwd = await mkdtemp(path.join(os.tmpdir(), 'video-tool-claude-status-'));
    const result = await captureProcess({
      command: executable,
      args: ['--version'],
      cwd,
      env,
      timeoutMs: options.timeoutMs ?? 3_000,
      maxOutputBytes: 4_096,
      spawnProcess: options.spawnProcess ?? spawnWithWindowsShimSupport,
      killProcessTree,
    });
    const version = result.stdout.toString('utf8').trim();
    if (result.exitCode !== 0 || result.timedOut || result.spawnError || !version) {
      return {
        available: false,
        reason: result.timedOut ? 'Claude Code CLI không phản hồi khi kiểm tra phiên bản.' : 'Không thể chạy Claude Code CLI. Hãy kiểm tra đường dẫn và quyền đăng nhập.',
        authPathLikely,
      };
    }
    return { available: true, version, authPathLikely };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : 'Không thể tìm thấy Claude Code CLI.',
      authPathLikely,
    };
  } finally {
    if (cwd) await rm(cwd, { recursive: true, force: true });
  }
}

export async function runClaudeCli(options: ClaudeCliRunOptions): Promise<ClaudeCliRunResult> {
  if (!safePathPart(options.projectId)) throw new Error('Mã dự án không hợp lệ cho thư mục Claude CLI.');
  if (!safePathPart(options.chapterId)) throw new Error('Mã chương không hợp lệ cho thư mục Claude CLI.');
  if (options.stepLabel !== undefined && !safePathPart(options.stepLabel)) throw new Error('Nhãn bước không hợp lệ cho thư mục Claude CLI.');
  const runsDirectory = path.resolve(options.FILES_DIR, options.projectId, 'cli-runs');
  const runId = newId();
  const runDirectory = path.join(runsDirectory, runId);
  await mkdir(runDirectory, { recursive: true });
  const promptBuffer = Buffer.from(options.promptText, 'utf8');
  await writeFile(path.join(runDirectory, 'prompt.md'), promptBuffer);

  let workingDirectory: string | null = null;
  let executable = options.CLAUDE_CLI_PATH;
  let captured: CapturedProcess = {
    stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), outputBytes: 0, stderrBytes: 0,
    exitCode: null, durationMs: 0, cancelled: Boolean(options.signal?.aborted), timedOut: false,
    outputTooLarge: false, spawnError: null,
  };
  const args = cliArgs(options.model);
  try {
    if (!captured.cancelled) {
      executable = await resolveExecutable(options.CLAUDE_CLI_PATH, defaultEnvironment(options.env));
      workingDirectory = await mkdtemp(path.join(os.tmpdir(), 'video-tool-claude-run-'));
      captured = await captureProcess({
        command: executable,
        args,
        cwd: workingDirectory,
        env: defaultEnvironment(options.env),
        stdin: promptBuffer,
        timeoutMs: options.CLAUDE_CLI_TIMEOUT_MS,
        maxOutputBytes: options.CLAUDE_CLI_MAX_OUTPUT_BYTES,
        signal: options.signal,
        spawnProcess: options.spawnProcess ?? spawnWithWindowsShimSupport,
        killProcessTree: options.killProcessTree ?? killProcessTree,
      });
    }
  } catch (error) {
    captured.spawnError = error instanceof Error ? error.message : String(error);
  } finally {
    if (workingDirectory) await rm(workingDirectory, { recursive: true, force: true });
  }

  const outputPath = path.join(runDirectory, 'output.txt');
  const outputBuffer = captured.stdout;
  await writeFile(outputPath, outputBuffer);
  const metadata = {
    command: { executable, args, shell: false },
    model: options.model ?? null,
    cliVersion: options.cliVersion ?? null,
    exitCode: captured.exitCode,
    durationMs: captured.durationMs,
    promptBytes: promptBuffer.byteLength,
    outputBytes: captured.outputBytes,
    stderrBytes: captured.stderrBytes,
    chapterId: options.chapterId,
    stepLabel: options.stepLabel ?? options.chapterId,
    timedOut: captured.timedOut,
    cancelled: captured.cancelled,
    outputTooLarge: captured.outputTooLarge,
    spawnError: captured.spawnError !== null,
  };
  await writeFile(path.join(runDirectory, 'meta.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  await pruneRuns(runsDirectory);

  return {
    runId,
    runDirectory,
    displayPath: path.relative(process.cwd(), runDirectory).split(path.sep).join('/'),
    output: outputBuffer.toString('utf8'),
    stderr: captured.stderr.toString('utf8'),
    exitCode: captured.exitCode,
    durationMs: captured.durationMs,
    outputBytes: captured.outputBytes,
    cancelled: captured.cancelled,
    timedOut: captured.timedOut,
    outputTooLarge: captured.outputTooLarge,
    spawnError: captured.spawnError,
  };
}

async function pruneRuns(runsDirectory: string): Promise<void> {
  const entries = await readdir(runsDirectory, { withFileTypes: true });
  const completedRuns: Array<{ path: string; modifiedAt: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(runsDirectory, entry.name);
    try {
      await readFile(path.join(directory, 'meta.json'));
      completedRuns.push({ path: directory, modifiedAt: (await stat(directory)).mtimeMs });
    } catch {
      // Keep incomplete runs; a concurrent process may still be writing one.
    }
  }
  completedRuns.sort((left, right) => right.modifiedAt - left.modifiedAt);
  await Promise.all(completedRuns.slice(RUN_RETENTION_COUNT).map(({ path: directory }) => rm(directory, { recursive: true, force: true })));
}
