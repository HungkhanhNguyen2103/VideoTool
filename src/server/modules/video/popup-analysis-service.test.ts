import { describe, expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../../../contracts/project';
import type { AiClient } from '../../shared/ai';
import type { ClaudeCliRunResult, ClaudeCliStatus } from '../../shared/claude-cli/cli-runner';
import {
  analyzeProjectPopups,
  buildPopupAnalysisChunks,
  type PopupAnalysisContext,
  type PopupAnalysisDependencies,
} from './popup-analysis-service';

function projectFixture(): ProjectDetail {
  const words = [
    { text: 'Ba', startSec: 0, endSec: 0.2 },
    { text: 'nghìn', startSec: 0.2, endSec: 0.4 },
    { text: 'người.', startSec: 0.4, endSec: 0.6 },
    { text: 'xong', startSec: 4, endSec: 5 },
  ];
  return {
    id: 'project-1', title: 'Dự án', language: 'vi', brief: 'Brief', referencesText: 'Nguồn',
    targetDurationSec: 10, chapterCount: 1, status: 'assets', scriptPresetId: 'documentary', visualStylePresetId: 'cinematic',
    voiceId: 'voice', aiProvider: 'deepseek', aiModel: 'deepseek-chat', renderEngine: 'ffmpeg', keywordPopupsEnabled: true,
    popupDensity: 'low', transitionStyle: 'varied', filmLook: 'auto', parallax: 'off', voiceoverVoice: 'Truc Ly', voiceSpeed: 1,
    sceneTailSec: 0.2, sfxVolume: 0.5, renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 },
    renderFileId: null, draftRenderFileId: null, bgmMood: '', bgmFileId: null, logoFileId: null, customStyleReferenceFileId: null,
    seo: {} as ProjectDetail['seo'], scenes: [{
      id: 'scene-1', narration: 'Ba nghìn người.', visualPrompt: '', durationSec: 5, assetType: 'image', assetFileId: 'asset-1',
      audioFileId: 'voice-1', voiceoverDurationSec: 5, voiceoverInput: null, wordTimings: { audioFileId: 'voice-1', words },
      nameCandidates: null, popupPlan: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null, videoKeyframeFileId: null,
      videoTailFileId: null, videoDurationSec: null, depthMap: null,
    }], chapters: [], openLoops: [], motif: null, coreQuestion: '', openingHook: '', version: 1,
    createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z',
  } as unknown as ProjectDetail;
}

function twoSceneProjectFixture(): ProjectDetail {
  const project = projectFixture();
  const first = project.scenes[0]!;
  const second = {
    ...first,
    id: 'scene-2',
    audioFileId: 'voice-2',
    wordTimings: first.wordTimings ? { ...first.wordTimings, audioFileId: 'voice-2' } : null,
  };
  return { ...project, scenes: [first, second] };
}

