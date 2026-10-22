import { describe, expect, it, vi } from 'vitest';
import { createWorkerLoop } from './main';

const mocks = vi.hoisted(() => ({ generateScript: vi.fn(), generateVisualPrompts: vi.fn(), splitProjectScenes: vi.fn(), runFinalQa: vi.fn(), generateSeoPackage: vi.fn(), createClaudeCliChat: vi.fn(), loadConfig: vi.fn(), generateProjectVoiceovers: vi.fn(), alignProjectWordTimings: vi.fn(), autoAnalyzeProjectPopupsIfStale: vi.fn(), analyzeProjectPopups: vi.fn(), PopupAnalysisRequestSchema: { parse: (value: unknown) => value }, generateProjectSfx: vi.fn(), generateProjectDepthMaps: vi.fn(), generateSceneDepthMap: vi.fn(), renderFullProject: vi.fn(), loggerError: vi.fn() }));
vi.mock('../server/modules/script/service', () => ({ generateScript: mocks.generateScript }));
vi.mock('../server/modules/script/visual-prompts', () => ({ generateVisualPrompts: mocks.generateVisualPrompts }));
vi.mock('../server/modules/script/scene-split', () => ({ splitProjectScenes: mocks.splitProjectScenes }));
vi.mock('../server/modules/script/qa', () => ({ runFinalQa: mocks.runFinalQa }));
vi.mock('../server/modules/seo', () => ({ generateSeoPackage: mocks.generateSeoPackage }));
vi.mock('../server/shared/claude-cli/cli-chat', () => ({ createClaudeCliChat: mocks.createClaudeCliChat }));
vi.mock('../server/config', () => ({ loadConfig: mocks.loadConfig }));
vi.mock('../server/modules/video', () => ({ generateProjectVoiceovers: mocks.generateProjectVoiceovers, alignProjectWordTimings: mocks.alignProjectWordTimings, autoAnalyzeProjectPopupsIfStale: mocks.autoAnalyzeProjectPopupsIfStale, analyzeProjectPopups: mocks.analyzeProjectPopups, PopupAnalysisRequestSchema: mocks.PopupAnalysisRequestSchema, generateProjectSfx: mocks.generateProjectSfx, generateProjectDepthMaps: mocks.generateProjectDepthMaps, generateSceneDepthMap: mocks.generateSceneDepthMap, renderFullProject: mocks.renderFullProject }));
vi.mock('../server/shared/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.loggerError } }));
import { jobHandlers } from './registry';
import { AiRequestError } from '../server/shared/ai/errors';
import { SEO_SECTIONS } from '../contracts/seo';

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
  it('registers the Claude CLI chapter-regeneration handler explicitly', () => {
    expect(jobHandlers['regenerate-chapters-claude-cli']).toBeDefined();
  });

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
    expect(mocks.generateScript).toHaveBeenCalledWith('project-2', expect.objectContaining({ reportProgress: expect.any(Function), isCancelled, appendLog }), {});
  });

  it('rechecks CLI availability in the worker and injects its chat backend without project AI settings', async () => {
    const chat = vi.fn(async () => '{"titles":[]}');
    mocks.createClaudeCliChat.mockResolvedValue({ model: 'claude-sonnet-5-5', chat });
    mocks.loadConfig.mockReturnValue({ CLAUDE_CLI_PATH: 'claude', CLAUDE_CLI_TIMEOUT_MS: 10_000, CLAUDE_CLI_MAX_OUTPUT_BYTES: 4096, FILES_DIR: 'files' });
    const context = { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(false), appendLog: vi.fn() };

    await jobHandlers['generate-seo']!({
      _id: 'job-seo-cli', schemaVersion: 1, type: 'generate-seo', projectId: 'project-1',
      payload: { projectId: 'project-1', sections: ['titles'], backend: 'cli', cliModel: 'claude-sonnet-5-5' },
      status: 'running', attempts: 1, maxAttempts: 1, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: false, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, context);

    expect(mocks.createClaudeCliChat).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', model: 'claude-sonnet-5-5', chapterId: 'seo-generation', context }));
    expect(mocks.generateSeoPackage).toHaveBeenCalledWith('project-1', ['titles'], context, { kind: 'cli', model: 'claude-sonnet-5-5', chat });
  });

  it('forwards the optional resume flag to script generation', async () => {
    mocks.generateScript.mockReset().mockResolvedValue(undefined);
    const handler = jobHandlers['generate-script']!;
    await handler({
      _id: 'job-resume', schemaVersion: 1, type: 'generate-script', projectId: 'project-1', payload: { projectId: 'project-1', resume: true },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: false, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(false), appendLog: vi.fn() });
    expect(mocks.generateScript).toHaveBeenCalledWith('project-1', expect.objectContaining({ reportProgress: expect.any(Function) }), { resume: true });
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
    mocks.generateScript.mockRejectedValueOnce(new AiRequestError('DeepSeek', 'deepseek-chat', 502, 'Cannot reach api.deepseek.com (timeout/network) for model deepseek-chat.'));
    const handler = jobHandlers['generate-script']!;

    await expect(handler({
      _id: 'job-3', schemaVersion: 1, type: 'generate-script', projectId: 'project-1', payload: { projectId: 'project-1' },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: false, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(false), appendLog: vi.fn() })).rejects.toBeInstanceOf(AiRequestError);
    expect(mocks.loggerError).toHaveBeenCalledWith('AI request failed.', { provider: 'DeepSeek', status: 502, message: 'Cannot reach api.deepseek.com (timeout/network) for model deepseek-chat.' });
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

describe('SEO job registration', () => {
  it('registers generate-seo and forwards selected sections/context', async () => {
    mocks.generateSeoPackage.mockResolvedValue(undefined);
    const context = { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(false), appendLog: vi.fn() };
    const handler = jobHandlers['generate-seo'];
    expect(handler).toBeDefined();
    await handler!({
      _id: 'job-seo-1', schemaVersion: 1, type: 'generate-seo', projectId: 'project-1',
      payload: { projectId: 'project-2', sections: ['titles', 'tags'] }, status: 'running', attempts: 1, maxAttempts: 3,
      runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(), progress: 0, result: null, error: null,
      cancelRequested: false, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, context);
    expect(mocks.generateSeoPackage).toHaveBeenCalledWith('project-2', ['titles', 'tags'], context);
  });

  it('defaults SEO jobs to every shared section including Shorts', async () => {
    mocks.generateSeoPackage.mockReset().mockResolvedValue(undefined);
    const context = { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(false), appendLog: vi.fn() };
    await jobHandlers['generate-seo']!({
      _id: 'job-seo-default', schemaVersion: 1, type: 'generate-seo', projectId: 'project-1', payload: { projectId: 'project-1' }, status: 'running',
      attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(), progress: 0, result: null,
      error: null, cancelRequested: false, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, context);
    expect(mocks.generateSeoPackage).toHaveBeenCalledWith('project-1', [...SEO_SECTIONS], context);
  });

  it('does not start SEO generation when the job is already cancelled', async () => {
    mocks.generateSeoPackage.mockReset();
    await jobHandlers['generate-seo']!({
      _id: 'job-seo-2', schemaVersion: 1, type: 'generate-seo', projectId: 'project-1',
      payload: { projectId: 'project-1' }, status: 'running', attempts: 1, maxAttempts: 3,
      runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(), progress: 0, result: null, error: null,
      cancelRequested: true, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(true), appendLog: vi.fn() });
    expect(mocks.generateSeoPackage).not.toHaveBeenCalled();
  });
});

describe('video job registration', () => {
  it('runs only the new popup analysis after project word alignment completes', async () => {
    mocks.alignProjectWordTimings.mockResolvedValue({ aligned: 1, rejected: 0, failed: 0, stale: 0, skipped: 0 });
    mocks.autoAnalyzeProjectPopupsIfStale.mockResolvedValue(true);
    const context = { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(false), appendLog: vi.fn() };

    await jobHandlers['align-word-timings']!({
      _id: 'job-align-1', schemaVersion: 1, type: 'align-word-timings', projectId: 'project-1', payload: { projectId: 'project-2' },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: false, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, context);

    expect(mocks.alignProjectWordTimings).toHaveBeenCalledWith('project-2', context.appendLog, context.reportProgress, context.isCancelled);
    expect(mocks.autoAnalyzeProjectPopupsIfStale).toHaveBeenCalledWith('project-2', context.appendLog);
    expect(mocks.alignProjectWordTimings.mock.invocationCallOrder[0]).toBeLessThan(mocks.autoAnalyzeProjectPopupsIfStale.mock.invocationCallOrder[0]!);
  });

  it('registers analyze-popups and forwards backend, density, and CLI model', async () => {
    const analysisResult = { scenesExpected: 2, scenesApplied: 2, summary: { rejectedByValidation: 1 } };
    mocks.analyzeProjectPopups.mockResolvedValue(analysisResult);
    const context = { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(false), appendLog: vi.fn() };
    const result = await jobHandlers['analyze-popups']!({
      _id: 'job-popup-1', schemaVersion: 1, type: 'analyze-popups', projectId: 'project-1', payload: { projectId: 'project-2', backend: 'cli', density: 'high', cliModel: 'claude-haiku-4-5-20251001' },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(), progress: 0, result: null, error: null, cancelRequested: false, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, context);
    expect(result).toBe(analysisResult);
    expect(mocks.analyzeProjectPopups).toHaveBeenCalledWith('project-2', { backend: 'cli', density: 'high', cliModel: 'claude-haiku-4-5-20251001' }, context);
  });

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

    expect(mocks.generateProjectSfx).toHaveBeenCalledWith('project-2', appendLog, reportProgress, { onlyMissing: false });

    mocks.generateProjectSfx.mockClear();
    await handler!({
      _id: 'job-sfx-2', schemaVersion: 1, type: 'generate-all-sfx', projectId: 'project-1', payload: { projectId: 'project-1', onlyMissing: true },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: false, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, { reportProgress, isCancelled, appendLog });
    expect(mocks.generateProjectSfx).toHaveBeenCalledWith('project-1', appendLog, reportProgress, { onlyMissing: true });
  });

  it('does not start bulk SFX generation when the job is already cancelled', async () => {
    mocks.generateProjectSfx.mockReset();
    await jobHandlers['generate-all-sfx']!({
      _id: 'job-sfx-3', schemaVersion: 1, type: 'generate-all-sfx', projectId: 'project-1', payload: { projectId: 'project-1' },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: true, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(true), appendLog: vi.fn() });
    expect(mocks.generateProjectSfx).not.toHaveBeenCalled();
  });
});
