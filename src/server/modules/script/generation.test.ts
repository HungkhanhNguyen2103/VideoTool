import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, getProject, getProjectHistory } from '../project';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { getCollection } from '../../db/client';
import { getAiClient } from '../../shared/ai';
import { generateScript } from './service';

const aiMock = vi.hoisted(() => ({ model: 'deepseek-chat', chat: vi.fn(), chatWithMetadata: vi.fn(), stream: vi.fn() }));
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
  aiMock.chatWithMetadata.mockReset();
  aiMock.chatWithMetadata.mockImplementation(async (messages, opts) => ({ text: await aiMock.chat(messages, opts), truncated: false }));
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
  it('uses an injected chat backend for outline and chapter generation with the existing saved structure', async () => {
    const backendChat = vi.fn()
      .mockResolvedValueOnce({ text: outline, truncated: false })
      .mockResolvedValueOnce({ text: expansion([words(9)], 'CLI chapter one'), truncated: false })
      .mockResolvedValueOnce({ text: expansion([words(9)], 'CLI chapter two'), truncated: false });
    aiMock.chat
      .mockResolvedValueOnce(outline)
      .mockResolvedValueOnce(expansion([words(9)], 'API chapter one'))
      .mockResolvedValueOnce(expansion([words(9)], 'API chapter two'));
    const project = await createProject(projectInput);

    await generateScript(project.id, context(), { backend: { label: 'claude-cli:default', chat: backendChat } } as never);

    expect(backendChat).toHaveBeenCalledTimes(3);
    expect(aiMock.chat).not.toHaveBeenCalled();
    const saved = await getProject(project.id);
    expect(saved.chapters.map((chapter) => chapter.paragraphs)).toEqual([[words(9)], [words(9)]]);
    expect(saved.chapters.map(({ no, title, role, targetWords, status }) => ({ no, title, role, targetWords, status }))).toEqual([
      { no: 1, title: 'Opening', role: 'hook', targetWords: 10, status: 'pending' },
      { no: 2, title: 'Answer', role: 'resolution', targetWords: 10, status: 'pending' },
    ]);
  });

  it('expands chapters in order, retries short responses once, carries style and open loops, and reports progress', async () => {
    aiMock.chat
      .mockResolvedValueOnce(outline)
      .mockResolvedValueOnce(expansion(['short'], 'First style', { chapterSummary: 'First chapter summary', avoidRepeating: ['Do not repeat the river origin'], persistentFactsNext: ['The river changed at dawn'] }))
      .mockResolvedValueOnce(expansion([words(9)], 'Retry style', { chapterSummary: 'First chapter summary', avoidRepeating: ['Do not repeat the river origin'], persistentFactsNext: ['The river changed at dawn'] }))
      .mockResolvedValueOnce(expansion(['short second'], 'Second style'))
      .mockResolvedValueOnce(expansion([words(9)], 'Accepted style'));
    const project = await createProject(projectInput);
    const ctx = context();

    await generateScript(project.id, ctx);

    const saved = await getProject(project.id);
    expect(saved.chapters.map((chapter) => chapter.paragraphs)).toEqual([[words(9)], [words(9)]]);
    expect(saved.chapters.map((chapter) => chapter.status)).toEqual(['pending', 'pending']);
    expect(saved.chapters[0]).toMatchObject({ chapterSummary: 'First chapter summary', avoidRepeating: ['Do not repeat the river origin'], persistentFacts: ['The river changed at dawn'] });
    expect(saved.openLoops[0]!.question).toBe('What caused it?');
    expect(saved.coreQuestion).toBe('What is at stake?');
    expect(saved.openingHook).toBe('A compelling opening.');
    expect(aiMock.chat).toHaveBeenCalledTimes(5);
    expect(getAiClient).toHaveBeenCalledWith('deepseek', 'deepseek-flash');
    expect(aiMock.chat.mock.calls[0]![1]).toMatchObject({ json: true, maxTokens: 3100 });
    expect(aiMock.chat.mock.calls[1]![1]).toMatchObject({ json: true, maxTokens: 3000 });
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('Retry style');
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('What caused it?');
    expect(aiMock.chat.mock.calls[1]![0][1].content).toContain('Core question: What is at stake?');
    expect(aiMock.chat.mock.calls[1]![0][1].content).toContain('Opening hook: A compelling opening.');
    expect(aiMock.chat.mock.calls[1]![0][1].content).toContain('Persistent facts (complete next state, max 10): (none)');
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('Core question: What is at stake?');
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('Story so far: Chapter 1 — First chapter summary');
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('Avoid repeating (latest 30): Do not repeat the river origin');
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('Persistent facts (complete next state, max 10): The river changed at dawn');
    expect(aiMock.chat.mock.calls[2]![0][1].content).toContain('actual 1 words versus target 10');
    expect(aiMock.chat.mock.calls[2]![0][1].content).toContain('Never invent facts');
    expect(ctx.reportProgress).toHaveBeenCalled();
  });

  it('persists outline core question and opening hook', async () => {
    aiMock.chat
      .mockResolvedValueOnce(JSON.stringify({
        chapters: [{ no: 1, title: 'Opening', role: 'hook', beat: 'Open', targetWords: 5, endsOnTension: false }],
        openLoops: [], coreQuestion: 'Why did the river change?', openingHook: 'At dawn, the river ran backward.',
      }))
      .mockResolvedValueOnce(expansion(['One two three four five'], 'Style'));
    const project = await createProject({ ...projectInput, targetDurationSec: 2, chapterCount: 1 });

    await generateScript(project.id, context());

    await expect(getProject(project.id)).resolves.toMatchObject({
      coreQuestion: 'Why did the river change?',
      openingHook: 'At dawn, the river ran backward.',
    });
  });

  it('persists paragraphs when continuity memory exceeds schema limits and logs truncations', async () => {
    const singleOutline = JSON.stringify({
      chapters: [{ no: 1, title: 'Opening', role: 'hook', beat: 'Open', targetWords: 5, endsOnTension: false }],
      openLoops: [], coreQuestion: 'Why did the river change?', openingHook: 'At dawn, the river ran backward.',
    });
    const paragraphs = ['  Narration must survive memory cleanup.  '];
    const ctx = context();
    aiMock.chat
      .mockResolvedValueOnce(singleOutline)
      .mockResolvedValueOnce(expansion(paragraphs, `  ${'style '.repeat(100)}  `, {
        chapterSummary: 'summary '.repeat(50),
        avoidRepeating: ['avoid '.repeat(20), 'second', 'third', 'fourth', 'fifth', 'discarded', 'discarded'],
        persistentFactsNext: Array.from({ length: 12 }, (_, index) => `fact ${index} ${'detail '.repeat(25)}`),
      }));
    const project = await createProject({ ...projectInput, targetDurationSec: 2, chapterCount: 1 });

    await generateScript(project.id, ctx);

    const saved = await getProject(project.id);
    expect(saved.chapters[0]).toMatchObject({ paragraphs: paragraphs.map((paragraph) => paragraph.trim()), status: 'pending' });
    expect(saved.chapters[0]!.chapterSummary!.length).toBeLessThanOrEqual(250);
    expect(saved.chapters[0]!.avoidRepeating).toHaveLength(5);
    expect(saved.chapters[0]!.persistentFacts).toHaveLength(10);
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('Truncated chapterSummary from'));
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('Truncated persistentFactsNext from 12 to 10 items'));
    expect(aiMock.chat).toHaveBeenCalledTimes(2);
  });

  it('repairs an invalid outline once and continues with the corrected response', async () => {
    const smallOutline = outline;
    const invalidOutline = smallOutline.replace('"role":"hook"', '"role":"introduction"');
    aiMock.chat
      .mockResolvedValueOnce(invalidOutline)
      .mockResolvedValueOnce(smallOutline)
      .mockResolvedValueOnce(expansion([words(9)], 'First style'))
      .mockResolvedValueOnce(expansion([words(9)], 'Second style'));
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
    const smallOutline = outline;
    const invalidExpansion = JSON.stringify({ paragraphs: ['First'], styleNote: 'First style', chapterSummary: 'First summary', avoidRepeating: [], persistentFactsNext: ['First fact'], extra: true });
    aiMock.chat
      .mockResolvedValueOnce(smallOutline)
      .mockResolvedValueOnce(invalidExpansion)
      .mockResolvedValueOnce(expansion([words(9)], 'First repaired style'))
      .mockResolvedValueOnce(expansion([words(9)], 'Second style'));
    const project = await createProject(projectInput);

    await generateScript(project.id, context());

    expect(aiMock.chat).toHaveBeenCalledTimes(4);
    expect(aiMock.chat.mock.calls[2]![0][1].content).toContain(invalidExpansion);
    expect((await getProject(project.id)).chapters.map((chapter) => chapter.paragraphs)).toEqual([[words(9)], [words(9)]]);
  });

  it('stops after a hard chapter failure and leaves later chapters empty', async () => {
    aiMock.chat
      .mockResolvedValueOnce(outline)
      .mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { status: 401 }));
    const project = await createProject(projectInput);

    await expect(generateScript(project.id, context())).rejects.toMatchObject({ status: 401 });

    const saved = await getProject(project.id);
    expect(saved.chapters.map((chapter) => chapter.status)).toEqual(['needs-fix', 'pending']);
    expect(saved.chapters[1]!.paragraphs).toEqual([]);
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
      .mockResolvedValueOnce(outline)
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

  it('passes every open loop with its state for each expansion prompt', async () => {
    const threeChapterOutline = JSON.stringify({
      chapters: [
        { no: 1, title: 'Opening', role: 'hook', beat: 'Open', targetWords: 10, endsOnTension: true },
        { no: 2, title: 'Middle', role: 'rising', beat: 'Develop', targetWords: 10, endsOnTension: true },
        { no: 3, title: 'End', role: 'resolution', beat: 'Close', targetWords: 10, endsOnTension: false },
      ],
      openLoops: [
        { question: 'Relevant to the opening?', plantedInChapter: 1, resolvedInChapter: 2 },
        { question: 'Only for the ending?', plantedInChapter: 1, resolvedInChapter: 3 },
      ],
      coreQuestion: 'What is at stake?',
      openingHook: 'A compelling opening.',
    });
    aiMock.chat
      .mockResolvedValueOnce(threeChapterOutline)
      .mockResolvedValueOnce(expansion([words(9)], 'Style one'))
      .mockResolvedValueOnce(expansion([words(9)], 'Style two'))
      .mockResolvedValueOnce(expansion([words(9)], 'Style three'));
    const project = await createProject({ ...projectInput, chapterCount: 3, targetDurationSec: 12 });

    await generateScript(project.id, context());

    expect(aiMock.chat.mock.calls[1]![0][1].content).toContain('Relevant to the opening? — plant');
    expect(aiMock.chat.mock.calls[1]![0][1].content).toContain('Only for the ending? — plant');
    expect(aiMock.chat.mock.calls[2]![0][1].content).toContain('Relevant to the opening? — resolve');
    expect(aiMock.chat.mock.calls[2]![0][1].content).toContain('Only for the ending? — pending');
  });

  it('retries a response below 85% and accepts the first response inside the 85–115% window', async () => {
    aiMock.chat
      .mockResolvedValueOnce(outline)
      .mockResolvedValueOnce(expansion([words(8)], 'Short'))
      .mockResolvedValueOnce(expansion([words(9)], 'In range'))
      .mockResolvedValueOnce(expansion([words(9)], 'Second in range'));
    const project = await createProject(projectInput);

    await generateScript(project.id, context());

    expect((await getProject(project.id)).chapters.map((item) => countWords(item.paragraphs))).toEqual([9, 9]);
    expect(aiMock.chat).toHaveBeenCalledTimes(4);
    expect(aiMock.chat.mock.calls[2]![0][1].content).toContain('8 words');
    expect(aiMock.chat.mock.calls[2]![0][1].content).toContain('versus target 10 words');
  });

  it('uses two length retries, keeps the closest result, adjusts the remaining budget, and logs the final total', async () => {
    aiMock.chat
      .mockResolvedValueOnce(outline)
      .mockResolvedValueOnce(expansion([words(14)], 'Too long'))
      .mockResolvedValueOnce(expansion([words(7)], 'Too short'))
      .mockResolvedValueOnce(expansion([words(12)], 'Closest'))
      .mockResolvedValueOnce(expansion([words(9)], 'Second chapter'));
    const project = await createProject(projectInput);
    const ctx = context();

    await generateScript(project.id, ctx);

    const saved = await getProject(project.id);
    expect(saved.chapters[0]!.paragraphs).toEqual([words(12)]);
    expect(aiMock.chat).toHaveBeenCalledTimes(5);
    expect(aiMock.chat.mock.calls[2]![0][1].content).toContain('actual 14 words versus target 10');
    expect(aiMock.chat.mock.calls[3]![0][1].content).toContain('actual 7 words versus target 10');
    expect(aiMock.chat.mock.calls[4]![0][1].content).toContain('Remaining total budget is 8 words');
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('accepted the closest result at 12 words'));
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('Final narration total: 21 words versus 20-word budget'));
  });

  it('retries transient chapter errors with bounded backoff and stops immediately on hard provider errors', async () => {
    const project = await createProject(projectInput);
    aiMock.chat.mockResolvedValueOnce(outline)
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 503 }))
      .mockResolvedValueOnce(expansion([words(9)], 'Recovered'))
      .mockResolvedValueOnce(expansion([words(9)], 'Second'));
    const ctx = context();

    await generateScript(project.id, ctx);

    expect((await getProject(project.id)).chapters.map((item) => item.status)).toEqual(['pending', 'pending']);
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('transient failure; retrying after 500 ms'));

    await getCollection('projects').deleteMany({});
    aiMock.chat.mockReset().mockResolvedValueOnce(outline).mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { status: 401 }));
    const hardProject = await createProject(projectInput);
    const hardContext = context();
    await expect(generateScript(hardProject.id, hardContext)).rejects.toMatchObject({ status: 401 });
    expect(aiMock.chat).toHaveBeenCalledTimes(2);
    expect((await getProject(hardProject.id)).chapters[1]!.paragraphs).toEqual([]);
  });

  it('stops after chapter retries are exhausted and resumes at the first empty chapter without an outline call', async () => {
    const project = await createProject(projectInput);
    const initialContext = context();
    aiMock.chat.mockResolvedValueOnce(outline)
      .mockResolvedValueOnce(expansion([words(9)], 'First chapter'))
      .mockRejectedValueOnce(Object.assign(new Error('busy 1'), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error('busy 2'), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error('busy 3'), { status: 503 }));

    await expect(generateScript(project.id, initialContext)).rejects.toMatchObject({ status: 503 });

    const beforeResume = await getProject(project.id);
    const earlierParagraphs = [...beforeResume.chapters[0]!.paragraphs];
    const earlierHistory = await getProjectHistory(project.id);
    expect(beforeResume.chapters.map((item) => item.status)).toEqual(['pending', 'needs-fix']);
    expect(aiMock.chat).toHaveBeenCalledTimes(5);
    expect(initialContext.appendLog).toHaveBeenCalledWith(expect.stringContaining('retrying after 500 ms'));
    expect(initialContext.appendLog).toHaveBeenCalledWith(expect.stringContaining('retrying after 1000 ms'));
    aiMock.chat.mockResolvedValueOnce(expansion([words(9)], 'Resumed second'));

    await generateScript(project.id, context(), { resume: true });

    const resumed = await getProject(project.id);
    expect(aiMock.chat).toHaveBeenCalledTimes(6);
    expect(aiMock.chat.mock.calls[5]![0][1].content).toContain('Chapter 2: Answer');
    expect(resumed.chapters[0]!.paragraphs).toEqual(earlierParagraphs);
    expect(resumed.chapters.map((item) => item.status)).toEqual(['pending', 'pending']);
    expect(await getProjectHistory(project.id)).toEqual(earlierHistory);
  });

  it('resumes an API outline with the CLI backend without rewriting completed chapters', async () => {
    const project = await createProject(projectInput);
    aiMock.chat.mockResolvedValueOnce(outline)
      .mockResolvedValueOnce(expansion([words(9)], 'API first'))
      .mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { status: 401 }));
    await expect(generateScript(project.id, context())).rejects.toMatchObject({ status: 401 });
    const firstChapter = (await getProject(project.id)).chapters[0]!.paragraphs;
    const backendChat = vi.fn().mockResolvedValueOnce({ text: expansion([words(9)], 'CLI second'), truncated: false });

    await generateScript(project.id, context(), {
      resume: true,
      backend: { label: 'claude-cli:claude-sonnet-5-5', model: 'claude-sonnet-5-5', chat: backendChat },
    });

    expect(backendChat).toHaveBeenCalledTimes(1);
    expect(backendChat.mock.calls[0]![0][1].content).toContain('Chapter 2: Answer');
    expect(aiMock.chat).toHaveBeenCalledTimes(3);
    expect((await getProject(project.id)).chapters.map((chapter) => chapter.paragraphs)).toEqual([firstChapter, [words(9)]]);
  });

  it('resumes a partial CLI run with the API backend without making another outline call', async () => {
    const project = await createProject(projectInput);
    const backendChat = vi.fn()
      .mockResolvedValueOnce({ text: outline, truncated: false })
      .mockResolvedValueOnce({ text: expansion([words(9)], 'CLI first'), truncated: false })
      .mockRejectedValueOnce(Object.assign(new Error('CLI authentication failed'), { status: 401, code: 'CLAUDE_CLI_AUTH_FAILED' }));
    await expect(generateScript(project.id, context(), {
      backend: { label: 'claude-cli:default', model: 'default', chat: backendChat },
    })).rejects.toMatchObject({ code: 'CLAUDE_CLI_AUTH_FAILED' });
    const firstChapter = (await getProject(project.id)).chapters[0]!.paragraphs;
    aiMock.chat.mockResolvedValueOnce(expansion([words(9)], 'API second'));

    await generateScript(project.id, context(), { resume: true });

    expect(backendChat).toHaveBeenCalledTimes(3);
    expect(aiMock.chat).toHaveBeenCalledTimes(1);
    expect(aiMock.chat.mock.calls[0]![0][1].content).toContain('Chapter 2: Answer');
    expect((await getProject(project.id)).chapters.map((chapter) => chapter.paragraphs)).toEqual([firstChapter, [words(9)]]);
  });

  it('runs a synthetic 20-minute, 10-chapter script through truncation and transient recovery', async () => {
    const chapters = Array.from({ length: 10 }, (_, index) => ({
      no: index + 1, title: `Chapter ${index + 1}`, role: index === 0 ? 'hook' : index === 9 ? 'resolution' : 'rising',
      beat: `Advance evidence ${index + 1}.`, targetWords: 300, endsOnTension: index < 9,
      sourceFacts: [`Evidence ${index + 1} [1]`], holdBack: [],
    }));
    const longOutline = JSON.stringify({
      chapters, coreQuestion: 'What changed?', openingHook: 'The river reversed.',
      openLoops: [
        { question: 'Cause one?', plantedInChapter: 1, resolvedInChapter: 3 },
        { question: 'Cause two?', plantedInChapter: 2, resolvedInChapter: 5 },
        { question: 'Cause three?', plantedInChapter: 4, resolvedInChapter: 7 },
        { question: 'Cause four?', plantedInChapter: 6, resolvedInChapter: 9 },
      ],
    });
    const project = await createProject({ ...projectInput, targetDurationSec: 1200, chapterCount: 10 });
    const metadataCalls = [
      { text: longOutline, truncated: false },
      { text: expansion([words(260)], 'Truncated candidate'), truncated: true },
      { text: expansion([words(260)], 'Recovered truncation'), truncated: false },
      { text: expansion([words(260)], 'Chapter 2'), truncated: false },
      { text: expansion([words(260)], 'Chapter 3'), truncated: false },
      Object.assign(new Error('temporary 503'), { status: 503 }),
      { text: expansion([words(260)], 'Chapter 4 recovered'), truncated: false },
      ...Array.from({ length: 6 }, (_, index) => ({ text: expansion([words(260)], `Chapter ${index + 5}`), truncated: false })),
    ];
    aiMock.chatWithMetadata.mockImplementation(async () => {
      const next = metadataCalls.shift();
      if (next instanceof Error) throw next;
      if (!next) throw new Error('unexpected extra AI call');
      return next;
    });
    const ctx = context();

    await generateScript(project.id, ctx);

    const saved = await getProject(project.id);
    expect(saved.chapters).toHaveLength(10);
    expect(saved.chapters.every((item) => item.paragraphs.length === 1 && item.status === 'pending')).toBe(true);
    expect(metadataCalls).toHaveLength(0);
    expect(aiMock.chatWithMetadata).toHaveBeenCalledTimes(13);
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('truncated at'));
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('Final narration total: 2600 words versus 3000-word budget'));
  });

  it('derives missing continuity summaries from the first and last narration sentences and logs the fallback', async () => {
    const threeChapterOutline = JSON.stringify({
      chapters: [
        { no: 1, title: 'First', role: 'hook', beat: 'Open.', targetWords: 10, endsOnTension: true },
        { no: 2, title: 'Middle', role: 'rising', beat: 'Develop.', targetWords: 10, endsOnTension: true },
        { no: 3, title: 'End', role: 'resolution', beat: 'Close.', targetWords: 10, endsOnTension: false },
      ], openLoops: [{ question: 'Why?', plantedInChapter: 1, resolvedInChapter: 3 }], coreQuestion: 'Why?', openingHook: 'At dawn.',
    });
    aiMock.chat.mockResolvedValueOnce(threeChapterOutline)
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: ['The water rose at dawn. The town woke to its sound.'], styleNote: 'Style', chapterSummary: '', avoidRepeating: [], persistentFactsNext: [] }))
      .mockResolvedValueOnce(expansion([words(9)], 'Middle'))
      .mockResolvedValueOnce(expansion([words(9)], 'End'));
    const project = await createProject({ ...projectInput, chapterCount: 3, targetDurationSec: 12 });
    const ctx = context();

    await generateScript(project.id, ctx);

    const middlePrompt = aiMock.chat.mock.calls[2]![0][1].content;
    expect(middlePrompt).toContain('The water rose at dawn. The town woke to its sound.');
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.stringContaining('derived a continuity summary for chapter 1'));
  });
});

function countWords(paragraphs: string[]): number {
  return paragraphs.join(' ').trim().split(/\s+/u).filter(Boolean).length;
}