function context(overrides: Partial<PopupAnalysisContext> = {}): PopupAnalysisContext {
  return {
    reportProgress: vi.fn().mockResolvedValue(undefined),
    isCancelled: vi.fn().mockResolvedValue(false),
    appendLog: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function apiOutput(scene = 1): string {
  return JSON.stringify({ scenes: [{ scene, needed: true, reason: 'Cần biết quy mô.', popups: [{ scene, kind: 'number', anchor: 'Ba nghìn người', display: '3.000 quân', importance: 5, reason: 'Cho biết quy mô lực lượng.' }] }] });
}

function runResult(output: string): ClaudeCliRunResult {
  return { runId: 'run-1', runDirectory: 'data/files/project-1/cli-runs/run-1', displayPath: 'data/files/project-1/cli-runs/run-1', output, stderr: '', exitCode: 0, durationMs: 12, outputBytes: Buffer.byteLength(output), cancelled: false, timedOut: false, outputTooLarge: false, spawnError: null };
}

describe('project popup analysis service', () => {
  it('retries malformed JSON once, then applies every eligible scene through the guarded writer', async () => {
    const project = projectFixture();
    const chat = vi.fn().mockResolvedValueOnce('{bad json').mockResolvedValueOnce(apiOutput());
    const applied: unknown[] = [];
    const dependencies: PopupAnalysisDependencies = {
      getProject: vi.fn().mockResolvedValue(project),
      getAiClient: vi.fn().mockReturnValue({ model: 'deepseek-chat', chat } as unknown as AiClient),
      setProjectScenePopupPlans: vi.fn(async (_id, updates) => { applied.push(updates); return updates.length; }),
      now: () => new Date('2026-10-13T00:00:00.000Z'),
    };

    const result = await analyzeProjectPopups('project-1', { backend: 'api', density: 'low' }, context(), dependencies);

    expect(chat).toHaveBeenCalledTimes(2);
    expect(applied).toHaveLength(1);
    expect((applied[0] as Array<{ sceneId: string }>)[0]?.sceneId).toBe('scene-1');
    expect(result.scenesExpected).toBe(1);
    expect(result.scenesApplied).toBe(1);
    expect(result.summary.scenesNeeded).toBe(1);
  });

  it('rejects missing scene verdicts without changing the previous plan', async () => {
    const project = projectFixture();
    const setPlans = vi.fn();
    const chat = vi.fn().mockResolvedValue('{"scenes":[]}');
    const dependencies: PopupAnalysisDependencies = {
      getProject: vi.fn().mockResolvedValue(project),
      getAiClient: vi.fn().mockReturnValue({ model: 'deepseek-chat', chat } as unknown as AiClient),
      setProjectScenePopupPlans: setPlans,
    };

    await expect(analyzeProjectPopups('project-1', { backend: 'api', density: 'low' }, context(), dependencies)).rejects.toMatchObject({ code: 'POPUP_ANALYSIS_INVALID_RESPONSE', status: 422 });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1]?.[0]?.[1]?.content).toContain('Lần trước JSON sai vì:');
    expect(setPlans).not.toHaveBeenCalled();
  });

  it('keeps the previous plans when an API chunk fails after an earlier chunk succeeded', async () => {
    const project = twoSceneProjectFixture();
    const chat = vi.fn()
      .mockResolvedValueOnce(apiOutput(1))
      .mockResolvedValueOnce('{bad json')
      .mockResolvedValueOnce('{still bad json');
    const setPlans = vi.fn();
    const dependencies: PopupAnalysisDependencies = {
      getProject: vi.fn().mockResolvedValue(project),
      getAiClient: vi.fn().mockReturnValue({ model: 'deepseek-chat', chat } as unknown as AiClient),
      setProjectScenePopupPlans: setPlans,
      maxPromptBytes: 1,
    };

    await expect(analyzeProjectPopups('project-1', { backend: 'api', density: 'low' }, context(), dependencies)).rejects.toMatchObject({ code: 'POPUP_ANALYSIS_INVALID_RESPONSE', status: 422 });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(setPlans).not.toHaveBeenCalled();
  });

  it('uses the shared CLI runner, records audit folders, and keeps the CLI model local to the run', async () => {
    const project = projectFixture();
    const appendLog = vi.fn().mockResolvedValue(undefined);
    const status: ClaudeCliStatus = { available: true, version: 'Claude Code 2.1.294', authPathLikely: 'subscription' };
    const runCli = vi.fn().mockResolvedValue(runResult(apiOutput()));
    const dependencies: PopupAnalysisDependencies = {
      getProject: vi.fn().mockResolvedValue(project),
      getClaudeCliStatus: vi.fn().mockResolvedValue(status),
      runCli,
      config: { CLAUDE_CLI_PATH: 'claude', CLAUDE_CLI_TIMEOUT_MS: 5_000, CLAUDE_CLI_MAX_OUTPUT_BYTES: 20_000, FILES_DIR: './data/files' },
      setProjectScenePopupPlans: vi.fn().mockResolvedValue(1),
    };

    const result = await analyzeProjectPopups('project-1', { backend: 'cli', cliModel: 'claude-haiku-4-5-20251001', density: 'medium' }, context({ appendLog }), dependencies);

    expect(runCli).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', chapterId: 'popup-analysis', model: 'claude-haiku-4-5-20251001' }));
    expect(result.runDirectories).toEqual(['data/files/project-1/cli-runs/run-1']);
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('audit folder data/files/project-1/cli-runs/run-1'));
  });

  it('keeps the previous plans when a CLI chunk fails after an earlier chunk succeeded', async () => {
    const project = twoSceneProjectFixture();
    const status: ClaudeCliStatus = { available: true, version: 'Claude Code 2.1.294', authPathLikely: 'subscription' };
    const runCli = vi.fn()
      .mockResolvedValueOnce(runResult(apiOutput(1)))
      .mockResolvedValueOnce(runResult('{bad json'))
      .mockResolvedValueOnce(runResult('{still bad json'));
    const setPlans = vi.fn();
    const dependencies: PopupAnalysisDependencies = {
      getProject: vi.fn().mockResolvedValue(project),
      getClaudeCliStatus: vi.fn().mockResolvedValue(status),
      runCli,
      config: { CLAUDE_CLI_PATH: 'claude', CLAUDE_CLI_TIMEOUT_MS: 5_000, CLAUDE_CLI_MAX_OUTPUT_BYTES: 20_000, FILES_DIR: './data/files' },
      setProjectScenePopupPlans: setPlans,
      maxPromptBytes: 1,
    };

    await expect(analyzeProjectPopups('project-1', { backend: 'cli', cliModel: 'claude-haiku-4-5-20251001', density: 'low' }, context(), dependencies)).rejects.toMatchObject({ code: 'POPUP_ANALYSIS_INVALID_RESPONSE', status: 422 });
    expect(runCli).toHaveBeenCalledTimes(3);
    expect(runCli.mock.calls[2]?.[0]?.promptText).toContain('Lần trước JSON sai vì:');
    expect(setPlans).not.toHaveBeenCalled();
  });

  it('does not write after cooperative cancellation', async () => {
    const project = projectFixture();
    const setPlans = vi.fn();
    const dependencies: PopupAnalysisDependencies = {
      getProject: vi.fn().mockResolvedValue(project),
      getAiClient: vi.fn().mockReturnValue({ model: 'deepseek-chat', chat: vi.fn().mockResolvedValue(apiOutput()) } as unknown as AiClient),
      setProjectScenePopupPlans: setPlans,
    };
    const jobContext = context({ isCancelled: vi.fn().mockResolvedValue(true) });

    const result = await analyzeProjectPopups('project-1', { backend: 'api', density: 'low' }, jobContext, dependencies);

    expect(result.cancelled).toBe(true);
    expect(setPlans).not.toHaveBeenCalled();
  });

  it('uses primary scenes once while allowing one-scene context overlap in each measured chunk', () => {
    const project = projectFixture();
    const scenes = [1, 2, 3, 4].map((scene) => ({
      sceneNo: scene, sceneId: `scene-${scene}`, sceneStartSec: scene * 5, narration: 'Một đoạn dẫn dài để đo kích thước prompt.',
    }));
    const chunks = buildPopupAnalysisChunks(project, scenes, 'low', 300);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((chunk) => chunk.primarySceneNumbers)).toEqual([1, 2, 3, 4]);
    expect(chunks[1]?.prompt).toContain('Scene 1');
  });
});
