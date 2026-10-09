import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection } from 'mongodb';
import { getAiClient } from '../../shared/ai';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { applyEmptySceneVisualPromptsWithResult, createProject, getProject, patchProjectScene, replaceProjectChapters, replaceProjectScenes, replaceProjectScript } from '../project';
import { generateVisualPrompts } from './visual-prompts';

const aiMock = vi.hoisted(() => ({ model: 'deepseek-chat', chat: vi.fn() }));
vi.mock('../../shared/ai', () => ({ getAiClient: vi.fn(() => aiMock) }));

const projectInput = {
  title: 'Visual scenes', brief: 'An illustrated account of three scenes.', language: 'en' as const,
  referencesText: '', scriptPresetId: 'documentary' as const, targetDurationSec: 60,
  chapterCount: 2, voiceId: null,
  aiModel: 'deepseek-flash',
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

beforeAll(() => startTestMongo());
beforeEach(async () => {
  await getCollection('projects').deleteMany({});
  aiMock.chat.mockReset();
  vi.mocked(getAiClient).mockClear();
});
afterAll(() => closeTestMongo());

async function projectWithScenes(
  prompts: string[] = ['', 'Manual second', ''],
  counts: [number, number] = [2, 1],
  sfxPrompts: string[] = prompts.map((prompt) => prompt ? 'Existing SFX' : ''),
  assetTypes: ('image' | 'video')[] = prompts.map(() => 'image'),
  motionPrompts: string[] = prompts.map(() => ''),
) {
  const project = await createProject(projectInput);
  await replaceProjectChapters(project.id, [
    { id: 'chapter-1', no: 1, title: 'First', paragraphs: ['One', 'Two', 'Three', 'Four'].slice(0, counts[0]), status: 'approved', scenesCount: counts[0], durationSec: counts[0] * 20 },
    { id: 'chapter-2', no: 2, title: 'Second', paragraphs: ['One', 'Two', 'Three', 'Four'].slice(counts[0], counts[0] + counts[1]), status: 'approved', scenesCount: counts[1], durationSec: counts[1] * 20 },
  ], null);
  await replaceProjectScenes(project.id, ['One', 'Two', 'Three', 'Four'].slice(0, counts[0] + counts[1]).map((narration, index) => ({
    id: `scene-${index + 1}`, narration, visualPrompt: prompts[index]!, durationSec: 20,
    assetType: assetTypes[index] ?? 'image', assetFileId: null, audioFileId: null, sfxPrompt: sfxPrompts[index] ?? '', motionPrompt: motionPrompts[index] ?? '', sfxFileId: null,
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

function batch(indexes: number[], styleNote: string, sfxPrompts: Partial<Record<number, string>> = {}, motionPrompts: Partial<Record<number, string>> = {}) {
  return JSON.stringify({ styleNote, prompts: indexes.map((sceneIndex) => ({ sceneIndex, visualPrompt: `Generated ${sceneIndex}`, sfxPrompt: sfxPrompts[sceneIndex] ?? `Generated SFX ${sceneIndex}`, motionPrompt: motionPrompts[sceneIndex] ?? '' })) });
}

describe('generateVisualPrompts', () => {
  it('sends complete global-index chapters, preserves manual prompts, and carries the prior style note', async () => {
    const project = await projectWithScenes();
    aiMock.chat.mockResolvedValueOnce(batch([1, 2], 'Muted archival palette')).mockResolvedValueOnce(batch([3], 'Final style'));
    const job = context();

    const result = await generateVisualPrompts(project.id, job);

    expect(result).toEqual({ updatedScenes: 2, skippedScenes: 1, failedChapters: [] });
    expect(getAiClient).toHaveBeenCalledWith('deepseek', 'deepseek-flash');
    expect((await getProject(project.id)).scenes.map((scene) => scene.visualPrompt)).toEqual(['Generated 1', 'Manual second', 'Generated 3']);
    expect((await getProject(project.id)).scenes.map((scene) => scene.sfxPrompt)).toEqual(['Generated SFX 1', 'Existing SFX', 'Generated SFX 3']);
    expect(job.progress).toEqual([50, 100]);
    const first = aiMock.chat.mock.calls[0]![0][1].content as string;
    const second = aiMock.chat.mock.calls[1]![0][1].content as string;
    expect(first).toContain('This chapter contains exactly 2 scenes. Return exactly 2 prompt objects, one for every supplied sceneIndex. Echo each supplied sceneIndex exactly; do not invent, omit, duplicate, or renumber indexes.');
    expect(first).toContain('Scene 1\nNarration: One');
    expect(first).toContain('Scene 2\nNarration: Two\nAsset type: image\nExisting visual prompt: Manual second');
    expect(first).toContain('Existing SFX prompt: Existing SFX');
    expect(first).not.toContain('scene-1');
    expect(second).toContain('Scene 3\nNarration: Three');
    expect(second).toContain('Previous style note: Muted archival palette');
  });

  it('preserves existing SFX prompts while filling empty SFX prompts', async () => {
    const project = await projectWithScenes(['', '', ''], [2, 1], ['Existing SFX', '', '']);
    aiMock.chat.mockResolvedValueOnce(batch([1, 2], 'First style')).mockResolvedValueOnce(batch([3], 'Second style'));

    await generateVisualPrompts(project.id, context());

    expect((await getProject(project.id)).scenes.map((scene) => scene.sfxPrompt)).toEqual(['Existing SFX', 'Generated SFX 2', 'Generated SFX 3']);
  });

  it('backfills SFX when all visual prompts are already filled', async () => {
    const project = await projectWithScenes(['Visual 1', 'Visual 2', 'Visual 3'], [2, 1], ['', '', '']);
    aiMock.chat.mockResolvedValueOnce(batch([1, 2], 'First style')).mockResolvedValueOnce(batch([3], 'Second style'));

    const result = await generateVisualPrompts(project.id, context());

    expect(result).toEqual({ updatedScenes: 0, skippedScenes: 3, failedChapters: [] });
    expect(aiMock.chat).toHaveBeenCalledTimes(2);
    expect((await getProject(project.id)).scenes.map((scene) => scene.visualPrompt)).toEqual(['Visual 1', 'Visual 2', 'Visual 3']);
    expect((await getProject(project.id)).scenes.map((scene) => scene.sfxPrompt)).toEqual(['Generated SFX 1', 'Generated SFX 2', 'Generated SFX 3']);
  });

  it('skips a chapter only when both visual and SFX prompts are filled', async () => {
    const project = await projectWithScenes(['Visual 1', 'Visual 2', 'Visual 3'], [2, 1], ['SFX 1', 'SFX 2', 'SFX 3']);
    const job = context();

    const result = await generateVisualPrompts(project.id, job);

    expect(result).toEqual({ updatedScenes: 0, skippedScenes: 3, failedChapters: [] });
    expect(aiMock.chat).not.toHaveBeenCalled();
    expect(job.logs).toEqual([
      'Chapter 1: all visual and SFX prompts already filled; skipped.',
      'Chapter 2: all visual and SFX prompts already filled; skipped.',
      'Visual prompts finished: 0 updated, 0 SFX prompts added, 0 motion prompts added, 3 skipped, 0 failed chapters.',
    ]);
  });

  it('regenerates a video scene with filled visual and SFX prompts when motion is empty', async () => {
    const project = await projectWithScenes(['Visual 1', 'Visual 2', 'Visual 3'], [2, 1], ['SFX 1', 'SFX 2', 'SFX 3'], ['video', 'image', 'image']);
    expect(project.scenes[0]?.assetType).toBe('video');
    expect(project.scenes[0]?.motionPrompt).toBe('');
    aiMock.chat.mockResolvedValueOnce(batch([1, 2], 'Video style', {}, { 1: 'Camera slowly pushes in as the engineer turns the prototype toward the lens.' }));

    const job = context();
    const result = await generateVisualPrompts(project.id, job);

    expect(result).toEqual({ updatedScenes: 0, skippedScenes: 3, failedChapters: [] });
    expect(aiMock.chat).toHaveBeenCalledTimes(1);
    expect(job.logs).toContain('Chapter 1: 0 visual prompts added; 0 SFX prompts added; 1 motion prompts added; 2 already filled.');
    expect(job.logs.at(-1)).toContain('1 motion prompts added');
    expect((await getProject(project.id)).scenes.map((scene) => scene.motionPrompt)).toEqual(['Camera slowly pushes in as the engineer turns the prototype toward the lens.', '', '']);
  });

  it('returns motion prompt write IDs without clobbering a manual motion edit', async () => {
    const project = await projectWithScenes(['', '', ''], [2, 1], ['', '', '']);
    await patchProjectScene(project.id, 'scene-1', { motionPrompt: 'Manual camera move.' });

    const result = await applyEmptySceneVisualPromptsWithResult(project.id, [
      { sceneId: 'scene-1', motionPrompt: 'AI camera move 1.' },
      { sceneId: 'scene-2', motionPrompt: 'AI camera move 2.' },
    ]);

    expect(result.updatedMotionPromptSceneIds).toEqual(['scene-2']);
    expect((await getProject(project.id)).scenes.map((scene) => scene.motionPrompt)).toEqual(['Manual camera move.', 'AI camera move 2.', '']);
  });

  it('leaves empty SFX suggestions empty and logs zero SFX additions', async () => {
    const project = await projectWithScenes(['', '', '']);
    aiMock.chat.mockResolvedValueOnce(batch([1, 2], 'First style', { 1: '', 2: '' })).mockResolvedValueOnce(batch([3], 'Second style', { 3: '' }));
    const job = context();

    const result = await generateVisualPrompts(project.id, job);

    expect(result).toEqual({ updatedScenes: 3, skippedScenes: 0, failedChapters: [] });
    expect((await getProject(project.id)).scenes.every((scene) => scene.sfxPrompt === '')).toBe(true);
    expect(job.logs).toContain('Chapter 1: 2 visual prompts added; 0 SFX prompts added; 0 motion prompts added; 0 already filled.');
    expect(job.logs).toContain('Chapter 2: 1 visual prompts added; 0 SFX prompts added; 0 motion prompts added; 0 already filled.');
    expect(job.logs.at(-1)).toBe('Visual prompts finished: 3 updated, 0 SFX prompts added, 0 motion prompts added, 0 skipped, 0 failed chapters.');
  });

  it('forwards the selected style and script continuity, using only the previous chapter for later context', async () => {
    const project = await projectWithScenes(['', '', '']);
    await replaceProjectScript(project.id, project.chapters.map((chapter, index) => ({
      ...chapter,
      chapterSummary: index === 0 ? 'First chapter summary' : 'Current chapter summary',
      avoidRepeating: index === 0 ? ['First avoidance'] : ['Current avoidance'],
      persistentFacts: index === 0 ? ['First fact'] : ['Current fact'],
    })), [], null, 'Why did the river change?', 'At dawn, it reversed.');
    aiMock.chat.mockResolvedValueOnce(batch([1, 2], 'First style')).mockResolvedValueOnce(batch([3], 'Second style'));

    await generateVisualPrompts(project.id, context());

    const first = aiMock.chat.mock.calls[0]![0][1].content as string;
    const second = aiMock.chat.mock.calls[1]![0][1].content as string;
    expect(first).toContain('Required visual style (must follow for every scene):');
    expect(first).toContain('Core question: Why did the river change?');
    expect(first).toContain('Opening hook: At dawn, it reversed.');
    expect(first).toContain('Previous chapter summary: (none)');
    expect(first).toContain('Avoid repeating: (none)');
    expect(first).toContain('Persistent facts: (none)');
    expect(second).toContain('Previous chapter summary: First chapter summary');
    expect(second).toContain('Avoid repeating: First avoidance');
    expect(second).toContain('Persistent facts: First fact');
    expect(second).not.toContain('Current chapter summary');
    expect(second).not.toContain('Current avoidance');
    expect(second).not.toContain('Current fact');
  });

  it.each([
    ['missing', [1]], ['count mismatch', []], ['duplicate', [1, 1]], ['extra', [1, 2, 3]], ['out of range', [1, 99]],
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

  it('accepts a corrected batch after one validation retry', async () => {
    const project = await projectWithScenes(['', '', '']);
    aiMock.chat.mockResolvedValueOnce(batch([1, 1], 'invalid'))
      .mockResolvedValueOnce(batch([1, 2], 'Corrected style'))
      .mockResolvedValueOnce(batch([3], 'Last style'));
    const job = context();

    expect(await generateVisualPrompts(project.id, job)).toEqual({ updatedScenes: 3, skippedScenes: 0, failedChapters: [] });
    expect(aiMock.chat).toHaveBeenCalledTimes(3);
    expect(aiMock.chat.mock.calls[1]![0][1].content).toContain('Validation error:');
    expect(aiMock.chat.mock.calls[2]![0][1].content).toContain('Previous style note: Corrected style');
    expect((await getProject(project.id)).scenes.map((scene) => scene.visualPrompt)).toEqual(['Generated 1', 'Generated 2', 'Generated 3']);
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

  it('seeds the first call from existing later prompts even if the first chapter fails', async () => {
    const project = await projectWithScenes(['', '', 'Later chapter reference']);
    aiMock.chat.mockRejectedValueOnce(new Error('provider down'));
    const job = context();

    expect(await generateVisualPrompts(project.id, job)).toEqual({ updatedScenes: 0, skippedScenes: 1, failedChapters: [1] });
    expect(aiMock.chat).toHaveBeenCalledTimes(1);
    expect(aiMock.chat.mock.calls[0]![0][1].content).toContain('Previous style note: Later chapter reference');
    expect((await getProject(project.id)).scenes.map((scene) => scene.visualPrompt)).toEqual(['', '', 'Later chapter reference']);
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

  it('stops before a validation retry when cancellation follows the invalid response', async () => {
    const project = await projectWithScenes(['', '', '']);
    aiMock.chat.mockResolvedValue(batch([1], 'invalid'));
    let cancelled = false;
    const job = context(() => cancelled);
    const appendLog = job.appendLog;
    job.appendLog = async (message) => { await appendLog(message); if (message.includes('retrying once')) cancelled = true; };

    expect(await generateVisualPrompts(project.id, job)).toEqual({ updatedScenes: 0, skippedScenes: 0, failedChapters: [] });
    expect(aiMock.chat).toHaveBeenCalledTimes(1);
    expect((await getProject(project.id)).scenes.every((scene) => scene.visualPrompt === '')).toBe(true);
  });

  it('stops between chapters after reporting the completed chapter', async () => {
    const project = await projectWithScenes(['', '', '']);
    aiMock.chat.mockResolvedValue(batch([1, 2], 'first'));
    let cancelled = false;
    const job = context(() => cancelled);
    job.reportProgress = async (percent) => { job.progress.push(percent); cancelled = true; };

    expect(await generateVisualPrompts(project.id, job)).toEqual({ updatedScenes: 2, skippedScenes: 0, failedChapters: [] });
    expect(aiMock.chat).toHaveBeenCalledTimes(1);
    expect(job.progress).toEqual([50]);
    expect((await getProject(project.id)).scenes.map((scene) => scene.visualPrompt)).toEqual(['Generated 1', 'Generated 2', '']);
  });

  it('discards a validated response if cancelled immediately before its write', async () => {
    const project = await projectWithScenes(['', '', '']);
    aiMock.chat.mockResolvedValue(batch([1, 2], 'first'));
    let checks = 0;
    const job = context(() => ++checks === 4);

    expect(await generateVisualPrompts(project.id, job)).toEqual({ updatedScenes: 0, skippedScenes: 0, failedChapters: [] });
    expect(checks).toBe(4);
    expect((await getProject(project.id)).scenes.every((scene) => scene.visualPrompt === '')).toBe(true);
  });

  it('continues after an AI failure without retrying that chapter', async () => {
    const project = await projectWithScenes(['', '', '']);
    aiMock.chat.mockRejectedValueOnce(new Error('provider down')).mockResolvedValueOnce(batch([3], 'later'));
    const job = context();

    expect(await generateVisualPrompts(project.id, job)).toEqual({ updatedScenes: 1, skippedScenes: 0, failedChapters: [1] });
    expect(aiMock.chat).toHaveBeenCalledTimes(2);
    expect(job.logs.some((line) => line.includes('provider down'))).toBe(true);
  });

  it('logs a project-write rejection, preserves the seed, and processes the next chapter', async () => {
    const project = await projectWithScenes(['', 'Existing second', ''], [1, 2]);
    aiMock.chat.mockResolvedValueOnce(batch([1], 'Must not advance')).mockResolvedValueOnce(batch([2, 3], 'Later'));
    const spy = vi.spyOn(Collection.prototype, 'findOneAndUpdate').mockRejectedValueOnce(new Error('write rejected'));
    const job = context();
    try {
      expect(await generateVisualPrompts(project.id, job)).toEqual({ updatedScenes: 1, skippedScenes: 1, failedChapters: [1] });
    } finally {
      spy.mockRestore();
    }
    expect(aiMock.chat).toHaveBeenCalledTimes(2);
    expect(aiMock.chat.mock.calls[1]![0][1].content).toContain('Previous style note: Existing second');
    expect(job.logs.some((line) => line.includes('Chapter 1') && line.includes('write rejected'))).toBe(true);
    expect(job.progress).toEqual([50, 100]);
    expect((await getProject(project.id)).scenes.map((scene) => scene.visualPrompt)).toEqual(['', 'Existing second', 'Generated 3']);
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

  it('does not count a same-value manual edit between the job read and atomic write', async () => {
    const project = await projectWithScenes(['', '', 'Generated 3']);
    aiMock.chat.mockResolvedValue(batch([1, 2], 'next'));
    const original = Collection.prototype.findOne;
    let reads = 0;
    let injected = false;
    const spy = vi.spyOn(Collection.prototype, 'findOne').mockImplementation(async function (this: Collection, ...args) {
      const doc = await original.apply(this, args) as { _id?: string } | null;
      if (!injected && doc?._id === project.id && ++reads === 2) {
        injected = true;
        await patchProjectScene(project.id, 'scene-1', { visualPrompt: 'Generated 1' });
      }
      return doc;
    });
    try {
      const result = await generateVisualPrompts(project.id, context());
      expect(result).toEqual({ updatedScenes: 1, skippedScenes: 2, failedChapters: [] });
    } finally {
      spy.mockRestore();
    }
    expect((await getProject(project.id)).scenes.map((scene) => scene.visualPrompt)).toEqual(['Generated 1', 'Generated 2', 'Generated 3']);
  });
});
