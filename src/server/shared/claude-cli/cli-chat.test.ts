import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeCliRunOptions, ClaudeCliRunResult, ClaudeCliStatus } from './cli-runner';
import { createClaudeCliChat, formatChatMessages } from './cli-chat';

const config = {
  CLAUDE_CLI_PATH: 'claude',
  CLAUDE_CLI_TIMEOUT_MS: 10_000,
  CLAUDE_CLI_MAX_OUTPUT_BYTES: 4096,
  FILES_DIR: 'files',
};

function result(overrides: Partial<ClaudeCliRunResult> = {}): ClaudeCliRunResult {
  return {
    runId: 'run-1', runDirectory: 'audit/run-1', displayPath: 'audit/run-1', output: '{"ok":true}', stderr: '',
    exitCode: 0, durationMs: 123, outputBytes: 11, cancelled: false, timedOut: false, outputTooLarge: false, spawnError: null,
    ...overrides,
  };
}

const available: ClaudeCliStatus = { available: true, version: 'Claude Code 2.1.294', authPathLikely: 'subscription' };
const messages = [{ role: 'system' as const, content: 'system prompt' }, { role: 'user' as const, content: 'user prompt' }];

describe('Claude CLI chat wrapper', () => {
  let tempDir: string | undefined;
  afterEach(async () => { if (tempDir) await rm(tempDir, { recursive: true, force: true }); tempDir = undefined; });

  it('formats prompts, appends the JSON-only instruction, and logs bytes, duration, and audit path without output or environment secrets', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cli-chat-'));
    const appendLog = vi.fn(async () => undefined);
    const runCli = vi.fn(async (options: ClaudeCliRunOptions) => {
      expect(options.promptText).toContain('Return only the JSON object, no commentary, no code fences.');
      return result({ runDirectory: tempDir!, displayPath: 'audit/display' });
    });
    const chat = await createClaudeCliChat({
      config, projectId: 'project-1', chapterId: 'seo-generation', label: 'SEO', model: 'claude-sonnet-5-5',
      context: { isCancelled: async () => false, appendLog }, env: { ANTHROPIC_API_KEY: 'secret-sentinel' },
      getStatus: async () => available, runCli,
    });

    await expect(chat.chat(messages, { stepLabel: 'main-sections' })).resolves.toBe('{"ok":true}');

    const promptText = runCli.mock.calls[0]![0].promptText;
    expect(promptText).toBe('SYSTEM\nsystem prompt\n\nUSER\nuser prompt\n\nReturn only the JSON object, no commentary, no code fences.');
    expect(runCli.mock.calls[0]![0]).toMatchObject({ projectId: 'project-1', chapterId: 'seo-generation', stepLabel: 'main-sections', model: 'claude-sonnet-5-5', effort: 'medium' });
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining(`prompt ${Buffer.byteLength(promptText, 'utf8')} bytes`));
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('model claude-sonnet-5-5; effort medium'));
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('123 ms'));
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('audit/display'));
    expect(appendLog.mock.calls.join(' ')).not.toContain('secret-sentinel');
  });

  it.each([
    { caller: 'SEO generation', chapterId: 'seo-generation', label: 'SEO' },
    { caller: 'YouTube review', chapterId: 'youtube-review-channel', label: 'Đánh giá kênh YouTube' },
    { caller: 'YouTube video ideas', chapterId: 'youtube-ideas', label: 'Ý tưởng video tiếp theo' },
  ])('resolves omitted model and effort to the product defaults for $caller', async ({ chapterId, label }) => {
    const runCli = vi.fn(async (options: ClaudeCliRunOptions) => {
      expect(options.model).toBe('claude-sonnet-5-5');
      return result();
    });
    const chat = await createClaudeCliChat({
      config, projectId: 'p', chapterId, label, context: { isCancelled: async () => false, appendLog: async () => undefined },
      getStatus: async () => available, runCli,
    });
    await chat.chat(messages);
    expect(chat).toMatchObject({ model: 'claude-sonnet-5-5' });
    expect(runCli.mock.calls[0]?.[0]).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium' });
  });

  it('maps unavailable, timeout, output-cap, rate-limit, and auth failures', async () => {
    const context = { isCancelled: async () => false, appendLog: vi.fn(async () => undefined) };
    await expect(createClaudeCliChat({ config, projectId: 'p', chapterId: 'seo', label: 'SEO', context, getStatus: async () => ({ ...available, available: false, reason: 'login required' }) }))
      .rejects.toMatchObject({ status: 503, code: 'CLAUDE_CLI_UNAVAILABLE', message: 'login required' });

    const failures: Array<[Partial<ClaudeCliRunResult>, string, number]> = [
      [{ timedOut: true }, 'CLAUDE_CLI_TIMEOUT', 503],
      [{ outputTooLarge: true }, 'CLAUDE_CLI_OUTPUT_TOO_LARGE', 413],
      [{ spawnError: 'spawn failed' }, 'CLAUDE_CLI_UNAVAILABLE', 503],
      [{ exitCode: 1, stderr: '429 rate limit' }, 'CLAUDE_CLI_RATE_LIMITED', 429],
      [{ exitCode: 1, stderr: 'not authenticated' }, 'CLAUDE_CLI_AUTH_FAILED', 401],
    ];
    for (const [override, code, status] of failures) {
      const chat = await createClaudeCliChat({ config, projectId: 'p', chapterId: 'seo', label: 'SEO', context, getStatus: async () => available, runCli: async () => result(override) });
      await expect(chat.chat(messages, { stepLabel: 'main' })).rejects.toMatchObject({ status, code });
    }
  });

  it('aborts the running CLI process when cancellation is requested', async () => {
    let cancelled = false;
    let observedAbort = false;
    const runCli = vi.fn((options: ClaudeCliRunOptions) => new Promise<ClaudeCliRunResult>((resolve) => {
      options.signal?.addEventListener('abort', () => { observedAbort = true; resolve(result({ cancelled: true, exitCode: null })); }, { once: true });
      setTimeout(() => { cancelled = true; }, 5);
    }));
    const chat = await createClaudeCliChat({
      config, projectId: 'p', chapterId: 'seo', label: 'SEO', context: { isCancelled: async () => cancelled, appendLog: vi.fn(async () => undefined) },
      getStatus: async () => available, runCli, pollIntervalMs: 1,
    });

    await expect(chat.chat(messages, { stepLabel: 'main' })).rejects.toMatchObject({ name: 'AbortError' });
    expect(observedAbort).toBe(true);
  });

  it('formats multiple user messages in order', () => {
    expect(formatChatMessages([
      { role: 'system', content: 'rules' }, { role: 'user', content: 'first' }, { role: 'assistant', content: 'ignored' }, { role: 'user', content: 'second' },
    ])).toBe('SYSTEM\nrules\n\nUSER\nfirst\n\nsecond');
  });
});
