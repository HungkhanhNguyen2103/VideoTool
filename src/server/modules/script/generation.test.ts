import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, getProject } from '../project';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { getCollection } from '../../db/client';
import { generateScript } from './service';

const aiMock = vi.hoisted(() => ({ chat: vi.fn(), stream: vi.fn() }));
vi.mock('../../shared/ai', () => ({ getAiClient: vi.fn(() => aiMock) }));

const projectInput = {
  title: 'Generation project', brief: 'Explain the river mystery.', language: 'en' as const, referencesText: '',
  scriptPresetId: 'documentary' as const, targetDurationSec: 8, chapterCount: 2, voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

const words = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(' ');
const outline = JSON.stringify({
  chapters: [
    { no: 1, title: 'Opening', role: 'hook', beat: 'Open with danger', targetWords: 10, endsOnTension: true },
    { no: 2, title: 'Answer', role: 'resolution', beat: 'Resolve the mystery', targetWords: 10, endsOnTension: false },
  ],
  openLoops: [{ question: 'What caused it?', plantedInChapter: 1, resolvedInChapter: 2 }],
  coreQuestion: 'What is at stake?',
  openingHook: 'A compelling opening.',
});

beforeAll(() => startTestMongo());
beforeEach(async () => {
  await getCollection('projects').deleteMany({});
  aiMock.chat.mockReset();
});
afterAll(() => closeTestMongo());

function context(overrides: Partial<{ isCancelled: () => Promise<boolean> }> = {}) {
  return {
    reportProgress: vi.fn().mockResolvedValue(undefined),
    appendLog: vi.fn().mockResolvedValue(undefined),
    isCancelled: overrides.isCancelled ?? vi.fn().mockResolvedValue(false),
  };
}

describe('sequential script generation', () => {
  it('expands chapters in order, retries short responses once, carries style and open loops, and reports progress', async () => {
    aiMock.chat
      .mockResolvedValueOnce(outline)
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: ['short'], styleNote: 'First style' }))
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: [words(8)], styleNote: 'Retry style' }))
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: ['short second'], styleNote: 'Second style' }))
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: ['still short'], styleNote: 'Accepted style' }));
    const project = await createProject(projectInput);
    const ctx = context();

    await generateScript(project.id, ctx);

    const saved = await getProject(project.id);
    expect(saved.chapters.map((chapter) => chapter.paragraphs)).toEqual([[words(8)], ['still short']]);
    expect(saved.chapters.map((chapter) => chapter.status)).toEqual(['pending', 'pending']);
    expect(saved.openLoops[0]!.question).toBe('What caused it?');
    expect(aiMock.chat).toHaveBeenCalledTimes(5);
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('Retry style');
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('What caused it?');
    expect(ctx.reportProgress).toHaveBeenCalled();
  });

  it('marks a failed chapter needs-fix and continues with later chapters', async () => {
    aiMock.chat
      .mockResolvedValueOnce(outline.replaceAll('targetWords":10', 'targetWords":1'))
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: ['Later chapter'], styleNote: 'Later style' }))
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: ['Later retry'], styleNote: 'Later retry style' }));
    const project = await createProject(projectInput);

    await generateScript(project.id, context());

    const saved = await getProject(project.id);
    expect(saved.chapters.map((chapter) => chapter.status)).toEqual(['needs-fix', 'pending']);
    expect(saved.chapters[1]!.paragraphs).toEqual(['Later chapter']);
  });

  it('stops before a chapter call when cancellation is requested', async () => {
    aiMock.chat.mockResolvedValueOnce(outline);
    const checks = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const project = await createProject(projectInput);

    await generateScript(project.id, context({ isCancelled: checks }));

    expect(aiMock.chat).toHaveBeenCalledTimes(1);
  });

  it('rejects an explicit chapter-count mismatch before outline persistence', async () => {
    aiMock.chat.mockResolvedValueOnce(JSON.stringify({
      chapters: [{ no: 1, title: 'Only chapter', role: 'hook', beat: 'Open', targetWords: 1, endsOnTension: false }],
      openLoops: [], coreQuestion: 'What is at stake?', openingHook: 'A compelling opening.',
    }));
    const project = await createProject(projectInput);

    await expect(generateScript(project.id, context())).rejects.toMatchObject({ code: 'SCRIPT_PARSE_ERROR' });
    expect((await getProject(project.id)).chapters).toEqual([]);
  });

  it('discards a valid expansion when cancellation arrives before the write', async () => {
    aiMock.chat
      .mockResolvedValueOnce(outline.replaceAll('targetWords":10', 'targetWords":1'))
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: ['Should not persist'], styleNote: 'Style' }));
    const checks = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const project = await createProject(projectInput);

    await generateScript(project.id, context({ isCancelled: checks }));

    expect((await getProject(project.id)).chapters[0]!.paragraphs).toEqual([]);
  });

  it('passes only chapter-relevant open loops to each expansion prompt', async () => {
    const threeChapterOutline = JSON.stringify({
      chapters: [
        { no: 1, title: 'Opening', role: 'hook', beat: 'Open', targetWords: 1, endsOnTension: true },
        { no: 2, title: 'Middle', role: 'rising', beat: 'Develop', targetWords: 1, endsOnTension: true },
        { no: 3, title: 'End', role: 'resolution', beat: 'Close', targetWords: 1, endsOnTension: false },
      ],
      openLoops: [
        { question: 'Relevant to the opening?', plantedInChapter: 1, resolvedInChapter: 2 },
        { question: 'Only for the ending?', plantedInChapter: 3, resolvedInChapter: 3 },
      ],
      coreQuestion: 'What is at stake?',
      openingHook: 'A compelling opening.',
    });
    aiMock.chat
      .mockResolvedValueOnce(threeChapterOutline)
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: ['One'], styleNote: 'Style one' }))
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: ['Two'], styleNote: 'Style two' }))
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: ['Three'], styleNote: 'Style three' }));
    const project = await createProject({ ...projectInput, chapterCount: 3, targetDurationSec: 12 });

    await generateScript(project.id, context());

    expect(aiMock.chat.mock.calls[2]![0][1].content).toContain('Relevant to the opening?');
    expect(aiMock.chat.mock.calls[2]![0][1].content).not.toContain('Only for the ending?');
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('Only for the ending?');
  });
});
