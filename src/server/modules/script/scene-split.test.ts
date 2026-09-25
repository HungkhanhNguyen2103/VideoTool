import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectDetailSchema } from '../../../contracts/project';
import { ChapterDocSchema } from '../../../contracts/script';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createProject, getProject, getProjectHistory, replaceProjectChapters, replaceProjectScenes, type ProjectDoc } from '../project';
import { buildSceneSplitPrompt } from './ai/build-prompt';
import { parseSceneSplitBatch } from './ai/parse-output';
import { splitProjectScenes } from './scene-split';

const aiMock = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock('../../shared/ai', () => ({ getAiClient: vi.fn(() => aiMock) }));

const project = ProjectDetailSchema.parse({
  id: 'project-1', title: 'River History', brief: 'Explain the history of the river.',
  status: 'script', language: 'en', referencesText: 'Archive notes', scriptPresetId: 'documentary',
  targetDurationSec: 120, chapterCount: 1, voiceId: null,
  renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 },
  scenes: [], chapters: [], version: 1, createdAt: '2026-09-23', updatedAt: '2026-09-23',
});

const projectInput = {
  title: 'Scene beats', brief: 'Split narration into visual beats.', language: 'en' as const,
  referencesText: '', scriptPresetId: 'documentary' as const, targetDurationSec: 60,
  chapterCount: 2, voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

function scene(id: string, narration: string) {
  return { id, narration, visualPrompt: '', durationSec: 9, assetType: 'image' as const,
    assetFileId: null, audioFileId: null, sfxPrompt: '', sfxFileId: null };
}

async function projectWithScenes() {
  const created = await createProject(projectInput);
  await replaceProjectChapters(created.id, [
    { id: 'chapter-1', no: 1, title: 'First', paragraphs: ['First visual beat Second visual beat', 'Untouched'], status: 'approved', scenesCount: 2, durationSec: 18 },
    { id: 'chapter-2', no: 2, title: 'Second', paragraphs: ['Later chapter'], status: 'approved', scenesCount: 1, durationSec: 9 },
  ], null);
  await replaceProjectScenes(created.id, [scene('scene-1', 'First visual beat Second visual beat'), scene('scene-2', 'Untouched'), scene('scene-3', 'Later chapter')], 'assets');
  return getProject(created.id);
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

function batch(...scenes: { sceneIndex: number; chunks: string[] }[]) {
  return JSON.stringify({ scenes });
}

beforeAll(() => startTestMongo());
beforeEach(async () => {
  await getCollection('projects').deleteMany({});
  aiMock.chat.mockReset();
});
afterAll(() => closeTestMongo());

describe('splitProjectScenes', () => {
  it('persists multi-chunk replacements, original one-chunk objects, durations, counts and one history snapshot', async () => {
    const project = await projectWithScenes();
    aiMock.chat.mockResolvedValueOnce(batch(
      { sceneIndex: 1, chunks: ['First visual beat', 'Second visual beat'] },
      { sceneIndex: 2, chunks: ['Untouched'] },
    )).mockResolvedValueOnce(batch({ sceneIndex: 4, chunks: ['Later chapter'] }));
    const job = context();

    expect(await splitProjectScenes(project.id, job)).toEqual({ splitScenes: 1, skippedChapters: 0, failedChapters: [] });
    const saved = await getProject(project.id);
    expect(saved.scenes.map((item) => item.narration)).toEqual(['First visual beat', 'Second visual beat', 'Untouched', 'Later chapter']);
    expect(saved.scenes.slice(0, 2).map((item) => item.durationSec)).toEqual([1, 1]);
    expect(saved.scenes.slice(0, 2).every((item) => item.id !== 'scene-1')).toBe(true);
    expect(saved.scenes[2]).toEqual(project.scenes[1]);
    expect(saved.scenes[3]).toEqual(project.scenes[2]);
    expect(saved.chapters.map((item) => [item.scenesCount, item.durationSec])).toEqual([[3, 11], [1, 9]]);
    expect((await getProjectHistory(project.id)).length).toBe(1);
    expect(job.progress).toEqual([50, 100]);
    expect(aiMock.chat.mock.calls[1]![0][1].content).toContain('Scene 4\nNarration: Later chapter');
  });

  it('retries altered text once, leaves its chapter untouched, and continues to the next', async () => {
    const project = await projectWithScenes();
    aiMock.chat.mockResolvedValueOnce(batch({ sceneIndex: 1, chunks: ['Changed words'] }, { sceneIndex: 2, chunks: ['Untouched'] }))
      .mockResolvedValueOnce(batch({ sceneIndex: 1, chunks: ['Changed again'] }, { sceneIndex: 2, chunks: ['Untouched'] }))
      .mockResolvedValueOnce(batch({ sceneIndex: 3, chunks: ['Later', 'chapter'] }));

    expect(await splitProjectScenes(project.id, context())).toEqual({ splitScenes: 1, skippedChapters: 0, failedChapters: [1] });
    expect((await getProject(project.id)).scenes.map((item) => item.narration)).toEqual(['First visual beat Second visual beat', 'Untouched', 'Later', 'chapter']);
    expect(aiMock.chat).toHaveBeenCalledTimes(3);
    expect(aiMock.chat.mock.calls[1]![0][1].content).toContain('Validation error:');
  });

  it.each([
    ['missing', [{ sceneIndex: 1, chunks: ['First visual beat Second visual beat'] }]],
    ['duplicate', [{ sceneIndex: 1, chunks: ['First visual beat Second visual beat'] }, { sceneIndex: 1, chunks: ['Untouched'] }]],
    ['extra', [{ sceneIndex: 1, chunks: ['First visual beat Second visual beat'] }, { sceneIndex: 2, chunks: ['Untouched'] }, { sceneIndex: 3, chunks: ['Extra'] }]],
  ])('rejects a %s index set twice without changing the chapter', async (_name, invalid) => {
    const project = await projectWithScenes();
    aiMock.chat.mockResolvedValueOnce(batch(...invalid)).mockResolvedValueOnce(batch(...invalid))
      .mockResolvedValueOnce(batch({ sceneIndex: 3, chunks: ['Later chapter'] }));

    expect(await splitProjectScenes(project.id, context())).toEqual({ splitScenes: 0, skippedChapters: 0, failedChapters: [1] });
    expect((await getProject(project.id)).scenes).toEqual(project.scenes);
    expect((await getProjectHistory(project.id)).length).toBe(0);
  });

  it.each(['assetFileId', 'audioFileId', 'sfxFileId', 'visualPrompt'] as const)('skips a chapter with %s populated before any provider call', async (field) => {
    const project = await projectWithScenes();
    const value = field === 'visualPrompt' ? 'Manual prompt' : 'file-1';
    await getCollection<ProjectDoc>('projects').updateOne({ _id: project.id }, { $set: { [`scenes.0.${field}`]: value, 'scenes.2.visualPrompt': 'Later manual prompt' } });
    const before = await getProject(project.id);

    expect(await splitProjectScenes(project.id, context())).toEqual({ splitScenes: 0, skippedChapters: 2, failedChapters: [] });
    expect(aiMock.chat).not.toHaveBeenCalled();
    expect((await getProject(project.id)).scenes).toEqual(before.scenes);
  });

  it('accepts whitespace-only differences while trimming replacement chunks', async () => {
    const project = await projectWithScenes();
    aiMock.chat.mockResolvedValueOnce(batch(
      { sceneIndex: 1, chunks: [' First visual beat ', '  Second   visual beat  '] },
      { sceneIndex: 2, chunks: ['Untouched'] },
    )).mockResolvedValueOnce(batch({ sceneIndex: 4, chunks: ['Later chapter'] }));

    expect(await splitProjectScenes(project.id, context())).toEqual({ splitScenes: 1, skippedChapters: 0, failedChapters: [] });
    expect((await getProject(project.id)).scenes.slice(0, 2).map((item) => item.narration)).toEqual(['First visual beat', 'Second   visual beat']);
  });

  it('persists each validated no-op chapter without making a history snapshot', async () => {
    const project = await projectWithScenes();
    aiMock.chat.mockResolvedValueOnce(batch(
      { sceneIndex: 1, chunks: ['First visual beat Second visual beat'] },
      { sceneIndex: 2, chunks: ['Untouched'] },
    )).mockResolvedValueOnce(batch({ sceneIndex: 3, chunks: ['Later chapter'] }));

    expect(await splitProjectScenes(project.id, context())).toEqual({ splitScenes: 0, skippedChapters: 0, failedChapters: [] });
    const saved = await getProject(project.id);
    expect(saved.scenes).toEqual(project.scenes);
    expect(saved.version).toBe(project.version + 4);
    expect((await getProjectHistory(project.id)).length).toBe(0);
  });

  it('does not skip a scene only because its asset type is video', async () => {
    const project = await projectWithScenes();
    await getCollection<ProjectDoc>('projects').updateOne({ _id: project.id }, { $set: { 'scenes.0.assetType': 'video', 'scenes.2.visualPrompt': 'Later manual prompt' } });
    aiMock.chat.mockResolvedValueOnce(batch(
      { sceneIndex: 1, chunks: ['First visual beat Second visual beat'] },
      { sceneIndex: 2, chunks: ['Untouched'] },
    ));

    expect(await splitProjectScenes(project.id, context())).toEqual({ splitScenes: 0, skippedChapters: 1, failedChapters: [] });
    expect(aiMock.chat).toHaveBeenCalledTimes(1);
    expect((await getProject(project.id)).scenes[0]?.assetType).toBe('video');
  });

  it('continues after a provider failure without retrying it', async () => {
    const project = await projectWithScenes();
    aiMock.chat.mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce(batch({ sceneIndex: 3, chunks: ['Later', 'chapter'] }));
    const job = context();

    expect(await splitProjectScenes(project.id, job)).toEqual({ splitScenes: 1, skippedChapters: 0, failedChapters: [1] });
    expect(aiMock.chat).toHaveBeenCalledTimes(2);
    expect(job.logs.some((line) => line.includes('provider down'))).toBe(true);
  });

  it('discards a validated response when cancellation arrives before persistence', async () => {
    const project = await projectWithScenes();
    aiMock.chat.mockResolvedValue(batch(
      { sceneIndex: 1, chunks: ['First visual beat', 'Second visual beat'] },
      { sceneIndex: 2, chunks: ['Untouched'] },
    ));
    let checks = 0;
    const job = context(() => ++checks === 4);

    expect(await splitProjectScenes(project.id, job)).toEqual({ splitScenes: 0, skippedChapters: 0, failedChapters: [] });
    expect(checks).toBe(4);
    expect((await getProject(project.id)).scenes).toEqual(project.scenes);
  });

  it('keeps chapter one after cancellation and never requests chapter two', async () => {
    const project = await projectWithScenes();
    aiMock.chat.mockResolvedValueOnce(batch(
      { sceneIndex: 1, chunks: ['First visual beat', 'Second visual beat'] },
      { sceneIndex: 2, chunks: ['Untouched'] },
    ));
    let cancelled = false;
    const job = context(() => cancelled);
    job.reportProgress = async (percent) => { job.progress.push(percent); cancelled = true; };

    expect(await splitProjectScenes(project.id, job)).toEqual({ splitScenes: 1, skippedChapters: 0, failedChapters: [] });
    expect(job.progress).toEqual([50]);
    expect(aiMock.chat).toHaveBeenCalledTimes(1);
    expect((await getProject(project.id)).scenes.map((item) => item.narration)).toEqual(['First visual beat', 'Second visual beat', 'Untouched', 'Later chapter']);
  });
});
const chapter = ChapterDocSchema.parse({ id: 'chapter-1', no: 2, title: 'The Turning Point', paragraphs: ['Source'], status: 'approved', scenesCount: 1, durationSec: 12 });

describe('scene split AI contract', () => {
  it('parses positive indexed non-empty chunk sets', () => {
    expect(parseSceneSplitBatch('{"scenes":[{"sceneIndex":1,"chunks":["First beat","second beat"]}]}'))
      .toEqual({ scenes: [{ sceneIndex: 1, chunks: ['First beat', 'second beat'] }] });
  });

  it('rejects a zero scene index even when chunks are valid', () => {
    expect(() => parseSceneSplitBatch('{"scenes":[{"sceneIndex":0,"chunks":["Valid chunk"]}]}'))
      .toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR' }));
  });

  it('rejects an empty chunk set for a valid scene index', () => {
    expect(() => parseSceneSplitBatch('{"scenes":[{"sceneIndex":1,"chunks":[]}]}'))
      .toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR' }));
  });

  it('gives the model context, global indexes and exact narration without internal IDs', () => {
    const result = buildSceneSplitPrompt({
      project,
      chapter,
      scenes: [{ sceneId: 'internal-id', sceneIndex: 4, narration: 'Exact source text.' }],
    });
    expect(result.user).toContain('Scene 4\nNarration: Exact source text.');
    expect(result.user).toContain('Project title: River History');
    expect(result.user).toContain('Brief: Explain the history of the river.');
    expect(result.user).toContain('Language: English');
    expect(result.user).toContain('Chapter 2: The Turning Point');
    expect(result.user).not.toContain('internal-id');
    expect(result.system).toContain('exact contiguous substring');
    expect(result.system).toContain('Do not reword');
    expect(result.system).toContain('Echo each supplied sceneIndex exactly');
  });
});
