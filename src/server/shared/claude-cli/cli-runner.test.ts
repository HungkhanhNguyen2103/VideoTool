import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildClaudeCliArgs, CLAUDE_CLI_DEFAULT_EFFORT, CLAUDE_CLI_DEFAULT_MODEL, getClaudeCliStatus, runClaudeCli, type ClaudeCliSpawn } from './cli-runner';

const fixture = fileURLToPath(new URL('./fixtures/fake-claude-cli.mjs', import.meta.url));
const testRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-tool-cli-runner-'));
  testRoots.push(root);
  return root;
}

function fakeSpawn(calls: Array<{ command: string; args: string[]; options: SpawnOptions }> = []): ClaudeCliSpawn {
  return (command, args, options) => {
    calls.push({ command, args: [...args], options });
    return spawn(process.execPath, [fixture, ...args], options) as ChildProcess;
  };
}

afterEach(async () => {
  await Promise.all(testRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('runClaudeCli', () => {
  it('delivers the prompt on stdin and writes the prompt, raw answer, and command metadata', async () => {
    const filesDir = await makeRoot();
    const capture = path.join(filesDir, 'stdin.txt');
    const cwdCapture = path.join(filesDir, 'cwd-contents.json');
    const promptText = 'SYSTEM\nexact system\n\nUSER\nexact user';
    const output = '{"paragraphs":["A response."],"chapterSummary":"Summary","avoidRepeating":[],"persistentFactsNext":[]}';
    const calls: Array<{ command: string; args: string[]; options: SpawnOptions }> = [];
    const result = await runClaudeCli({
      CLAUDE_CLI_PATH: process.execPath,
      FILES_DIR: filesDir,
      projectId: 'project-1',
      chapterId: 'chapter-2',
      promptText,
      model: 'claude-sonnet-5-5',
      CLAUDE_CLI_TIMEOUT_MS: 2_000,
      CLAUDE_CLI_MAX_OUTPUT_BYTES: 2_000,
      env: { ...process.env, FAKE_CLAUDE_MODE: 'valid', FAKE_CLAUDE_CAPTURE: capture, FAKE_CLAUDE_CWD_CAPTURE: cwdCapture },
      spawnProcess: fakeSpawn(calls),
    });

    expect(await readFile(capture, 'utf8')).toBe(promptText);
    expect(JSON.parse(await readFile(cwdCapture, 'utf8'))).toEqual([]);
    expect(await readFile(path.join(result.runDirectory, 'prompt.md'), 'utf8')).toBe(promptText);
    expect(await readFile(path.join(result.runDirectory, 'output.txt'), 'utf8')).toBe(output);
    const metadata = JSON.parse(await readFile(path.join(result.runDirectory, 'meta.json'), 'utf8')) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      model: 'claude-sonnet-5-5',
      effort: 'medium',
      exitCode: 0,
      promptBytes: Buffer.byteLength(promptText),
      outputBytes: Buffer.byteLength(output),
      chapterId: 'chapter-2',
      command: { executable: process.execPath, shell: false },
    });
    expect(JSON.stringify(metadata)).not.toContain(promptText);
    expect(calls[0]?.args).toEqual([
      '--print', '--input-format', 'text', '--output-format', 'text', '--tools', '',
      '--safe-mode', '--no-session-persistence', '--model', 'claude-sonnet-5-5', '--effort', 'medium',
    ]);
    expect(calls[0]?.options.shell).toBe(false);
    expect(calls[0]?.options.cwd).not.toBe(filesDir);
    expect(calls[0]?.options.cwd).not.toBe(process.cwd());
    expect(result.output).toBe(output);
    expect(result.outputTooLarge).toBe(false);
  });

  it('keeps fenced stdout unchanged so the existing tolerant parser owns fence handling', async () => {
    const filesDir = await makeRoot();
    const fenced = '```json\n{"paragraphs":["A"],"chapterSummary":"S","avoidRepeating":[],"persistentFactsNext":[]}\n```';
    const result = await runClaudeCli({
      CLAUDE_CLI_PATH: process.execPath,
      FILES_DIR: filesDir,
      projectId: 'project-1',
      chapterId: 'chapter-1',
      promptText: 'prompt',
      CLAUDE_CLI_TIMEOUT_MS: 2_000,
      CLAUDE_CLI_MAX_OUTPUT_BYTES: 2_000,
      env: { ...process.env, FAKE_CLAUDE_MODE: 'fenced' },
      spawnProcess: fakeSpawn(),
    });
    expect(result.output).toBe(fenced);
    expect(await readFile(path.join(result.runDirectory, 'output.txt'), 'utf8')).toBe(fenced);
  });

  it('records the shared model and effort defaults in args and audit metadata', async () => {
    const filesDir = await makeRoot();
    const calls: Array<{ command: string; args: string[]; options: SpawnOptions }> = [];
    const runOptions = {
      CLAUDE_CLI_PATH: process.execPath,
      FILES_DIR: filesDir,
      projectId: 'project-1',
      chapterId: 'script-generation',
      stepLabel: 'outline',
      promptText: 'outline prompt',
      CLAUDE_CLI_TIMEOUT_MS: 2_000,
      CLAUDE_CLI_MAX_OUTPUT_BYTES: 2_000,
      env: { ...process.env, FAKE_CLAUDE_MODE: 'valid' },
      spawnProcess: fakeSpawn(calls),
    };
    const result = await runClaudeCli(runOptions);
    const metadata = JSON.parse(await readFile(path.join(result.runDirectory, 'meta.json'), 'utf8')) as Record<string, unknown>;

    expect(metadata.stepLabel).toBe('outline');
    expect(metadata).toMatchObject({ model: CLAUDE_CLI_DEFAULT_MODEL, effort: CLAUDE_CLI_DEFAULT_EFFORT });
    expect(calls[0]?.args).toEqual(buildClaudeCliArgs());
  });

  it('allows an explicit model while retaining the default effort', () => {
    expect(buildClaudeCliArgs('claude-haiku-5-5')).toEqual([
      '--print', '--input-format', 'text', '--output-format', 'text', '--tools', '',
      '--safe-mode', '--no-session-persistence', '--model', 'claude-haiku-5-5', '--effort', 'medium',
    ]);
  });

  it.skipIf(process.platform !== 'win32')('runs a Windows .cmd shim with argv flags while keeping shell text in stdin', async () => {
    const filesDir = await makeRoot();
    const capture = path.join(filesDir, 'stdin.txt');
    const promptText = 'SYSTEM\ntrusted prompt\n\nUSER\nliteral & whoami';
    const shimPath = path.join(filesDir, 'fake-claude.cmd');
    await writeFile(shimPath, `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`, 'utf8');
    const result = await runClaudeCli({
      CLAUDE_CLI_PATH: shimPath,
      FILES_DIR: filesDir,
      projectId: 'project-1',
      chapterId: 'chapter-1',
      promptText,
      CLAUDE_CLI_TIMEOUT_MS: 2_000,
      CLAUDE_CLI_MAX_OUTPUT_BYTES: 2_000,
      env: { ...process.env, FAKE_CLAUDE_MODE: 'valid', FAKE_CLAUDE_CAPTURE: capture },
    });
    expect(await readFile(capture, 'utf8')).toBe(promptText);
    expect(result.output).toContain('"paragraphs"');
    expect(result.exitCode).toBe(0);
  });

  it('kills the child and reports cancellation without losing the run files', async () => {
    const filesDir = await makeRoot();
    const started = path.join(filesDir, 'started');
    const controller = new AbortController();
    const killed: number[] = [];
    const resultPromise = runClaudeCli({
      CLAUDE_CLI_PATH: process.execPath,
      FILES_DIR: filesDir,
      projectId: 'project-1',
      chapterId: 'chapter-1',
      promptText: 'prompt',
      CLAUDE_CLI_TIMEOUT_MS: 5_000,
      CLAUDE_CLI_MAX_OUTPUT_BYTES: 2_000,
      signal: controller.signal,
      env: { ...process.env, FAKE_CLAUDE_MODE: 'hang', FAKE_CLAUDE_STARTED: started },
      spawnProcess: fakeSpawn(),
      killProcessTree: (child) => { if (child.pid) killed.push(child.pid); child.kill('SIGKILL'); },
    });
    await waitForFile(started);
    controller.abort();
    const result = await resultPromise;
    expect(result.cancelled).toBe(true);
    expect(killed).toHaveLength(1);
    expect(await readFile(path.join(result.runDirectory, 'prompt.md'), 'utf8')).toBe('prompt');
    expect(await readFile(path.join(result.runDirectory, 'output.txt'), 'utf8')).toBe('');
  });

  it('kills a child that exceeds the configured output byte cap and preserves only bounded stdout', async () => {
    const filesDir = await makeRoot();
    const result = await runClaudeCli({
      CLAUDE_CLI_PATH: process.execPath,
      FILES_DIR: filesDir,
      projectId: 'project-1',
      chapterId: 'chapter-1',
      promptText: 'prompt',
      CLAUDE_CLI_TIMEOUT_MS: 2_000,
      CLAUDE_CLI_MAX_OUTPUT_BYTES: 32,
      env: { ...process.env, FAKE_CLAUDE_MODE: 'oversized' },
      spawnProcess: fakeSpawn(),
      killProcessTree: (child) => child.kill('SIGKILL'),
    });
    expect(result.outputTooLarge).toBe(true);
    expect(result.outputBytes).toBeGreaterThan(32);
    expect(Buffer.byteLength(await readFile(path.join(result.runDirectory, 'output.txt')))).toBeLessThanOrEqual(32);
  });

  it('times out a child that does not exit', async () => {
    const filesDir = await makeRoot();
    const result = await runClaudeCli({
      CLAUDE_CLI_PATH: process.execPath,
      FILES_DIR: filesDir,
      projectId: 'project-1',
      chapterId: 'chapter-1',
      promptText: 'prompt',
      CLAUDE_CLI_TIMEOUT_MS: 40,
      CLAUDE_CLI_MAX_OUTPUT_BYTES: 2_000,
      env: { ...process.env, FAKE_CLAUDE_MODE: 'hang' },
      spawnProcess: fakeSpawn(),
      killProcessTree: (child) => child.kill('SIGKILL'),
    });
    expect(result.timedOut).toBe(true);
    expect(result.cancelled).toBe(false);
  });

  it('prunes completed runs to the newest one hundred for a project', async () => {
    const filesDir = await makeRoot();
    const runsDir = path.join(filesDir, 'project-1', 'cli-runs');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(runsDir, { recursive: true }));
    for (let index = 0; index < 100; index += 1) {
      const dir = path.join(runsDir, `old-${index}`);
      await import('node:fs/promises').then(({ mkdir }) => mkdir(dir));
      await writeFile(path.join(dir, 'meta.json'), JSON.stringify({ exitCode: 0 }));
      const old = new Date(Date.now() - (100_000 + index * 1_000));
      await utimes(dir, old, old);
    }
    const result = await runClaudeCli({
      CLAUDE_CLI_PATH: process.execPath,
      FILES_DIR: filesDir,
      projectId: 'project-1',
      chapterId: 'chapter-1',
      promptText: 'prompt',
      CLAUDE_CLI_TIMEOUT_MS: 2_000,
      CLAUDE_CLI_MAX_OUTPUT_BYTES: 2_000,
      env: { ...process.env, FAKE_CLAUDE_MODE: 'valid' },
      spawnProcess: fakeSpawn(),
    });
    const dirs = await readdir(runsDir);
    expect(dirs).toHaveLength(100);
    expect(dirs).toContain(path.basename(result.runDirectory));
  });
});

describe('getClaudeCliStatus', () => {
  it('runs the CLI version command and reports likely subscription authentication', async () => {
    const status = await getClaudeCliStatus({
      executablePath: process.execPath,
      timeoutMs: 500,
      env: { ...process.env, ANTHROPIC_API_KEY: '', FAKE_CLAUDE_MODE: 'version' },
      spawnProcess: fakeSpawn(),
    });
    expect(status).toMatchObject({ available: true, version: 'Claude Code 2.1.294', authPathLikely: 'subscription' });
  });

  it('reports API-key authentication without exposing the key', async () => {
    const key = 'secret-test-api-key';
    const status = await getClaudeCliStatus({
      executablePath: process.execPath,
      timeoutMs: 500,
      env: { ...process.env, ANTHROPIC_API_KEY: key, FAKE_CLAUDE_MODE: 'version' },
      spawnProcess: fakeSpawn(),
    });
    expect(status.authPathLikely).toBe('api-key');
    expect(JSON.stringify(status)).not.toContain(key);
  });
});

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try { await readFile(filePath); return; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  throw new Error('Fake CLI did not start before timeout.');
}
