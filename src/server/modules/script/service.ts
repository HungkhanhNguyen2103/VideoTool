import { z } from 'zod';
import type { ProjectDetail } from '../../../contracts/project';
import type { ChapterDoc, ChapterSnapshot } from '../../../contracts/script';
import { getAiClient } from '../../shared/ai';
import { AppError, NotFound } from '../../shared/errors';
import { newId } from '../../shared/ids';
import {
  getProject,
  getProjectHistory,
  patchProjectChapter,
  replaceProjectChapters,
  replaceProjectScenes,
  restoreProjectChapters,
} from '../project';
import type { SceneDoc } from '../project';
import { buildRegenerationPrompt, buildScriptPrompt } from './prompts';

const GeneratedChapterSchema = z.object({
  no: z.number().int().positive(),
  title: z.string(),
  paragraphs: z.array(z.string()).min(1),
  scenesCount: z.null(),
  durationSec: z.null(),
});

const RegeneratedParagraphsSchema = z.union([
  z.array(z.string()).min(1),
  z.object({ paragraphs: z.array(z.string()).min(1) }).transform((value) => value.paragraphs),
]);

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

function scriptParseError(): AppError {
  return new AppError('AI returned invalid script structure.', 422, 'SCRIPT_PARSE_ERROR');
}

function snapshotOf(chapters: ChapterDoc[]): ChapterSnapshot {
  return { takenAt: new Date(), chapters: chapters.map((chapter) => ({ ...chapter, paragraphs: [...chapter.paragraphs] })) };
}

export async function patchChapter(
  projectId: string,
  chapterId: string,
  patch: Partial<Pick<ChapterDoc, 'paragraphs' | 'status' | 'title'>>,
): Promise<ChapterDoc[]> {
  const project = await getProject(projectId);
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new NotFound('Không tìm thấy chương.');
  const normalizedPatch = patch.paragraphs ? { ...patch, status: 'pending' as const } : patch;
  const updated = await patchProjectChapter(projectId, chapterId, normalizedPatch, snapshotOf(project.chapters));
  return updated.chapters;
}

export async function getChapterHistory(projectId: string): Promise<ChapterSnapshot[]> {
  return getProjectHistory(projectId);
}

export async function restoreChapters(projectId: string, index: number): Promise<ChapterDoc[]> {
  const project = await getProject(projectId);
  const history = await getChapterHistory(projectId);
  const snapshot = history[index];
  if (!snapshot) throw new AppError('History snapshot not found.', 422, 'INVALID_HISTORY_INDEX');
  const updated = await restoreProjectChapters(projectId, snapshot.chapters, snapshotOf(project.chapters));
  return updated.chapters;
}

export async function generateScript(projectId: string, appendLog: (message: string) => Promise<void>): Promise<void> {
  const project = await getProject(projectId);
  await appendLog('Loading project and AI client…');
  const aiClient = getAiClient(project.aiProvider);
  const prompt = buildScriptPrompt(project);
  await appendLog('Sending request to AI…');
  const raw = await aiClient.chat([
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ]);
  await appendLog('Parsing AI response…');

  let parsed: unknown;
  try {
    parsed = parseJson(raw);
  } catch {
    throw scriptParseError();
  }
  const chapters = z.array(GeneratedChapterSchema).safeParse(parsed);
  if (!chapters.success || chapters.data.length === 0) throw scriptParseError();
  const saved: ChapterDoc[] = chapters.data.map((chapter, index) => ({
    ...chapter,
    id: newId(),
    no: index + 1,
    status: 'pending',
  }));
  await replaceProjectChapters(projectId, saved, null, 'script');
  await appendLog(`Script saved — ${saved.length} chapters.`);
}

export async function regenerateChapter(
  projectId: string,
  chapterId: string,
  opts: { instruction: string; level: 'light' | 'medium' | 'rewrite' },
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<ChapterDoc> {
  const project = await getProject(projectId);
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new NotFound('Không tìm thấy chương.');
  const snapshot = snapshotOf(project.chapters);
  await patchProjectChapter(projectId, chapterId, { status: 'generating' }, snapshot);

  try {
    const prompt = buildRegenerationPrompt(project, chapter, opts.instruction, opts.level);
    let raw = '';
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    for await (const chunk of getAiClient(project.aiProvider).stream([
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ], { signal })) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      raw += chunk;
      onChunk(chunk);
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    let parsed: unknown;
    try {
      parsed = parseJson(raw);
    } catch {
      throw scriptParseError();
    }
    const paragraphs = RegeneratedParagraphsSchema.safeParse(parsed);
    if (!paragraphs.success) throw scriptParseError();
    const updated: ChapterDoc = { ...chapter, paragraphs: paragraphs.data, status: 'pending' };
    const result = await patchProjectChapter(projectId, chapterId, { paragraphs: updated.paragraphs, status: updated.status });
    return result.chapters.find((item) => item.id === chapterId) ?? updated;
  } catch (error) {
    const aborted = signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
    await patchProjectChapter(projectId, chapterId, { status: 'needs-fix' });
    if (aborted && error instanceof DOMException) throw error;
    throw error;
  }
}

function sceneDurations(target: number, count: number): number[] {
  const base = Math.floor(target / count);
  const remainder = target - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

export async function finalizeScript(projectId: string): Promise<void> {
  const project: ProjectDetail = await getProject(projectId);
  if (project.chapters.length === 0) {
    throw new AppError('At least one chapter is required before finalizing.', 422, 'NO_CHAPTERS');
  }
  if (project.chapters.some((chapter) => chapter.status !== 'approved')) {
    throw new AppError('All chapters must be approved before finalizing.', 422, 'NOT_ALL_APPROVED');
  }
  const snapshot = snapshotOf(project.chapters);
  const paragraphCount = project.chapters.reduce((sum, chapter) => sum + Math.max(chapter.paragraphs.length, 1), 0);
  const durations = sceneDurations(project.targetDurationSec, paragraphCount);
  let durationIndex = 0;
  const scenes: SceneDoc[] = [];
  const finalizedChapters = project.chapters.map((chapter) => {
    const paragraphs = chapter.paragraphs.length ? chapter.paragraphs : [''];
    const chapterDurations = durations.slice(durationIndex, durationIndex + paragraphs.length);
    durationIndex += paragraphs.length;
    scenes.push(...paragraphs.map((narration, index) => ({
      id: newId(),
      narration,
      visualPrompt: '',
      durationSec: chapterDurations[index]!,
    })));
    return { ...chapter, scenesCount: paragraphs.length, durationSec: chapterDurations.reduce((sum, value) => sum + value, 0) };
  });
  await replaceProjectChapters(projectId, finalizedChapters, snapshot);
  await replaceProjectScenes(projectId, scenes, 'assets');
}
