import { describe, expect, it, vi } from 'vitest';
import { createWorkerLoop } from './main';

const mocks = vi.hoisted(() => ({ generateScript: vi.fn(), generateVisualPrompts: vi.fn(), splitProjectScenes: vi.fn(), runFinalQa: vi.fn(), generateProjectVoiceovers: vi.fn(), generateProjectSfx: vi.fn(), generateProjectDepthMaps: vi.fn(), generateSceneDepthMap: vi.fn(), renderFullProject: vi.fn(), loggerError: vi.fn() }));
vi.mock('../server/modules/script/service', () => ({ generateScript: mocks.generateScript }));
vi.mock('../server/modules/script/visual-prompts', () => ({ generateVisualPrompts: mocks.generateVisualPrompts }));
vi.mock('../server/modules/script/scene-split', () => ({ splitProjectScenes: mocks.splitProjectScenes }));
vi.mock('../server/modules/script/qa', () => ({ runFinalQa: mocks.runFinalQa }));
vi.mock('../server/modules/video', () => ({ generateProjectVoiceovers: mocks.generateProjectVoiceovers, generateProjectSfx: mocks.generateProjectSfx, generateProjectDepthMaps: mocks.generateProjectDepthMaps, generateSceneDepthMap: mocks.generateSceneDepthMap, renderFullProject: mocks.renderFullProject }));
vi.mock('../server/shared/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.loggerError } }));
import { jobHandlers } from './registry';
import { AiRequestError } from '../server/shared/ai/errors';

describe('worker poll loop', () => {
  it('recovers each tick and drains until no job remains', async () => {
    let claims = 0;
    let recoveries = 0;
    const loop = createWorkerLoop({
      workerId: 'test-worker',
      handlers: {},
      recover: async () => { recoveries += 1; },
      claimAndRun: async () => { claims += 1; return claims < 3; },
    });
    await loop.tick();
    expect({ claims, recoveries }).toEqual({ claims: 3, recoveries: 1 });
  });

  it('does not overlap ticks', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let maxActive = 0;
    const loop = createWorkerLoop({
      workerId: 'test-worker',
      handlers: {},
      recover: async () => undefined,
      claimAndRun: async () => { active += 1; maxActive = Math.max(maxActive, active); await blocked; active -= 1; return false; },
    });
    const first = loop.tick();
    const second = loop.tick();
    release();
    await Promise.all([first, second]);
    expect(maxActive).toBe(1);
  });

  it('checks closing between claims in one drain tick', async () => {
    let claims = 0;
    const loop = createWorkerLoop({
      workerId: 'test-worker',
      handlers: {},
      recover: async () => undefined,
      claimAndRun: async () => { claims += 1; if (claims === 1) loop.stop(); return true; },
    });
    await loop.tick();
    expect(claims).toBe(1);
  });
});

