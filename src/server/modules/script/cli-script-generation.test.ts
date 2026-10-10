import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createProject, getProject } from '../project';
import { generateScript, type ScriptGenerationJobContext } from './service';
import { createClaudeCliScriptBackend } from './cli-script-backend';
import { ScriptJobPayloadSchema } from './handler';
import type { ClaudeCliRunResult, ClaudeCliSpawn } from './cli-runner';

const fixture = fileURLToPath(new URL('./fixtures/fake-claude-cli.mjs', import.meta.url));
const projectInput = {
  title: 'Task 94 Claude CLI generation',
  brief: 'Explain how evidence changes the story.',
  language: 'en' as const,
  referencesText: '[1] The river changed at dawn.',
  scriptPresetId: 'documentary' as const,
  targetDurationSec: 8,
  chapterCount: 2,
  voiceId: null,
  aiProvider: 'deepseek' as const,
  aiModel: 'deepseek-flash',
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};
const words = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(' ');
const outline = JSON.stringify({
  chapters: [
    { no: 1, title: 'Opening', role: 'hook', beat: 'Reveal the first clue', targetWords: 10, endsOnTension: true },
    { no: 2, title: 'Answer', role: 'resolution', beat: 'Resolve the question', targetWords: 10, endsOnTension: false },
  ],
  openLoops: [{ question: 'What changed?', plantedInChapter: 1, resolvedInChapter: 2 }],
  coreQuestion: 'What changed?',
  openingHook: 'The river moved at dawn.',
});
const expansion = (paragraph: string) => JSON.stringify({
  paragraphs: [paragraph],
  styleNote: 'Continue the evidence-led narration.',
  chapterSummary: 'Evidence advances the story.',
  avoidRepeating: ['the opening clue'],
  persistentFactsNext: ['the river changed at dawn'],
});
const config = (filesDir: string) => ({
  CLAUDE_CLI_PATH: process.execPath,
  CLAUDE_CLI_TIMEOUT_MS: 3_000,
  CLAUDE_CLI_MAX_OUTPUT_BYTES: 50_000,
  FILES_DIR: filesDir,
});

