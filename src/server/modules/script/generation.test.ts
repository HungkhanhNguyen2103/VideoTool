import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, getProject } from '../project';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { getCollection } from '../../db/client';
import { getAiClient } from '../../shared/ai';
import { generateScript } from './service';

const aiMock = vi.hoisted(() => ({ model: 'deepseek-chat', chat: vi.fn(), stream: vi.fn() }));
vi.mock('../../shared/ai', () => ({ getAiClient: vi.fn(() => aiMock) }));

const projectInput = {
  title: 'Generation project', brief: 'Explain the river mystery.', language: 'en' as const, referencesText: '',
  scriptPresetId: 'documentary' as const, targetDurationSec: 8, chapterCount: 2, voiceId: null,
  aiModel: 'deepseek-flash',
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

const words = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(' ');
const expansion = (paragraphs: string[], styleNote: string, continuity: { chapterSummary?: string; avoidRepeating?: string[]; persistentFactsNext?: string[] } = {}) => JSON.stringify({
  paragraphs,
  styleNote,
  chapterSummary: continuity.chapterSummary ?? 'A chapter summary',
  avoidRepeating: continuity.avoidRepeating ?? ['an established detail'],
  persistentFactsNext: continuity.persistentFactsNext ?? ['a persistent fact'],
});
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
  vi.mocked(getAiClient).mockClear();
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
      .mockResolvedValueOnce(expansion(['short'], 'First style', { chapterSummary: 'First chapter summary', avoidRepeating: ['Do not repeat the river origin'], persistentFactsNext: ['The river changed at dawn'] }))
      .mockResolvedValueOnce(expansion([words(8)], 'Retry style', { chapterSummary: 'First chapter summary', avoidRepeating: ['Do not repeat the river origin'], persistentFactsNext: ['The river changed at dawn'] }))
      .mockResolvedValueOnce(expansion(['short second'], 'Second style'))
      .mockResolvedValueOnce(expansion(['still short'], 'Accepted style'));
    const project = await createProject(projectInput);
    const ctx = context();

    await generateScript(project.id, ctx);

    const saved = await getProject(project.id);
    expect(saved.chapters.map((chapter) => chapter.paragraphs)).toEqual([[words(8)], ['still short']]);
    expect(saved.chapters.map((chapter) => chapter.status)).toEqual(['pending', 'pending']);
    expect(saved.chapters[0]).toMatchObject({ chapterSummary: 'First chapter summary', avoidRepeating: ['Do not repeat the river origin'], persistentFacts: ['The river changed at dawn'] });
    expect(saved.openLoops[0]!.question).toBe('What caused it?');
    expect(saved.coreQuestion).toBe('What is at stake?');
    expect(saved.openingHook).toBe('A compelling opening.');
    expect(aiMock.chat).toHaveBeenCalledTimes(5);
    expect(getAiClient).toHaveBeenCalledWith('deepseek', 'deepseek-flash');
    expect(aiMock.chat.mock.calls[0]![1]).toMatchObject({ json: true, maxTokens: 4000 });
    expect(aiMock.chat.mock.calls[1]![1]).toMatchObject({ json: true, maxTokens: 6000 });
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('Retry style');
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('What caused it?');
    expect(aiMock.chat.mock.calls[1]![0][1].content).toContain('Core question: What is at stake?');
    expect(aiMock.chat.mock.calls[1]![0][1].content).toContain('Opening hook: A compelling opening.');
    expect(aiMock.chat.mock.calls[1]![0][1].content).toContain('Persistent facts: (none)');
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('Core question: What is at stake?');
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('Previous chapter summary: First chapter summary');
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('Avoid repeating: Do not repeat the river origin');
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('Persistent facts: The river changed at dawn');
    expect(aiMock.chat.mock.calls[3]![0][1].content).not.toContain('Opening hook:');
    expect(aiMock.chat.mock.calls[2]![0][1].content).toContain('meaningful progression');
    expect(aiMock.chat.mock.calls[2]![0][1].content).toContain('Do not paraphrase the same content');
    expect(ctx.reportProgress).toHaveBeenCalled();
  });

  it('persists outline core question and opening hook', async () => {
    aiMock.chat
      .mockResolvedValueOnce(JSON.stringify({
        chapters: [{ no: 1, title: 'Opening', role: 'hook', beat: 'Open', targetWords: 1, endsOnTension: false }],
        openLoops: [], coreQuestion: 'Why did the river change?', openingHook: 'At dawn, the river ran backward.',
      }))
      .mockResolvedValueOnce(expansion(['One'], 'Style'));
    const project = await createProject({ ...projectInput, chapterCount: 1 });

    await generateScript(project.id, context());

    await expect(getProject(project.id)).resolves.toMatchObject({
      coreQuestion: 'Why did the river change?',
      openingHook: 'At dawn, the river ran backward.',
    });
  });

  it('persists paragraphs when continuity memory exceeds schema limits and logs truncations', async () => {
    const singleOutline = JSON.stringify({
      chapters: [{ no: 1, title: 'Opening', role: 'hook', beat: 'Open', targetWords: 1, endsOnTension: false }],
      openLoops: [], coreQuestion: 'Why did the river change?', openingHook: 'At dawn, the river ran backward.',
    });
    const paragraphs = ['  Narration must survive memory cleanup.  '];
    const ctx = context();
    aiMock.chat
      .mockResolvedValueOnce(singleOutline)
      .mockResolvedValueOnce(expansion(paragraphs, `  ${'style '.repeat(100)}  `, {
        chapterSummary: 'summary '.repeat(50),
        avoidRepeating: ['avoid '.repeat(20), 'second', 'third', 'fourth', 'fifth', 'discarded', 'discarded'],
        persistentFactsNext: Array.from({ length: 7 }, (_, index) => `fact ${index} ${'detail '.repeat(25)}`),
      }));
    const project = await createProject({ ...projectInput, chapterCount: 1 });

    await generateScript(project.id, ctx);

    const saved = await getProject(project.id);
    expect(saved.chapters[0]).toMatchObject({ paragraphs: paragraphs.map((paragraph) => paragraph.trim()), status: 'pending' });
    expect(saved.chapters[0]!.chapterSummary!.length).toBeLessThanOrEqual(250);
    expect(saved.chapters[0]!.avoidRepeating).toHaveLength(5);
    expect(saved.chapters[0]!.persistentFacts).toHaveLength(5);
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('Truncated chapterSummary from'));
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('Truncated persistentFactsNext from 7 to 5 items'));
    expect(aiMock.chat).toHaveBeenCalledTimes(2);
  });

  it('repairs an invalid outline once and continues with the corrected response', async () => {
    const smallOutline = outline.replaceAll('targetWords":10', 'targetWords":1');
    const invalidOutline = smallOutline.replace('"role":"hook"', '"role":"introduction"');
    aiMock.chat
      .mockResolvedValueOnce(invalidOutline)
      .mockResolvedValueOnce(smallOutline)
      .mockResolvedValueOnce(expansion(['First'], 'First style'))
      .mockResolvedValueOnce(expansion(['Second'], 'Second style'));
    const project = await createProject(projectInput);
    const ctx = context();

    await generateScript(project.id, ctx);

    expect(aiMock.chat).toHaveBeenCalledTimes(4);
    expect(aiMock.chat.mock.calls[1]![0][1].content).toContain(invalidOutline);
    expect(aiMock.chat.mock.calls[1]![0][1].content).toContain('Your JSON was invalid:');
    expect((await getProject(project.id)).status).toBe('script');
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('retrying once'));
  });

  it('fails after one invalid outline repair and logs the final validation details', async () => {
    const invalidOutline = outline.replace('"role":"hook"', '"role":"introduction"');
    aiMock.chat.mockResolvedValueOnce(invalidOutline).mockResolvedValueOnce(invalidOutline);
    const project = await createProject(projectInput);
    const ctx = context();

    await expect(generateScript(project.id, ctx)).rejects.toMatchObject({
      code: 'SCRIPT_PARSE_ERROR',
      message: expect.stringContaining('chapters.0.role:'),
    });
    expect(aiMock.chat).toHaveBeenCalledTimes(2);
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('Raw response (first 400 chars):'));
    expect((await getProject(project.id)).chapters).toEqual([]);
  });

  it('repairs an invalid chapter expansion once before applying length retry logic', async () => {
    const smallOutline = outline.replaceAll('targetWords":10', 'targetWords":1');
    const invalidExpansion = JSON.stringify({ paragraphs: ['First'], styleNote: 'First style', chapterSummary: 'First summary', avoidRepeating: [], persistentFactsNext: ['First fact'], extra: true });
    aiMock.chat
      .mockResolvedValueOnce(smallOutline)
      .mockResolvedValueOnce(invalidExpansion)
      .mockResolvedValueOnce(expansion(['First repaired'], 'First repaired style'))
      .mockResolvedValueOnce(expansion(['Second'], 'Second style'));
    const project = await createProject(projectInput);

    await generateScript(project.id, context());

    expect(aiMock.chat).toHaveBeenCalledTimes(4);
    expect(aiMock.chat.mock.calls[2]![0][1].content).toContain(invalidExpansion);
    expect((await getProject(project.id)).chapters.map((chapter) => chapter.paragraphs)).toEqual([['First repaired'], ['Second']]);
  });

  it('marks a failed chapter needs-fix and continues with later chapters', async () => {
    aiMock.chat
      .mockResolvedValueOnce(outline.replaceAll('targetWords":10', 'targetWords":1'))
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce(expansion(['Later chapter'], 'Later style'))
      .mockResolvedValueOnce(expansion(['Later retry'], 'Later retry style'));
    const project = await createProject(projectInput);

    await generateScript(project.id, context());

    const saved = await getProject(project.id);
    expect(saved.chapters.map((chapter) => chapter.status)).toEqual(['needs-fix', 'pending']);
    expect(saved.chapters[1]!.paragraphs).toEqual(['Later chapter']);
    expect(saved.chapters[0]).toMatchObject({ chapterSummary: null, avoidRepeating: [], persistentFacts: [], status: 'needs-fix' });
  });

  it('stops before a chapter call when cancellation is requested', async () => {
    aiMock.chat.mockResolvedValueOnce(outline);
    const checks = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const project = await createProject(projectInput);

    await generateScript(project.id, context({ isCancelled: checks }));

    expect(aiMock.chat).toHaveBeenCalledTimes(1);
  });

  it('rejects an explicit chapter-count mismatch before outline persistence', async () => {
    const invalid = JSON.stringify({
      chapters: [{ no: 1, title: 'Only chapter', role: 'hook', beat: 'Open', targetWords: 1, endsOnTension: false }],
      openLoops: [], coreQuestion: 'What is at stake?', openingHook: 'A compelling opening.',
    });
    aiMock.chat.mockResolvedValueOnce(invalid).mockResolvedValueOnce(invalid);
    const project = await createProject(projectInput);

    await expect(generateScript(project.id, context())).rejects.toMatchObject({ code: 'SCRIPT_PARSE_ERROR' });
    expect((await getProject(project.id)).chapters).toEqual([]);
  });

  it('discards a valid expansion when cancellation arrives before the write', async () => {
    aiMock.chat
      .mockResolvedValueOnce(outline.replaceAll('targetWords":10', 'targetWords":1'))
      .mockResolvedValueOnce(expansion(['Should not persist'], 'Style'));
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
      .mockResolvedValueOnce(expansion(['One'], 'Style one'))
      .mockResolvedValueOnce(expansion(['Two'], 'Style two'))
      .mockResolvedValueOnce(expansion(['Three'], 'Style three'));
    const project = await createProject({ ...projectInput, chapterCount: 3, targetDurationSec: 12 });

    await generateScript(project.id, context());

    expect(aiMock.chat.mock.calls[2]![0][1].content).toContain('Relevant to the opening?');
    expect(aiMock.chat.mock.calls[2]![0][1].content).not.toContain('Only for the ending?');
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('Only for the ending?');
  });
});
