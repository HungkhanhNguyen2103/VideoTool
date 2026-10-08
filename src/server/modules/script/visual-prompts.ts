import type { ProjectDetail } from '../../../contracts/project';
import { getAiClient } from '../../shared/ai';
import { AppError } from '../../shared/errors';
import { applyEmptySceneVisualPromptsWithResult, getProject } from '../project';
import { buildVisualPromptPrompt, type VisualPromptSceneInput } from './ai/build-prompt';
import { parseVisualPromptBatch } from './ai/parse-output';

export type VisualPromptJobContext = {
  reportProgress: (percent: number, result?: unknown) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
};

export type VisualPromptJobResult = {
  updatedScenes: number;
  skippedScenes: number;
  failedChapters: number[];
};

type VisualPromptBatch = ReturnType<typeof parseVisualPromptBatch>;

function chapterScenes(project: ProjectDetail): VisualPromptSceneInput[][] {
  let nextScene = 0;
  const chapters = project.chapters.map((chapter) => {
    const count = chapter.scenesCount ?? 0;
    const scenes = project.scenes.slice(nextScene, nextScene + count).map((scene, index) => ({
      sceneId: scene.id,
      sceneIndex: nextScene + index + 1,
      narration: scene.narration,
      assetType: scene.assetType,
      visualPrompt: scene.visualPrompt,
      sfxPrompt: scene.sfxPrompt,
      motionPrompt: scene.motionPrompt,
    }));
    nextScene += count;
    return scenes;
  });
  if (nextScene !== project.scenes.length || chapters.some((scenes) => scenes.length === 0)) {
    throw new AppError('Finalized scenes do not match chapters.', 422, 'SCENES_NOT_READY');
  }
  return chapters;
}

function excerpt(scenes: readonly { visualPrompt: string }[]): string {
  return scenes.map((scene) => scene.visualPrompt.trim()).filter(Boolean).join(' | ').slice(0, 500);
}

function validateIndexes(batch: VisualPromptBatch, scenes: readonly VisualPromptSceneInput[]): void {
  const expected = new Set(scenes.map((scene) => scene.sceneIndex));
  const actual = batch.prompts.map((prompt) => prompt.sceneIndex);
  if (actual.length !== scenes.length || new Set(actual).size !== actual.length || actual.some((index) => !expected.has(index))) {
    throw new AppError(`Visual prompt indexes must match exactly: ${[...expected].join(', ')}.`, 422, 'SCRIPT_PARSE_ERROR');
  }
}

function validationError(error: unknown): error is AppError {
  return error instanceof AppError && error.code === 'SCRIPT_PARSE_ERROR';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function generateVisualPrompts(
  projectId: string,
  context: VisualPromptJobContext,
): Promise<VisualPromptJobResult> {
  const project = await getProject(projectId);
  const scenesByChapter = chapterScenes(project);
  const client = getAiClient(project.aiProvider, project.aiModel);
  const result: VisualPromptJobResult = { updatedScenes: 0, skippedScenes: 0, failedChapters: [] };
  let styleNote = excerpt(project.scenes);
  let updatedSfxPrompts = 0;
  let updatedMotionPrompts = 0;
  let cancelled = false;

  for (const [chapterIndex, chapter] of project.chapters.entries()) {
    if (await context.isCancelled()) { cancelled = true; break; }
    const scenes = scenesByChapter[chapterIndex]!;
    const previousChapter = chapterIndex > 0 ? project.chapters[chapterIndex - 1] : null;
    const prefilledVisual = scenes.filter((scene) => scene.visualPrompt !== '').length;
    const fullyPrefilled = scenes.filter((scene) => scene.visualPrompt !== '' && scene.sfxPrompt !== '' && (scene.assetType !== 'video' || scene.motionPrompt !== '')).length;
    result.skippedScenes += prefilledVisual;

    if (fullyPrefilled === scenes.length) {
      await context.appendLog(`Chapter ${chapter.no}: all visual and SFX prompts already filled; skipped.`);
    } else {
      try {
        const prompt = buildVisualPromptPrompt({
          project,
          chapter,
          scenes,
          styleNote,
          visualStylePresetId: project.visualStylePresetId,
          coreQuestion: project.coreQuestion,
          openingHook: project.openingHook || null,
          previousChapterSummary: previousChapter?.chapterSummary ?? null,
          previousAvoidRepeating: previousChapter?.avoidRepeating ?? [],
          previousPersistentFacts: previousChapter?.persistentFacts ?? [],
        });
        let batch: VisualPromptBatch | undefined;
        let retryError = '';
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (await context.isCancelled()) { cancelled = true; break; }
          const user = retryError ? `${prompt.user}\n\nValidation error: ${retryError} Return corrected JSON for exactly the supplied sceneIndex values.` : prompt.user;
          const raw = await client.chat([
            { role: 'system', content: prompt.system },
            { role: 'user', content: user },
          ]);
          if (await context.isCancelled()) { cancelled = true; break; }
          try {
            batch = parseVisualPromptBatch(raw);
            validateIndexes(batch, scenes);
            break;
          } catch (error) {
            if (!validationError(error) || attempt === 1) throw error;
            retryError = describeError(error);
            await context.appendLog(`Chapter ${chapter.no}: invalid visual prompt batch; retrying once (${retryError}).`);
          }
        }
        if (cancelled) break;
        if (!batch) throw new AppError('Visual prompt batch was empty.', 422, 'SCRIPT_PARSE_ERROR');

        const idsByIndex = new Map(scenes.map((scene) => [scene.sceneIndex, scene.sceneId]));
        const scenesByIndex = new Map(scenes.map((scene) => [scene.sceneIndex, scene]));
        const updates = batch.prompts.map((item) => ({
          sceneId: idsByIndex.get(item.sceneIndex)!,
          visualPrompt: item.visualPrompt,
          sfxPrompt: item.sfxPrompt,
          motionPrompt: scenesByIndex.get(item.sceneIndex)?.assetType === 'video' ? item.motionPrompt : '',
        }));
        if (await context.isCancelled()) { cancelled = true; break; }
        const { updatedSceneIds, updatedSfxPromptSceneIds, updatedMotionPromptSceneIds } = await applyEmptySceneVisualPromptsWithResult(projectId, updates);
        const changed = updatedSceneIds.length;
        const changedSfx = updatedSfxPromptSceneIds.length;
        const changedMotion = updatedMotionPromptSceneIds.length;
        result.updatedScenes += changed;
        result.skippedScenes += scenes.length - prefilledVisual - changed;
        updatedSfxPrompts += changedSfx;
        updatedMotionPrompts += changedMotion;
        styleNote = batch.styleNote;
        await context.appendLog(`Chapter ${chapter.no}: ${changed} visual prompts added; ${changedSfx} SFX prompts added; ${changedMotion} motion prompts added; ${scenes.length - changed} already filled.`);
      } catch (error) {
        result.failedChapters.push(chapter.no);
        await context.appendLog(`Chapter ${chapter.no}: visual prompt generation failed: ${describeError(error)}`);
      }
    }

    await context.reportProgress(Math.round(((chapterIndex + 1) / project.chapters.length) * 100), result);
  }

  await context.appendLog(`Visual prompts ${cancelled ? 'cancelled' : 'finished'}: ${result.updatedScenes} updated, ${updatedSfxPrompts} SFX prompts added, ${updatedMotionPrompts} motion prompts added, ${result.skippedScenes} skipped, ${result.failedChapters.length} failed chapters${result.failedChapters.length ? ` (${result.failedChapters.join(', ')})` : ''}.`);
  return result;
}
