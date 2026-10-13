import type { TtsOptions } from '../../shared/tts';
import { getTtsClient, masterAudio, probeAudioDuration } from '../../shared/tts';
import { createFileStoreService } from '../file-store';
import { assertSceneActive, getProject, patchProjectScene } from '../project';
import type { SceneDoc } from '../project';
import { logger } from '../../shared/logger';
import { AppError, NotFound } from '../../shared/errors';
import { durationWithTail } from '../../../contracts/scene-duration';
import { hashNarration } from '../../../contracts/name-keywords';
import { DEFAULT_VOICE_SPEED } from '../../../contracts/voiceover';
import { alignSceneWordTimings } from './word-timing-service';
import { activeScenes, countInactiveScenes } from '../../../contracts/scene-active';

let storeFile = createFileStoreService('./data/files').storeFile;

export function configureVideoTts(filesDir: string): void {
  storeFile = createFileStoreService(filesDir).storeFile;
}

export async function generateSceneVoiceover(projectId: string, sceneId: string, options: TtsOptions = {}): Promise<SceneDoc> {
  const project = await getProject(projectId);
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new NotFound('Không tìm thấy cảnh.');
  assertSceneActive(scene);
  const sceneNumber = project.scenes.findIndex((candidate) => candidate.id === sceneId) + 1;
  if (!scene.narration.trim()) {
    throw new AppError(`Scene ${sceneNumber} has no narration text, so no voiceover can be generated.`, 422, 'EMPTY_NARRATION');
  }

  const speed = options.speed ?? project.voiceSpeed ?? DEFAULT_VOICE_SPEED;
  const voice = options.voice ?? project.voiceoverVoice;
  const raw = await getTtsClient().synthesize(scene.narration, {
    ...options,
    voice,
    speed,
  });
  const mastered = await masterAudio(raw, speed);
  const voiceoverDurationSec = await probeAudioDuration(mastered);
  const durationSec = durationWithTail(voiceoverDurationSec, project.sceneTailSec);
  const stored = await storeFile({
    projectId,
    originalName: `${scene.id}.wav`,
    mimeType: 'audio/wav',
    buffer: mastered,
    purpose: 'voiceover',
  });
  const updated = await patchProjectScene(projectId, sceneId, {
    audioFileId: stored.id,
    voiceoverDurationSec,
    durationSec,
    voiceoverInput: { voice, speed, narrationHash: hashNarration(scene.narration) },
  }, project.version);
  const updatedScene = updated.scenes.find((candidate) => candidate.id === sceneId)!;
  await alignSceneWordTimings(projectId, updatedScene, mastered);
  return updatedScene;
}

export type VoiceoverBatchResult = {
  generated: number;
  skippedSceneNumbers: number[];
  failedSceneNumbers: number[];
  skippedInactive: number;
};

export type VoiceoverBatchOptions = {
  startSceneId?: string;
  isCancelled?: () => Promise<boolean>;
};

export async function generateProjectVoiceovers(
  projectId: string,
  appendLog: (message: string) => Promise<void>,
  reportProgress: (percent: number) => Promise<void>,
  options: VoiceoverBatchOptions = {},
): Promise<VoiceoverBatchResult> {
  const project = await getProject(projectId);
  const failed: number[] = [];
  const skipped: number[] = [];
  let generated = 0;
  const startIndex = options.startSceneId === undefined ? 0 : project.scenes.findIndex((scene) => scene.id === options.startSceneId);
  if (startIndex < 0) throw new AppError('Không tìm thấy scene bắt đầu voiceover.', 400, 'VOICEOVER_START_SCENE_NOT_FOUND');
  if (options.startSceneId !== undefined) assertSceneActive(project.scenes[startIndex]!);
  const scopedScenes = project.scenes.map((scene, index) => ({ scene, index, active: scene.active })).slice(startIndex);
  const skippedInactive = countInactiveScenes(scopedScenes);
  const scenesToProcess = activeScenes(scopedScenes);
  if (scenesToProcess.length === 0) {
    await appendLog(`Không có scene nào đang bật để tạo voiceover; skippedInactive: ${skippedInactive}.`);
    await reportProgress(100);
    return { generated, skippedSceneNumbers: skipped, failedSceneNumbers: failed, skippedInactive };
  }
  for (const [activeIndex, { scene, index }] of scenesToProcess.entries()) {
    if (options.isCancelled && await options.isCancelled()) {
      await appendLog(`Voiceover cancelled after ${generated} scenes; skippedInactive: ${skippedInactive}.`);
      return { generated, skippedSceneNumbers: skipped, failedSceneNumbers: failed, skippedInactive };
    }
    const sceneNumber = index + 1;
    if (!scene.narration.trim()) {
      skipped.push(sceneNumber);
      await appendLog(`Skipping voiceover for scene ${sceneNumber}: narration is empty.`);
      await reportProgress(Math.round(((activeIndex + 1) / scenesToProcess.length) * 100));
      continue;
    }
    await appendLog(`Generating voiceover for scene ${sceneNumber}/${project.scenes.length}…`);
    try {
      await generateSceneVoiceover(projectId, scene.id);
      generated += 1;
    } catch (error) {
      failed.push(sceneNumber);
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Voiceover generation failed for scene ${sceneNumber}.`, error);
      await appendLog(`Scene ${sceneNumber} failed: ${message}`);
    }
    await reportProgress(Math.round(((activeIndex + 1) / scenesToProcess.length) * 100));
  }
  if (failed.length > 0) await appendLog(`Voiceover failed for scenes: ${failed.join(', ')}`);
  const summary = skipped.length > 0
    ? `Voiceover done for ${generated} scenes; skipped ${skipped.length} scenes with no narration (scene numbers ${skipped.join(', ')}).`
    : `Voiceover done for ${generated} scenes; skipped 0 scenes with no narration.`;
  await appendLog(`${summary} skippedInactive: ${skippedInactive}.`);
  return { generated, skippedSceneNumbers: skipped, failedSceneNumbers: failed, skippedInactive };
}
