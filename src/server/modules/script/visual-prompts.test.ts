import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createProject, getProject, patchProjectScene, replaceProjectChapters, replaceProjectScenes } from '../project';
import { generateVisualPrompts } from './visual-prompts';

const aiMock = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock('../../shared/ai', () => ({ getAiClient: vi.fn(() => aiMock) }));

const projectInput = {
  title: 'Visual scenes', brief: 'An illustrated account of three scenes.', language: 'en' as const,
  referencesText: '', scriptPresetId: 'documentary' as const, targetDurationSec: 60,
  chapterCount: 2, voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

beforeAll(() => startTestMongo());
beforeEach(async () => {
  await getCollection('projects').deleteMany({});
  aiMock.chat.mockReset();
});
afterAll(() => closeTestMongo());

async function projectWithScenes(prompts = ['', 'Manual second', '']) {
  const project = await createProject(projectInput);
  await replaceProjectChapters(project.id, [
    { id: 'chapter-1', no: 1, title: 'First', paragraphs: ['One', 'Two'], status: 'approved', scenesCount: 2, durationSec: 40 },
    { id: 'chapter-2', no: 2, title: 'Second', paragraphs: ['Three'], status: 'approved', scenesCount: 1, durationSec: 20 },
  ], null);
  await replaceProjectScenes(project.id, ['One', 'Two', 'Three'].map((narration, index) => ({
    id: `scene-${index + 1}`, narration, visualPrompt: prompts[index]!, durationSec: 20,
    assetType: 'image' as const, assetFileId: null, audioFileId: null, sfxPrompt: '', sfxFileId: null,
  })), 'assets');
  return getProject(project.id);
}

function context(cancelled: () => boolean = () => false) {
  const progress: number[] = [];
  const logs: string[] = [];
  return {
    progress, logs,
    reportProgress: async (percent: number) => { progress.push(percent); },
    appendLog: async (message: string) => { logs.push(message); },
    isCancelled: async () => cancelled(),
  };
}

function batch(indexes: number[], styleNote: string) {
  return JSON.stringify({ styleNote, prompts: indexes.map((sceneIndex) => ({ sceneIndex, visualPrompt: `Generated ${sceneIndex}` })) });
}

describe('generateVisualPrompts', () => {
  it('sends complete global-index chapters, preserves manual prompts, and carries the prior style note', async () => {
    const project = await projectWithScenes();
    aiMock.chat.mockResolvedValueOnce(batch([1, 2], 'Muted archival palette')).mockResolvedValueOnce(batch([3], 'Final style'));
    const job = context();

    const result = await generateVisualPrompts(project.id, job);

    expect(result).toEqual({ updatedScenes: 2, skippedScenes: 1, failedChapters: [] });
    expect((await getProject(project.id)).scenes.map((scene) => scene.visualPrompt)).toEqual(['Generated 1', 'Manual second', 'Generated 3']);
    expect(job.progress).toEqual([50, 100]);
    const first = aiMock.chat.mock.calls[0]![0][1].content as string;
    const second = aiMock.chat.mock.calls[1]![0][1].content as string;
    expect(first).toContain('This chapter contains exactly 2 scenes. Return exactly 2 prompt objects, one for every supplied sceneIndex. Echo each supplied sceneIndex exactly; do not invent, omit, duplicate, or renumber indexes.');
    expect(first).toContain('Scene 1\nNarration: One');
    expect(first).toContain('Scene 2\nNarration: Two\nExisting visual prompt: Manual second');
    expect(first).not.toContain('scene-1');
    expect(second).toContain('Scene 3\nNarration: Three');
    expect(second).toContain('Previous style note: Muted archival palette');
  });

  it.each([
    ['missing', [1]], ['duplicate', [1, 1]], ['extra', [1, 2, 3]], ['out of range', [1, 99]],
  ])('retries a %s index batch once and leaves that chapter untouched when retry is invalid', async (_name, indexes) => {
    const project = await projectWithScenes(['', '', '']);
    aiMock.chat.mockResolvedValueOnce(batch(indexes, 'bad')).mockResolvedValueOnce(batch(indexes, 'still bad'))
      .mockResolvedValueOnce(batch([3], 'good'));
    const job = context();

    const result = await generateVisualPrompts(project.id, job);

    expect(result).toEqual({ updatedScenes: 1, skippedScenes: 0, failedChapters: [1] });
    expect((await getProject(project.id)).scenes.map((scene) => scene.visualPrompt)).toEqual(['', '', 'Generated 3']);
    expect(aiMock.chat).toHaveBeenCalledTimes(3);
    expect(aiMock.chat.mock.calls[1]![0][1].content).toContain('Validation error:');
    expect(job.progress).toEqual([50, 100]);
    expect(job.logs.some((line) => line.includes('Chapter 1'))).toBe(true);
  });

  it('seeds a rerun from populated chapters and skips their AI calls', async () => {
    const project = await projectWithScenes(['A'.repeat(600), 'Second reference', '']);
    aiMock.chat.mockResolvedValue(batch([3], 'next'));
    const job = context();

    const result = await generateVisualPrompts(project.id, job);

    expect(result).toEqual({ updatedScenes: 1, skippedScenes: 2, failedChapters: [] });
    expect(aiMock.chat).toHaveBeenCalledTimes(1);
    const user = aiMock.chat.mock.calls[0]![0][1].content as string;
    const seed = user.match(/Previous style note: ([^\n]*)/)?.[1] ?? '';
    expect(seed.length).toBeLessThanOrEqual(500);
    expect(seed).toContain('A'.repeat(100));
    expect(job.progress).toEqual([50, 100]);
  });

  it('stops after an in-flight response is cancelled without writing it', async () => {
    const project = await projectWithScenes(['', '', '']);
    let cancelled = false;
    aiMock.chat.mockImplementation(async () => { cancelled = true; return batch([1, 2], 'discard'); });

    const result = await generateVisualPrompts(project.id, context(() => cancelled));

    expect(result).toEqual({ updatedScenes: 0, skippedScenes: 0, failedChapters: [] });
    expect((await getProject(project.id)).scenes.map((scene) => scene.visualPrompt)).toEqual(['', '', '']);
    expect(aiMock.chat).toHaveBeenCalledTimes(1);
  });

  it('continues after an AI failure without retrying that chapter', async () => {
    const project = await projectWithScenes(['', '', '']);
    aiMock.chat.mockRejectedValueOnce(new Error('provider down')).mockResolvedValueOnce(batch([3], 'later'));
    const job = context();

    expect(await generateVisualPrompts(project.id, job)).toEqual({ updatedScenes: 1, skippedScenes: 0, failedChapters: [1] });
    expect(aiMock.chat).toHaveBeenCalledTimes(2);
    expect(job.logs.some((line) => line.includes('provider down'))).toBe(true);
  });

  it('counts a manual edit made during the AI call as skipped and leaves it intact', async () => {
    const project = await projectWithScenes(['', '', 'Generated 3']);
    aiMock.chat.mockImplementation(async () => {
      await patchProjectScene(project.id, 'scene-1', { visualPrompt: 'Manual during AI' });
      return batch([1, 2], 'next');
    });

    const result = await generateVisualPrompts(project.id, context());

    expect(result).toEqual({ updatedScenes: 1, skippedScenes: 2, failedChapters: [] });
    expect((await getProject(project.id)).scenes.map((scene) => scene.visualPrompt)).toEqual(['Manual during AI', 'Generated 2', 'Generated 3']);
  });
});
