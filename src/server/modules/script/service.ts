import type { ProjectDetail } from '../../../contracts/project';
import { estimateNarrationDurationSec, type ChapterDoc, type ChapterSnapshot, type HubrisMotif, type OpenLoop } from '../../../contracts/script';
import { getAiClient } from '../../shared/ai';
import { AppError, NotFound } from '../../shared/errors';
import { newId } from '../../shared/ids';
import {
  getProject,
  getProjectHistory,
  patchProjectChapter,
  replaceProjectChapters,
  replaceProjectScript,
  replaceProjectScenes,
  restoreProjectChapters,
} from '../project';
import type { SceneDoc } from '../project';
import { buildChapterExpansionPrompt, buildOutlinePrompt, buildRegenerationPrompt } from './ai/build-prompt';
import { parseChapterExpansion, parseRegeneratedParagraphs, parseScriptOutline, validateScriptOutlineChapterCount } from './ai/parse-output';
import { countNarrationWords } from '../../../contracts/script';

export function snapshotOf(chapters: ChapterDoc[]): ChapterSnapshot {
  return { takenAt: new Date(), chapters: chapters.map((chapter) => ({ ...chapter, paragraphs: [...chapter.paragraphs] })) };
}

function paragraphsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((paragraph, index) => paragraph === right[index]);
}

export async function patchChapter(
  projectId: string,
  chapterId: string,
  patch: Partial<Pick<ChapterDoc, 'paragraphs' | 'status' | 'title'>>,
): Promise<ChapterDoc[]> {
  const project = await getProject(projectId);
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new NotFound('Không tìm thấy chương.');
  const paragraphsChanged = patch.paragraphs !== undefined && !paragraphsEqual(patch.paragraphs, chapter.paragraphs);
  const titleChanged = patch.title !== undefined && patch.title !== chapter.title;
  const normalizedPatch = {
    ...(paragraphsChanged ? { paragraphs: patch.paragraphs, status: 'pending' as const } : {}),
    ...(titleChanged ? { title: patch.title } : {}),
    ...(!paragraphsChanged && patch.status !== undefined ? { status: patch.status } : {}),
  };
  if (Object.keys(normalizedPatch).length === 0) return project.chapters;
  const updated = await patchProjectChapter(projectId, chapterId, normalizedPatch, paragraphsChanged || titleChanged ? snapshotOf(project.chapters) : null);
  if (paragraphsChanged) {
    const nextChapter = project.chapters.find((item) => item.no === chapter.no + 1);
    if (nextChapter) await patchProjectChapter(projectId, nextChapter.id, { reviewStatus: 'upstream-changed' });
  }
  return paragraphsChanged ? (await getProject(projectId)).chapters : updated.chapters;
}

export async function getChapterHistory(projectId: string): Promise<ChapterSnapshot[]> {
  return getProjectHistory(projectId);
}

export type GeneratedScriptChapter = Pick<ChapterDoc, 'no' | 'title' | 'paragraphs'> &
  Partial<Pick<ChapterDoc, 'scenesCount' | 'durationSec' | 'role' | 'beat' | 'targetWords' | 'endsOnTension' | 'chapterSummary' | 'avoidRepeating' | 'persistentFacts' | 'reviewStatus'>>;

export type ScriptGenerationJobContext = {
  reportProgress: (pct: number, result?: unknown) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
};

export async function saveGeneratedScript(
  projectId: string,
  chapters: GeneratedScriptChapter[],
  openLoops: OpenLoop[] = [],
  motif: HubrisMotif | null = null,
  coreQuestion = '',
  openingHook = '',
  snapshot: ChapterSnapshot | null = null,
): Promise<ProjectDetail> {
  const saved: ChapterDoc[] = chapters.map((chapter, index) => ({
    ...chapter,
    id: newId(),
    no: index + 1,
    status: 'pending',
    scenesCount: chapter.scenesCount ?? null,
    durationSec: chapter.durationSec ?? null,
    role: chapter.role ?? null,
    beat: chapter.beat ?? '',
    targetWords: chapter.targetWords ?? null,
    endsOnTension: chapter.endsOnTension ?? false,
    chapterSummary: chapter.chapterSummary ?? null,
    avoidRepeating: chapter.avoidRepeating ?? [],
    persistentFacts: chapter.persistentFacts ?? [],
    reviewStatus: chapter.reviewStatus ?? 'clean',
  }));
  return replaceProjectScript(projectId, saved, openLoops, motif, coreQuestion, openingHook, snapshot, 'script');
}

