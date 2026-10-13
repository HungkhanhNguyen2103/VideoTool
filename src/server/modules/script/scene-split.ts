import type { ProjectDetail } from '../../../contracts/project';
import { estimateNarrationDurationSec } from '../../../contracts/script';
import { getAiClient } from '../../shared/ai';
import { AppError } from '../../shared/errors';
import { newId } from '../../shared/ids';
import { getProject, replaceProjectChapters, replaceProjectScenes, type SceneDoc } from '../project';
import { buildSceneSplitPrompt, type SceneSplitSceneInput } from './ai/build-prompt';
import { parseSceneSplitBatch } from './ai/parse-output';
import { snapshotOf } from './service';

export type SceneSplitJobContext = {
  reportProgress: (percent: number, result?: unknown) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
};

export type SceneSplitJobResult = {
  splitScenes: number;
  skippedChapters: number;
  failedChapters: number[];
};

type SceneSplitBatch = ReturnType<typeof parseSceneSplitBatch>;

function normalizeNarration(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function validateBatch(batch: SceneSplitBatch, scenes: readonly SceneSplitSceneInput[]): void {
  const expected = new Set(scenes.map((scene) => scene.sceneIndex));
  const actual = batch.scenes.map((scene) => scene.sceneIndex);
  if (actual.length !== scenes.length || new Set(actual).size !== actual.length || actual.some((index) => !expected.has(index))) {
    throw new AppError(`Scene split indexes must match exactly: ${[...expected].join(', ')}.`, 422, 'SCRIPT_PARSE_ERROR');
  }
  const returned = new Map(batch.scenes.map((scene) => [scene.sceneIndex, scene]));
  for (const scene of scenes) {
    if (normalizeNarration(returned.get(scene.sceneIndex)!.chunks.join(' ')) !== normalizeNarration(scene.narration)) {
      throw new AppError(`Scene ${scene.sceneIndex} does not reconstruct its source narration.`, 422, 'SCRIPT_PARSE_ERROR');
    }
  }
}

function validationError(error: unknown): error is AppError {
  return error instanceof AppError && error.code === 'SCRIPT_PARSE_ERROR';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sceneRange(project: ProjectDetail, chapterIndex: number): { start: number; scenes: SceneDoc[]; input: SceneSplitSceneInput[] } {
  const start = project.chapters.slice(0, chapterIndex).reduce((sum, chapter) => sum + (chapter.scenesCount ?? 0), 0);
  const count = project.chapters[chapterIndex]?.scenesCount ?? 0;
  const scenes = project.scenes.slice(start, start + count);
  const input = scenes.map((scene, index) => ({ sceneId: scene.id, sceneIndex: start + index + 1, narration: scene.narration }));
  return { start, scenes, input };
}

function hasDownstreamData(scene: SceneDoc): boolean {
  return scene.assetFileId !== null || scene.audioFileId !== null || scene.sfxFileId !== null || scene.visualPrompt.trim() !== '';
}

function replacements(batch: SceneSplitBatch, scenes: readonly SceneDoc[], input: readonly SceneSplitSceneInput[]): SceneDoc[] {
  const byIndex = new Map(batch.scenes.map((item) => [item.sceneIndex, item.chunks]));
  return scenes.flatMap((scene, index) => {
    const chunks = (byIndex.get(input[index]!.sceneIndex) ?? []).map((chunk) => chunk.trim()).filter(Boolean);
    if (chunks.length === 0) return [];
    if (chunks.length === 1) return [scene];
    return chunks.map((chunk) => ({
      id: newId(), narration: chunk, visualPrompt: '', durationSec: estimateNarrationDurationSec(chunk), active: true,
      assetType: 'image' as const, assetFileId: null, audioFileId: null, voiceoverDurationSec: null, voiceoverInput: null, wordTimings: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null, videoKeyframeFileId: null, videoTailFileId: null, videoDurationSec: null, depthMap: null, nameCandidates: null, popupPlan: null,
    }));
  });
}

export async function splitProjectScenes(projectId: string, context: SceneSplitJobContext): Promise<SceneSplitJobResult> {
  let current = await getProject(projectId);
  if (current.chapters.length === 0 || current.chapters.some((chapter) => (chapter.scenesCount ?? 0) <= 0) ||
      current.chapters.reduce((sum, chapter) => sum + (chapter.scenesCount ?? 0), 0) !== current.scenes.length) {
    throw new AppError('Finalized scenes do not match chapters.', 422, 'SCENES_NOT_READY');
  }
  const client = getAiClient(current.aiProvider, current.aiModel);
  const result: SceneSplitJobResult = { splitScenes: 0, skippedChapters: 0, failedChapters: [] };
  let snapshotRecorded = false;
  let cancelled = false;

  for (let chapterIndex = 0; chapterIndex < current.chapters.length; chapterIndex += 1) {
    if (await context.isCancelled()) { cancelled = true; break; }
    const chapter = current.chapters[chapterIndex]!;
    const { start, scenes, input } = sceneRange(current, chapterIndex);
    if (scenes.some(hasDownstreamData)) {
      result.skippedChapters += 1;
      await context.appendLog(`Chapter ${chapter.no}: downstream scene data exists; skipped.`);
    } else {
      try {
        const prompt = buildSceneSplitPrompt({ project: current, chapter, scenes: input });
        let batch: SceneSplitBatch | undefined;
        let retryError = '';
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (await context.isCancelled()) { cancelled = true; break; }
          const user = retryError ? `${prompt.user}\n\nValidation error: ${retryError} Return corrected JSON for exactly the supplied sceneIndex values with unchanged narration.` : prompt.user;
          const raw = await client.chat([
            { role: 'system', content: prompt.system },
            { role: 'user', content: user },
          ]);
          if (await context.isCancelled()) { cancelled = true; break; }
          try {
            batch = parseSceneSplitBatch(raw);
            validateBatch(batch, input);
            break;
          } catch (error) {
            if (!validationError(error) || attempt === 1) throw error;
            retryError = describeError(error);
            await context.appendLog(`Chapter ${chapter.no}: invalid scene split batch; retrying once (${retryError}).`);
          }
        }
        if (cancelled) break;
        if (!batch) throw new AppError('Scene split batch was empty.', 422, 'SCRIPT_PARSE_ERROR');

        const nextScenes = replacements(batch, scenes, input);
        const added = nextScenes.length - scenes.length; // Sum of chunks.length - 1 for each split source scene.
        const nextChapters = current.chapters.map((item, index) => index === chapterIndex
          ? { ...item, scenesCount: nextScenes.length, durationSec: nextScenes.reduce((sum, scene) => sum + scene.durationSec, 0) }
          : item);
        const flattenedScenes = [...current.scenes.slice(0, start), ...nextScenes, ...current.scenes.slice(start + scenes.length)];
        if (await context.isCancelled()) { cancelled = true; break; }
        await replaceProjectChapters(projectId, nextChapters, added > 0 && !snapshotRecorded ? snapshotOf(current.chapters) : null);
        await replaceProjectScenes(projectId, flattenedScenes);
        current = await getProject(projectId);
        if (added > 0) snapshotRecorded = true;
        result.splitScenes += added;
        await context.appendLog(`Chapter ${chapter.no}: ${added} scenes added.`);
      } catch (error) {
        result.failedChapters.push(chapter.no);
        await context.appendLog(`Chapter ${chapter.no}: scene splitting failed: ${describeError(error)}`);
        current = await getProject(projectId);
        if (current.chapters.reduce((sum, item) => sum + (item.scenesCount ?? 0), 0) !== current.scenes.length) {
          throw new AppError(`Chapter ${chapter.no} write left chapters and scenes out of sync.`, 500, 'SCENE_SPLIT_WRITE_ERROR');
        }
      }
    }
    await context.reportProgress(Math.round(((chapterIndex + 1) / current.chapters.length) * 100), result);
  }

  await context.appendLog(`Scene splitting ${cancelled ? 'cancelled' : 'finished'}: ${result.splitScenes} added, ${result.skippedChapters} skipped chapters, ${result.failedChapters.length} failed chapters${result.failedChapters.length ? ` (${result.failedChapters.join(', ')})` : ''}.`);
  return result;
}