describe('script job registration', () => {
  it('registers generate-script and maps payload/context to the service', async () => {
    mocks.generateScript.mockResolvedValue(undefined);
    const appendLog = vi.fn();
    const isCancelled = vi.fn().mockResolvedValue(false);
    const handler = jobHandlers['generate-script'];
    expect(handler).toBeDefined();
    await handler!({
      _id: 'job-1', schemaVersion: 1, type: 'generate-script', projectId: 'project-1', payload: { projectId: 'project-2' },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: false, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, { reportProgress: vi.fn(), isCancelled, appendLog });
    expect(mocks.generateScript).toHaveBeenCalledWith('project-2', expect.objectContaining({ reportProgress: expect.any(Function), isCancelled, appendLog }));
  });

  it('does not start generation when the job is already cancelled', async () => {
    mocks.generateScript.mockReset();
    const handler = jobHandlers['generate-script']!;
    await handler({
      _id: 'job-2', schemaVersion: 1, type: 'generate-script', projectId: 'project-1', payload: { projectId: 'project-1' },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: true, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(true), appendLog: vi.fn() });
    expect(mocks.generateScript).not.toHaveBeenCalled();
  });

  it('logs provider, status, and readable message when script AI fails', async () => {
    mocks.generateScript.mockRejectedValueOnce(new AiRequestError('DeepSeek', 502, 'Cannot reach api.deepseek.com (timeout/network).'));
    const handler = jobHandlers['generate-script']!;

    await expect(handler({
      _id: 'job-3', schemaVersion: 1, type: 'generate-script', projectId: 'project-1', payload: { projectId: 'project-1' },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: false, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(false), appendLog: vi.fn() })).rejects.toBeInstanceOf(AiRequestError);
    expect(mocks.loggerError).toHaveBeenCalledWith('AI request failed.', { provider: 'DeepSeek', status: 502, message: 'Cannot reach api.deepseek.com (timeout/network).' });
  });

  it('registers visual-prompt generation and maps its payload/context', async () => {
    mocks.generateVisualPrompts.mockResolvedValue({ updatedScenes: 1, skippedScenes: 0, failedChapters: [] });
    const appendLog = vi.fn();
    const isCancelled = vi.fn().mockResolvedValue(false);
    const reportProgress = vi.fn();
    const handler = jobHandlers['generate-visual-prompts'];
    expect(handler).toBeDefined();
    await handler!({
      _id: 'job-visual-1', schemaVersion: 1, type: 'generate-visual-prompts', projectId: 'project-1',
      payload: { projectId: 'project-2' }, status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(),
      lockedBy: 'worker', lockedAt: new Date(), progress: 0, result: null, error: null, cancelRequested: false,
      logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, { reportProgress, isCancelled, appendLog });
    expect(mocks.generateVisualPrompts).toHaveBeenCalledWith('project-2', expect.objectContaining({ reportProgress, isCancelled, appendLog }));
  });

  it('does not start visual-prompt generation when the job is already cancelled', async () => {
    mocks.generateVisualPrompts.mockReset();
    const handler = jobHandlers['generate-visual-prompts']!;
    await handler({
      _id: 'job-visual-2', schemaVersion: 1, type: 'generate-visual-prompts', projectId: 'project-1',
      payload: { projectId: 'project-1' }, status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(),
      lockedBy: 'worker', lockedAt: new Date(), progress: 0, result: null, error: null, cancelRequested: true,
      logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(true), appendLog: vi.fn() });
    expect(mocks.generateVisualPrompts).not.toHaveBeenCalled();
  });

  it('registers scene splitting and maps its payload/context', async () => {
    mocks.splitProjectScenes.mockResolvedValue({ splitScenes: 1, skippedChapters: 0, failedChapters: [] });
    const context = { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(false), appendLog: vi.fn() };
    const handler = jobHandlers['split-scenes'];
    expect(handler).toBeDefined();
    await handler!({
      _id: 'job-split-1', schemaVersion: 1, type: 'split-scenes', projectId: 'project-1', payload: { projectId: 'project-2' },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: false, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, context);
    expect(mocks.splitProjectScenes).toHaveBeenCalledWith('project-2', expect.objectContaining(context));
  });

  it('does not start scene splitting when the job is already cancelled', async () => {
    mocks.splitProjectScenes.mockReset();
    await jobHandlers['split-scenes']!({
      _id: 'job-split-2', schemaVersion: 1, type: 'split-scenes', projectId: 'project-1', payload: { projectId: 'project-1' },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: true, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(true), appendLog: vi.fn() });
    expect(mocks.splitProjectScenes).not.toHaveBeenCalled();
  });

  it('registers final QA and maps its payload/context', async () => {
    mocks.runFinalQa.mockResolvedValue({ issues: [] });
    const context = { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(false), appendLog: vi.fn() };
    const handler = jobHandlers['final-qa'];
    expect(handler).toBeDefined();
    await handler!({
      _id: 'job-qa-1', schemaVersion: 1, type: 'final-qa', projectId: 'project-1', payload: { projectId: 'project-2' },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: false, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, context);
    expect(mocks.runFinalQa).toHaveBeenCalledWith('project-2', expect.objectContaining(context));
  });

  it('does not start final QA when the job is already cancelled', async () => {
    mocks.runFinalQa.mockReset();
    await jobHandlers['final-qa']!({
      _id: 'job-qa-2', schemaVersion: 1, type: 'final-qa', projectId: 'project-1', payload: { projectId: 'project-1' },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: true, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(true), appendLog: vi.fn() });
    expect(mocks.runFinalQa).not.toHaveBeenCalled();
  });
});

describe('video job registration', () => {
  it('registers generate-all-sfx and forwards reportProgress through the worker context', async () => {
    mocks.generateProjectSfx.mockResolvedValue(undefined);
    const appendLog = vi.fn();
    const isCancelled = vi.fn().mockResolvedValue(false);
    const reportProgress = vi.fn();
    const handler = jobHandlers['generate-all-sfx'];
    expect(handler).toBeDefined();

    await handler!({
      _id: 'job-sfx-1', schemaVersion: 1, type: 'generate-all-sfx', projectId: 'project-1', payload: { projectId: 'project-2' },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: false, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, { reportProgress, isCancelled, appendLog });

    expect(mocks.generateProjectSfx).toHaveBeenCalledWith('project-2', appendLog, reportProgress);
  });

  it('does not start bulk SFX generation when the job is already cancelled', async () => {
    mocks.generateProjectSfx.mockReset();
    await jobHandlers['generate-all-sfx']!({
      _id: 'job-sfx-2', schemaVersion: 1, type: 'generate-all-sfx', projectId: 'project-1', payload: { projectId: 'project-1' },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: true, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(true), appendLog: vi.fn() });
    expect(mocks.generateProjectSfx).not.toHaveBeenCalled();
  });
});