const tempRoots: string[] = [];
beforeAll(() => startTestMongo());
beforeEach(async () => { await getCollection('projects').deleteMany({}); });
afterAll(() => closeTestMongo());
afterEach(async () => { await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-tool-cli-generation-'));
  tempRoots.push(root);
  return root;
}

function context(overrides: Partial<Pick<ScriptGenerationJobContext, 'isCancelled'>> = {}) {
  const logs: string[] = [];
  return {
    reportProgress: vi.fn(async () => undefined),
    appendLog: vi.fn(async (message: string) => { logs.push(message); }),
    isCancelled: overrides.isCancelled ?? vi.fn(async () => false),
  } satisfies ScriptGenerationJobContext;
}

function sequenceSpawn(responsesPath: string, indexPath: string): ClaudeCliSpawn {
  return (_command: string, args: string[], options: SpawnOptions): ChildProcess => spawn(process.execPath, [fixture, ...args], {
    ...options,
    env: {
      ...(options.env ?? {}),
      FAKE_CLAUDE_MODE: 'sequence',
      FAKE_CLAUDE_RESPONSES: responsesPath,
      FAKE_CLAUDE_INDEX: indexPath,
    },
  }) as ChildProcess;
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try { await readFile(filePath); return; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  throw new Error('Fake Claude CLI did not start before timeout.');
}

describe('Claude CLI script generation backend', () => {
  it('runs the shared outline and chapter pipeline, retries parse/length failures, and reports audited call metrics', async () => {
    const root = await makeRoot();
    const responsePath = path.join(root, 'responses.json');
    const indexPath = path.join(root, 'index.txt');
    await writeFile(responsePath, JSON.stringify([
      `Here is the requested outline:\n${outline}`,
      'not JSON',
      expansion(words(9)),
      expansion('brief'),
      expansion(words(9)),
    ]));
    const project = await createProject(projectInput);
    const before = await getProject(project.id);
    const ctx = context();
    const backend = await createClaudeCliScriptBackend({
      projectId: project.id,
      model: 'claude-sonnet-5-5',
      config: config(root),
      context: ctx,
      getStatus: async () => ({ available: true, version: 'Claude Code 2.1.294', authPathLikely: 'subscription' }),
      spawnProcess: sequenceSpawn(responsePath, indexPath),
    });

    await generateScript(project.id, ctx, { backend });

    const saved = await getProject(project.id);
    expect(saved.chapters.map((chapter) => chapter.paragraphs)).toEqual([[words(9)], [words(9)]]);
    expect(saved).toMatchObject({ aiProvider: before.aiProvider, aiModel: before.aiModel });
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('Claude CLI preamble-before-JSON occurrences: 1'));
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('response had leading text before JSON at outline'));
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('Claude CLI call 1: outline; prompt'));
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('Claude CLI call 3: chapter-1-repair; prompt'));
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('Claude CLI call 5: chapter-2-length-retry-1; prompt'));

    const runsDirectory = path.join(root, project.id, 'cli-runs');
    const runDirectories = await readdir(runsDirectory);
    expect(runDirectories).toHaveLength(5);
    const runData = await Promise.all(runDirectories.map(async (directory) => ({
      metadata: JSON.parse(await readFile(path.join(runsDirectory, directory, 'meta.json'), 'utf8')) as Record<string, unknown>,
      prompt: await readFile(path.join(runsDirectory, directory, 'prompt.md')),
    })));
    expect(runData.map(({ metadata }) => metadata.stepLabel).sort()).toEqual(['chapter-1', 'chapter-1-repair', 'chapter-2', 'chapter-2-length-retry-1', 'outline']);
    for (const { metadata, prompt } of runData) expect(metadata.promptBytes).toBe(prompt.byteLength);
    const callLogs = ctx.appendLog.mock.calls.map(([message]) => message).filter((message) => message.startsWith('Claude CLI call '));
    expect(callLogs).toHaveLength(5);
    expect(callLogs.every((message) => /prompt \d+ bytes; \d+ ms; audit folder .+\./u.test(message))).toBe(true);
  });

  it('keeps old queued jobs in API mode and rejects unknown generation backends', () => {
    expect(ScriptJobPayloadSchema.parse({ projectId: 'project-1' })).toEqual({ projectId: 'project-1' });
    expect(ScriptJobPayloadSchema.safeParse({ projectId: 'project-1', backend: 'unknown' }).success).toBe(false);
  });

  it('kills an in-flight chapter CLI process and discards its response after cancellation', async () => {
    const root = await makeRoot();
    const responsePath = path.join(root, 'responses.json');
    const indexPath = path.join(root, 'index.txt');
    const startedPath = path.join(root, 'chapter-started.txt');
    await writeFile(responsePath, JSON.stringify([outline]));
    const project = await createProject(projectInput);
    let cancelled = false;
    let processCalls = 0;
    const ctx = context({ isCancelled: vi.fn(async () => cancelled) });
    const spawnProcess: ClaudeCliSpawn = (_command: string, args: string[], options: SpawnOptions): ChildProcess => {
      processCalls += 1;
      const generationEnv = processCalls === 1
        ? { FAKE_CLAUDE_MODE: 'sequence', FAKE_CLAUDE_RESPONSES: responsePath, FAKE_CLAUDE_INDEX: indexPath }
        : { FAKE_CLAUDE_MODE: 'hang', FAKE_CLAUDE_STARTED: startedPath };
      return spawn(process.execPath, [fixture, ...args], {
        ...options,
        env: { ...(options.env ?? {}), ...generationEnv },
      }) as ChildProcess;
    };
    const backend = await createClaudeCliScriptBackend({
      projectId: project.id,
      config: config(root),
      context: ctx,
      getStatus: async () => ({ available: true, authPathLikely: 'subscription' }),
      spawnProcess,
      killProcessTree: (child) => { child.kill('SIGKILL'); },
      pollIntervalMs: 10,
    });

    const generation = generateScript(project.id, ctx, { backend });
    await waitForFile(startedPath);
    cancelled = true;
    await generation;

    expect(processCalls).toBe(2);
    const saved = await getProject(project.id);
    expect(saved.chapters).toHaveLength(2);
    expect(saved.chapters.every((chapter) => chapter.paragraphs.length === 0)).toBe(true);
    const runsDirectory = path.join(root, project.id, 'cli-runs');
    const runDirectories = await readdir(runsDirectory);
    const chapterRun = await Promise.all(runDirectories.map(async (directory) => ({
      directory,
      metadata: JSON.parse(await readFile(path.join(runsDirectory, directory, 'meta.json'), 'utf8')) as Record<string, unknown>,
    }))).then((runs) => runs.find((run) => run.metadata.stepLabel === 'chapter-1'));
    expect(chapterRun?.metadata.cancelled).toBe(true);
    expect(await readFile(path.join(runsDirectory, chapterRun!.directory, 'output.txt'), 'utf8')).toBe('');
  });

  it.each([
    ['rate limit', '429 rate limit exceeded', 'CLAUDE_CLI_RATE_LIMITED'],
    ['authentication', 'Please run /login', 'CLAUDE_CLI_AUTH_FAILED'],
  ])('does not retry a CLI %s failure as a transient chapter error', async (_label, stderr, code) => {
    const root = await makeRoot();
    const project = await createProject(projectInput);
    const ctx = context();
    const outputPath = path.join(root, 'output.txt');
    await writeFile(outputPath, outline);
    const runCli = vi.fn(async (): Promise<ClaudeCliRunResult> => {
      const call = runCli.mock.calls.length;
      if (call === 1) return {
        runId: 'outline-run', runDirectory: root, displayPath: 'audit/outline', output: outline, stderr: '', exitCode: 0,
        durationMs: 1, outputBytes: Buffer.byteLength(outline), cancelled: false, timedOut: false, outputTooLarge: false, spawnError: null,
      };
      return {
        runId: 'failure-run', runDirectory: root, displayPath: 'audit/chapter', output: '', stderr, exitCode: 1,
        durationMs: 1, outputBytes: 0, cancelled: false, timedOut: false, outputTooLarge: false, spawnError: null,
      };
    });
    const backend = await createClaudeCliScriptBackend({
      projectId: project.id,
      config: config(root),
      context: ctx,
      getStatus: async () => ({ available: true, authPathLikely: 'subscription' }),
      runCli,
    });
    await expect(generateScript(project.id, ctx, { backend })).rejects.toMatchObject({ code });
    expect(runCli).toHaveBeenCalledTimes(2);
  });
});