export async function restoreChapters(projectId: string, index: number): Promise<ChapterDoc[]> {
  const project = await getProject(projectId);
  const history = await getChapterHistory(projectId);
  const snapshot = history[index];
  if (!snapshot) throw new AppError('History snapshot not found.', 422, 'INVALID_HISTORY_INDEX');
  const updated = await restoreProjectChapters(projectId, snapshot.chapters, snapshotOf(project.chapters));
  return updated.chapters;
}

export async function generateScript(projectId: string, context: ScriptGenerationJobContext): Promise<void> {
  const project = await getProject(projectId);
  await context.appendLog('Loading project and AI client…');
  const aiClient = getAiClient(project.aiProvider);
  if (await context.isCancelled()) return;
  const outlinePrompt = buildOutlinePrompt(project);
  await context.appendLog('Sending outline request to AI…');
  const outlineRaw = await aiClient.chat([
    { role: 'system', content: outlinePrompt.system },
    { role: 'user', content: outlinePrompt.user },
  ]);
  if (await context.isCancelled()) return;
  const outline = validateScriptOutlineChapterCount(parseScriptOutline(outlineRaw, project.scriptPresetId), project.chapterCount);
  const saved = await saveGeneratedScript(projectId, outline.chapters.map((chapter) => ({
    ...chapter,
    paragraphs: [],
    scenesCount: null,
    durationSec: null,
  })), outline.openLoops, 'motif' in outline ? outline.motif : null, outline.coreQuestion, outline.openingHook);
  await context.reportProgress(0, { chapters: saved.chapters.length });

  let styleNote = '';
  for (const [index, chapter] of saved.chapters.entries()) {
    if (await context.isCancelled()) return;
    try {
      const openLoops = outline.openLoops.filter((loop) => loop.plantedInChapter === chapter.no || loop.resolvedInChapter === chapter.no);
      const previousChapter = saved.chapters[index - 1];
      const input = {
        project,
        chapter,
        coreQuestion: outline.coreQuestion,
        openingHook: index === 0 ? outline.openingHook : null,
        previousChapterSummary: previousChapter?.chapterSummary ?? null,
        previousAvoidRepeating: previousChapter?.avoidRepeating ?? [],
        previousPersistentFacts: previousChapter?.persistentFacts ?? [],
        openLoops,
        styleNote,
      };
      const prompt = buildChapterExpansionPrompt(input);
      await context.appendLog(`Expanding chapter ${index + 1}/${saved.chapters.length}…`);
      const raw = await aiClient.chat([
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ]);
      if (await context.isCancelled()) return;
      let expansion = parseChapterExpansion(raw);
      if (chapter.targetWords !== null && countNarrationWords(expansion.paragraphs.join(' ')) < chapter.targetWords * 0.8) {
        const retryPrompt = {
          ...prompt,
          user: `${prompt.user}\n\nPrevious response was ${countNarrationWords(expansion.paragraphs.join(' '))} words; target is ${chapter.targetWords}. Retry once and reach at least 80% of the target. Every added sentence must provide meaningful progression: new evidence, a concrete consequence, a causal explanation, or escalation. Do not paraphrase the same content, add generic padding, or repeat an already-stated fact just to raise the word count.`,
        };
        const retryRaw = await aiClient.chat([
          { role: 'system', content: retryPrompt.system },
          { role: 'user', content: retryPrompt.user },
        ]);
        if (await context.isCancelled()) return;
        expansion = parseChapterExpansion(retryRaw);
      }
      if (await context.isCancelled()) return;
      const updated = await patchProjectChapter(projectId, chapter.id, {
        paragraphs: expansion.paragraphs,
        status: 'pending',
        chapterSummary: expansion.chapterSummary,
        avoidRepeating: expansion.avoidRepeating,
        persistentFacts: expansion.persistentFactsNext,
      });
      saved.chapters = updated.chapters;
      styleNote = expansion.styleNote;
    } catch (error) {
      await patchProjectChapter(projectId, chapter.id, { status: 'needs-fix' });
      await context.appendLog(`Chapter ${index + 1} failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    await context.reportProgress(Math.round(((index + 1) / saved.chapters.length) * 100));
  }
  await context.appendLog(`Script saved — ${saved.chapters.length} chapters.`);
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
  const chapterIndex = project.chapters.findIndex((item) => item.id === chapterId);
  const previousChapter = chapter.no === 1 ? undefined : project.chapters[chapterIndex - 1];
  const nextChapter = project.chapters.find((item) => item.no === chapter.no + 1);
  const snapshot = snapshotOf(project.chapters);
  await patchProjectChapter(projectId, chapterId, { status: 'generating' }, snapshot);

  try {
    const prompt = buildRegenerationPrompt(project, chapter, opts.instruction, opts.level, {
      coreQuestion: project.coreQuestion,
      openingHook: chapter.no === 1 ? project.openingHook : null,
      openLoops: project.openLoops.filter((loop) => loop.plantedInChapter === chapter.no || loop.resolvedInChapter === chapter.no),
      previousChapterSummary: previousChapter?.chapterSummary ?? null,
      previousAvoidRepeating: previousChapter?.avoidRepeating ?? [],
      previousPersistentFacts: previousChapter?.persistentFacts ?? [],
    });
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
    const regenerated = parseRegeneratedParagraphs(raw);
    const updated: ChapterDoc = {
      ...chapter,
      paragraphs: regenerated.paragraphs,
      status: 'pending',
      chapterSummary: regenerated.chapterSummary,
      avoidRepeating: regenerated.avoidRepeating,
      persistentFacts: regenerated.persistentFactsNext,
      reviewStatus: 'clean',
    };
    const result = await patchProjectChapter(projectId, chapterId, {
      paragraphs: updated.paragraphs,
      status: updated.status,
      chapterSummary: updated.chapterSummary,
      avoidRepeating: updated.avoidRepeating,
      persistentFacts: updated.persistentFacts,
      reviewStatus: updated.reviewStatus,
    });
    if (nextChapter) await patchProjectChapter(projectId, nextChapter.id, { reviewStatus: 'upstream-changed' });
    return result.chapters.find((item) => item.id === chapterId) ?? updated;
  } catch (error) {
    const aborted = signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
    await patchProjectChapter(projectId, chapterId, { status: 'needs-fix' });
    if (aborted && error instanceof DOMException) throw error;
    throw error;
  }
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
  const scenes: SceneDoc[] = [];
  const finalizedChapters = project.chapters.map((chapter) => {
    const paragraphs = chapter.paragraphs.length ? chapter.paragraphs : [''];
    const chapterDurations = paragraphs.map(estimateNarrationDurationSec);
    scenes.push(...paragraphs.map((narration, index) => ({
      id: newId(),
      narration,
      visualPrompt: '',
      durationSec: chapterDurations[index]!,
      assetType: 'image' as const,
      assetFileId: null,
      audioFileId: null,
      sfxPrompt: '',
      sfxFileId: null,
    })));
    return { ...chapter, scenesCount: paragraphs.length, durationSec: chapterDurations.reduce((sum, value) => sum + value, 0) };
  });
  await replaceProjectChapters(projectId, finalizedChapters, snapshot);
  await replaceProjectScenes(projectId, scenes, 'assets');
}
