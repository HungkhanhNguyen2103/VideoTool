import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliRegenerateRequestSchema } from '../../../contracts/script';
import { getCollection } from '../../db/client';
import { errorHandler } from '../../error-handler';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createProject, getProject, getProjectHistory, replaceProjectChapters } from '../project';
import { buildRegenerationPromptForChapter, formatRegenerationPrompt } from './service';
import { createScriptCliStatusRouter, createScriptRouter } from './routes';
import { handleCliRegeneration, type ScriptCliJobContext } from './cli-regenerate-handler';
import type { ClaudeCliSpawn } from './cli-runner';

const fixture = fileURLToPath(new URL('./fixtures/fake-claude-cli.mjs', import.meta.url));
const projectInput = {
  title: 'Claude CLI regeneration test',
  brief: 'A project for checking chapter regeneration through a local command.',
  language: 'vi' as const,
  referencesText: '[1] The fleet left at dawn.',
  scriptPresetId: 'documentary' as const,
  targetDurationSec: 120,
  chapterCount: 3,
  voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};
const baseCliConfig = {
  CLAUDE_CLI_PATH: process.execPath,
  CLAUDE_CLI_TIMEOUT_MS: 5_000,
  CLAUDE_CLI_MAX_OUTPUT_BYTES: 250_000,
};

let server: Server | null = null;
const tempRoots: string[] = [];

beforeAll(() => startTestMongo());
beforeEach(async () => {
  await getCollection('projects').deleteMany({});
  await getCollection('jobs').deleteMany({});
});
afterAll(() => closeTestMongo());
afterEach(async () => {
  const current = server;
  server = null;
  if (current) await new Promise<void>((resolve) => current.close(() => resolve()));
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-tool-cli-handler-'));
  tempRoots.push(root);
  return root;
}

async function makeProject() {
  const project = await createProject(projectInput);
  await replaceProjectChapters(project.id, [
    { id: 'chapter-1', no: 1, title: 'Chapter One', paragraphs: ['Old first chapter.'], status: 'approved', scenesCount: null, durationSec: null, targetWords: 100 },
    { id: 'chapter-2', no: 2, title: 'Chapter Two', paragraphs: ['Old second chapter.'], status: 'approved', scenesCount: null, durationSec: null, targetWords: 100 },
    { id: 'chapter-3', no: 3, title: 'Chapter Three', paragraphs: ['Old third chapter.'], status: 'pending', scenesCount: null, durationSec: null, targetWords: 100 },
  ], null, 'script');
  return getProject(project.id);
}

function createContext(cancelled: () => boolean = () => false) {
  return {
    reportProgress: vi.fn(async () => undefined),
    isCancelled: vi.fn(async () => cancelled()),
    appendLog: vi.fn(async () => undefined),
  } satisfies ScriptCliJobContext;
}

async function scriptedCli(root: string, modes: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const captures = path.join(root, 'captures');
  await mkdir(captures, { recursive: true });
  let calls = 0;
  const spawnProcess: ClaudeCliSpawn = (_command: string, args: string[], options: SpawnOptions): ChildProcess => {
    if (args.includes('--version')) return spawn(process.execPath, [fixture, ...args], options);
    calls += 1;
    const capture = path.join(captures, `prompt-${calls}.txt`);
    const env = { ...options.env, ...extraEnv, FAKE_CLAUDE_MODE: modes[calls - 1] ?? 'valid', FAKE_CLAUDE_CAPTURE: capture };
    return spawn(process.execPath, [fixture, ...args], { ...options, env });
  };
  return { spawnProcess, captures, callCount: () => calls };
}

async function startRouterServer(projectId: string, enqueueJob = vi.fn(async () => ({ id: 'job-1' }))) {
  const app = express();
  app.use(express.json());
  app.use('/api/project', createScriptRouter({
    enqueueJob,
    getClaudeCliStatus: async () => ({ available: true, version: 'Claude Code 2.1.294', authPathLikely: 'subscription' }),
  }));
  app.use('/api/script', createScriptCliStatusRouter(async () => ({ available: true, version: 'Claude Code 2.1.294', authPathLikely: 'subscription' })));
  app.use(errorHandler);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  return { baseUrl: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, enqueueJob, projectId };
}

describe('Claude CLI regeneration request contract and route', () => {
  it('accepts only chapter batches with unique IDs and a registered Claude model', () => {
    expect(CliRegenerateRequestSchema.safeParse({ chapterIds: ['c1', 'c2'], instruction: 'Tighten it', level: 'light', model: 'claude-sonnet-5-5' }).success).toBe(true);
    expect(CliRegenerateRequestSchema.safeParse({ chapterIds: ['c1', 'c1'], instruction: '', level: 'medium' }).success).toBe(false);
    expect(CliRegenerateRequestSchema.safeParse({ chapterIds: ['c1'], instruction: '', level: 'medium', model: 'deepseek-chat' }).success).toBe(false);
  });

  it('returns CLI availability and queues selected chapters in script order with one job attempt', async () => {
    const project = await makeProject();
    const { baseUrl, enqueueJob } = await startRouterServer(project.id);
    const status = await fetch(`${baseUrl}/api/script/cli-status`);
    const body = await status.json();
    const queued = await fetch(`${baseUrl}/api/project/${project.id}/chapters/regenerate/cli`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chapterIds: ['chapter-3', 'chapter-1'], instruction: 'Keep the citations', level: 'rewrite', model: 'claude-opus-5-5' }),
    });

    expect(status.status).toBe(200);
    expect(body).toEqual({ available: true, version: 'Claude Code 2.1.294', authPathLikely: 'subscription' });
    expect(queued.status).toBe(201);
    expect(await queued.json()).toEqual({ jobId: 'job-1' });
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      type: 'regenerate-chapters-claude-cli',
      projectId: project.id,
      maxAttempts: 1,
      payload: expect.objectContaining({ chapterIds: ['chapter-1', 'chapter-3'], instruction: 'Keep the citations', level: 'rewrite', model: 'claude-opus-5-5' }),
    }));
  });
});

