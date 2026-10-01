import type { TtsOptions } from '../../shared/tts';
import { getTtsClient, masterAudio, probeAudioDuration } from '../../shared/tts';
import { createFileStoreService } from '../file-store';
import { getProject, patchProjectScene } from '../project';
import type { SceneDoc } from '../project';
import { logger } from '../../shared/logger';
import { AppError, NotFound } from '../../shared/errors';
import { AUDIO_BUFFER_SECONDS } from './docs';
import { alignSceneWordTimings } from './word-timing-service';

let storeFile = createFileStoreService('./data/files').storeFile;

export function configureVideoTts(filesDir: string): void {
  storeFile = createFileStoreService(filesDir).storeFile;
}

export async function generateSceneVoiceover(projectId: string, sceneId: string, options: TtsOptions = {}): Promise<SceneDoc> {
  const project = await getProject(projectId);
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new NotFound('Không tìm thấy cảnh.');
  const sceneNumber = project.scenes.findIndex((candidate) => candidate.id === sceneId) + 1;
  if (!scene.narration.trim()) {
    throw new AppError(`Scene ${sceneNumber} has no narration text, so no voiceover can be generated.`, 422, 'EMPTY_NARRATION');
  }

  const raw = await getTtsClient().synthesize(scene.narration, {
    ...options,
    voice: options.voice ?? project.voiceoverVoice,
  });
  const mastered = await masterAudio(raw);
  const durationSec = Math.ceil((await probeAudioDuration(mastered)) + AUDIO_BUFFER_SECONDS);
  const stored = await storeFile({
    projectId,
    originalName: `${scene.id}.wav`,
    mimeType: 'audio/wav',
    buffer: mastered,
    purpose: 'voiceover',
  });
  const updated = await patchProjectScene(projectId, sceneId, { audioFileId: stored.id, durationSec });
  const updatedScene = updated.scenes.find((candidate) => candidate.id === sceneId)!;
  await alignSceneWordTimings(projectId, updatedScene, mastered);
  return updatedScene;
}

export type VoiceoverBatchResult = {
  generated: number;
  skippedSceneNumbers: number[];
  failedSceneNumbers: number[];
};

export async function generateProjectVoiceovers(projectId: string, appendLog: (message: string) => Promise<void>, reportProgress: (percent: number) => Promise<void>): Promise<VoiceoverBatchResult> {
  const project = await getProject(projectId);
  const failed: number[] = [];
  const skipped: number[] = [];
  let generated = 0;
  for (const [index, scene] of project.scenes.entries()) {
    const sceneNumber = index + 1;
    if (!scene.narration.trim()) {
      skipped.push(sceneNumber);
      await appendLog(`Skipping voiceover for scene ${sceneNumber}: narration is empty.`);
      await reportProgress(Math.round(((index + 1) / project.scenes.length) * 100));
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
    await reportProgress(Math.round(((index + 1) / project.scenes.length) * 100));
  }
  if (failed.length > 0) await appendLog(`Voiceover failed for scenes: ${failed.join(', ')}`);
  const summary = skipped.length > 0
    ? `Voiceover done for ${generated} scenes; skipped ${skipped.length} scenes with no narration (scene numbers ${skipped.join(', ')}).`
    : `Voiceover done for ${generated} scenes; skipped 0 scenes with no narration.`;
  await appendLog(summary);
  return { generated, skippedSceneNumbers: skipped, failedSceneNumbers: failed };
}
