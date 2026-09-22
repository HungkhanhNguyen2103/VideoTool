import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateProjectRequestSchema, ProjectDetailSchema } from '../../../contracts/project';
import { ChapterDocSchema, ChapterSnapshotSchema } from '../../../contracts/script';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createProject, getProject, getProjectHistory, replaceProjectChapters } from '../project';
import { finalizeScript, generateScript, regenerateChapter } from './service';

const aiMock = vi.hoisted(() => ({ chat: vi.fn(), stream: vi.fn() }));
vi.mock('../../shared/ai', () => ({ getAiClient: vi.fn(() => aiMock) }));

const projectInput = {
  title: 'Script contract project',
  brief: 'A valid brief for script contract tests.',
  language: 'vi' as const,
  referencesText: '',
  scriptPresetId: 'documentary' as const,
  targetDurationSec: 60,
  chapterCount: 2,
  voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

beforeAll(() => startTestMongo());
beforeEach(async () => {
  await getCollection('projects').deleteMany({});
  aiMock.chat.mockReset();
  aiMock.stream.mockReset();
});
afterAll(() => closeTestMongo());

describe('script contracts', () => {
  it('accepts chapters and snapshots with stable chapter metadata', () => {
    const chapter = ChapterDocSchema.parse({
      id: 'chapter-1',
      no: 1,
      title: 'Opening',
      paragraphs: ['First paragraph'],
      status: 'pending',
      scenesCount: null,
      durationSec: null,
    });
    const snapshot = ChapterSnapshotSchema.parse({ takenAt: new Date(), chapters: [chapter] });
    expect(snapshot.chapters[0]).toEqual(chapter);
  });

  it('defaults a new project to DeepSeek and exposes chapters in project detail', () => {
    const input = CreateProjectRequestSchema.parse(projectInput);
    expect(input.aiProvider).toBe('deepseek');

    const detail = ProjectDetailSchema.parse({
      id: 'project-1',
      ...projectInput,
      status: 'draft',
      scenes: [],
      chapters: [],
      aiProvider: input.aiProvider,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(detail.chapters).toEqual([]);
    expect(detail.aiProvider).toBe('deepseek');
  });

  it('generates chapters, logs milestones, and sets project status to script', async () => {
    aiMock.chat.mockResolvedValue(JSON.stringify([
      { no: 1, title: 'Opening', paragraphs: ['First', 'Second'], scenesCount: null, durationSec: null },
      { no: 2, title: 'Context', paragraphs: ['Third'], scenesCount: null, durationSec: null },
    ]));
    const project = await createProject(projectInput);
    const logs: string[] = [];

    await generateScript(project.id, async (message) => { logs.push(message); });

    const saved = await getProject(project.id);
    expect(saved.status).toBe('script');
    expect(saved.chapters).toHaveLength(2);
    expect(saved.chapters[0]!).toMatchObject({ no: 1, status: 'pending', scenesCount: null, durationSec: null });
    expect(saved.chapters[0]!.id).toHaveLength(26);
    expect(await getProjectHistory(project.id)).toEqual([]);
    expect(logs).toEqual([
      'Loading project and AI client…',
      'Sending request to AI…',
      'Parsing AI response…',
      'Script saved — 2 chapters.',
    ]);
    expect(aiMock.chat).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ content: expect.stringContaining(projectInput.brief) }),
    ]));
  });

  it('maps invalid AI JSON to SCRIPT_PARSE_ERROR without writing chapters', async () => {
    aiMock.chat.mockResolvedValue('{not valid json');
    const project = await createProject(projectInput);

    await expect(generateScript(project.id, vi.fn())).rejects.toMatchObject({ code: 'SCRIPT_PARSE_ERROR', status: 422 });
    expect((await getProject(project.id)).chapters).toEqual([]);
  });

  it('streams regeneration chunks, updates the chapter, and snapshots old paragraphs', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'pending', scenesCount: null, durationSec: null }], null, 'script');
    aiMock.stream.mockReturnValue((async function* () {
      yield '{"paragraphs":["New ';
      yield 'paragraph"]}';
    })());
    const chunks: string[] = [];

    const updated = await regenerateChapter(project.id, 'chapter-1', { instruction: 'shorter', level: 'light' }, (chunk) => chunks.push(chunk), new AbortController().signal);

    expect(chunks).toEqual(['{"paragraphs":["New ', 'paragraph"]}']);
    expect(updated).toMatchObject({ id: 'chapter-1', paragraphs: ['New paragraph'], status: 'pending' });
    expect(await getProjectHistory(project.id)).toHaveLength(1);
    expect((await getProjectHistory(project.id))[0]!.chapters[0]!.paragraphs).toEqual(['Old']);
  });

  it('marks an aborted regeneration needs-fix and leaves old paragraphs unchanged', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'pending', scenesCount: null, durationSec: null }], null, 'script');
    const controller = new AbortController();
    aiMock.stream.mockReturnValue((async function* () {
      await new Promise<void>((resolve) => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
      throw new DOMException('Aborted', 'AbortError');
    })());

    const promise = regenerateChapter(project.id, 'chapter-1', { instruction: 'stop', level: 'rewrite' }, vi.fn(), controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect((await getProject(project.id)).chapters[0]).toMatchObject({ status: 'needs-fix', paragraphs: ['Old'] });
  });

  it('finalizes approved chapters into scenes and sets status assets', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [
      { id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['One', 'Two'], status: 'approved', scenesCount: null, durationSec: null },
      { id: 'chapter-2', no: 2, title: 'Context', paragraphs: ['Three'], status: 'approved', scenesCount: null, durationSec: null },
    ], null, 'script');

    await finalizeScript(project.id);

    const saved = await getProject(project.id);
    expect(saved.status).toBe('assets');
    expect(saved.scenes).toHaveLength(3);
    expect(saved.scenes.every((scene) => scene.visualPrompt === '')).toBe(true);
    expect(saved.scenes.reduce((sum, scene) => sum + scene.durationSec, 0)).toBe(60);
    expect(saved.chapters.map((chapter) => chapter.scenesCount)).toEqual([2, 1]);
    expect(await getProjectHistory(project.id)).toHaveLength(1);
  });

  it('rejects finalization until every chapter is approved', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['One'], status: 'pending', scenesCount: null, durationSec: null }], null, 'script');
    await expect(finalizeScript(project.id)).rejects.toMatchObject({ code: 'NOT_ALL_APPROVED', status: 422 });
  });
});