describe('handleCliRegeneration', () => {
  it('sends the byte-identical manual prompt and imports through the shared parser/apply path', async () => {
    const root = await makeRoot();
    const project = await makeProject();
    const cli = await scriptedCli(root, ['valid']);
    const context = createContext();
    const instruction = 'Preserve the source citations.';
    const manualRouter = await startRouterServer(project.id);
    const manualResponse = await fetch(`${manualRouter.baseUrl}/api/project/${project.id}/chapters/chapter-2/regenerate/manual-prompt`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instruction, level: 'medium' }),
    });
    const manualPrompt = (await manualResponse.json() as { prompt: string }).prompt;

    const result = await handleCliRegeneration({ payload: {
      projectId: project.id, chapterIds: ['chapter-2'], instruction, level: 'medium', historyBatchId: 'b7ca3c8e-49d3-449b-984f-224b9d55bd84',
    } }, context, {
      config: { ...baseCliConfig, FILES_DIR: root },
      env: { ...process.env, FAKE_CLAUDE_MODE: 'valid' },
      spawnProcess: cli.spawnProcess,
    });

    const savedPrompt = await readFile(path.join(cli.captures, 'prompt-1.txt'), 'utf8');
    const savedProject = await getProject(project.id);
    const history = await getProjectHistory(project.id);
    expect(manualResponse.status).toBe(200);
    expect(savedPrompt).toBe(manualPrompt);
    expect(savedPrompt).toBe(formatRegenerationPrompt(buildRegenerationPromptForChapter(project, 'chapter-2', { instruction, level: 'medium' }).prompt));
    expect(savedProject.chapters[1]).toMatchObject({ paragraphs: ['A response.'], status: 'pending', chapterSummary: 'Summary', reviewStatus: 'clean' });
    expect(savedProject.chapters[2]?.reviewStatus).toBe('upstream-changed');
    expect(history).toHaveLength(1);
    expect(history[0]?.historyBatchId).toBe('b7ca3c8e-49d3-449b-984f-224b9d55bd84');
    expect(result).toMatchObject({ updatedChapterIds: ['chapter-2'], runDirectories: [expect.stringContaining('/cli-runs/')], quality: { totalWords: 8 } });
    expect(context.appendLog.mock.calls.join('\n')).toContain('cli-runs');
    expect(context.reportProgress).toHaveBeenLastCalledWith(100, expect.objectContaining({ updatedChapterIds: ['chapter-2'] }));
  });

  it('runs batch chapters in order and stops after one malformed-JSON retry fails', async () => {
    const root = await makeRoot();
    const project = await makeProject();
    const cli = await scriptedCli(root, ['valid', 'garbage', 'garbage', 'valid']);
    const context = createContext();
    await expect(handleCliRegeneration({ payload: {
      projectId: project.id, chapterIds: ['chapter-3', 'chapter-2', 'chapter-1'], instruction: '', level: 'medium', historyBatchId: 'd75d02a2-93fc-45d0-9d09-f26563b2584f',
    } }, context, {
      config: { ...baseCliConfig, FILES_DIR: root }, env: { ...process.env }, spawnProcess: cli.spawnProcess,
    })).rejects.toMatchObject({ message: expect.stringContaining('JSON của chương không hợp lệ') });

    const saved = await getProject(project.id);
    expect(cli.callCount()).toBe(3);
    expect((await readFile(path.join(cli.captures, 'prompt-1.txt'), 'utf8'))).toContain('Chapter 1: Chapter One');
    expect((await readFile(path.join(cli.captures, 'prompt-2.txt'), 'utf8'))).toContain('Chapter 2: Chapter Two');
    expect((await readFile(path.join(cli.captures, 'prompt-3.txt'), 'utf8'))).toContain('Chapter 2: Chapter Two');
    expect(saved.chapters[0]?.paragraphs).toEqual(['A response.']);
    expect(saved.chapters[1]).toMatchObject({ paragraphs: ['Old second chapter.'], status: 'needs-fix' });
    expect(saved.chapters[2]?.paragraphs).toEqual(['Old third chapter.']);
    expect(await getProjectHistory(project.id)).toHaveLength(1);
  });

  it('does not retry an authentication/rate-limit CLI failure and marks the chapter needs-fix', async () => {
    const root = await makeRoot();
    const project = await makeProject();
    const cli = await scriptedCli(root, ['rate-limit', 'valid']);
    const context = createContext();
    await expect(handleCliRegeneration({ payload: {
      projectId: project.id, chapterIds: ['chapter-1', 'chapter-2'], instruction: '', level: 'medium',
    } }, context, {
      config: { ...baseCliConfig, FILES_DIR: root }, env: { ...process.env }, spawnProcess: cli.spawnProcess,
    })).rejects.toMatchObject({ message: expect.stringMatching(/đăng nhập|giới hạn tốc độ/i) });
    expect(cli.callCount()).toBe(1);
    expect((await getProject(project.id)).chapters[0]?.status).toBe('needs-fix');
    expect((await getProject(project.id)).chapters[1]?.paragraphs).toEqual(['Old second chapter.']);
  });

  it('kills the in-flight process on cancellation without applying that chapter', async () => {
    const root = await makeRoot();
    const project = await makeProject();
    const before = await getProject(project.id);
    const started = path.join(root, 'started');
    const cli = await scriptedCli(root, ['hang'], { FAKE_CLAUDE_STARTED: started });
    let cancelled = false;
    const context = createContext(() => cancelled);
    const promise = handleCliRegeneration({ payload: {
      projectId: project.id, chapterIds: ['chapter-1'], instruction: '', level: 'medium',
    } }, context, {
      config: { ...baseCliConfig, FILES_DIR: root }, env: { ...process.env }, spawnProcess: cli.spawnProcess,
      killProcessTree: (child) => child.kill('SIGKILL'), cancellationPollMs: 10,
    });
    await waitForFile(started);
    cancelled = true;
    const result = await promise;
    expect(result).toMatchObject({ cancelled: true, updatedChapterIds: [] });
    expect(await getProject(project.id)).toEqual(before);
    expect(await getProjectHistory(project.id)).toEqual([]);
  });
});

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try { await readFile(filePath); return; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  throw new Error('Fake CLI did not start before timeout.');
}
