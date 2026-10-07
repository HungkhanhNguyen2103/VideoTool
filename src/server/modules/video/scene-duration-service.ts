import { readFile } from 'node:fs/promises';
import { durationWithTail } from '../../../contracts/scene-duration';
import { probeAudioDuration } from '../../shared/tts';
import { logger } from '../../shared/logger';
import { createFileStoreService } from '../file-store';
import { getProject, setProjectSceneDurations } from '../project';

let resolveFilePath = createFileStoreService('./data/files').resolveFilePath;

export function configureSceneDurationService(filesDir: string): void {
  resolveFilePath = createFileStoreService(filesDir).resolveFilePath;
}

export type RecomputeSceneDurationsResult = {
  updated: number;
  skippedSceneNumbers: number[];
  failedSceneNumbers: number[];
};

export async function recomputeProjectSceneDurations(
  projectId: string,
  appendLog: (message: string) => Promise<void>,
  reportProgress: (percent: number) => Promise<void>,
): Promise<RecomputeSceneDurationsResult> {
  const project = await getProject(projectId);
  const updates: Array<{ sceneId: string; audioFileId: string; voiceoverDurationSec: number; durationSec: number }> = [];
  const skippedSceneNumbers: number[] = [];
  const failedSceneNumbers: number[] = [];

  for (const [index, scene] of project.scenes.entries()) {
    const sceneNumber = index + 1;
    if (!scene.audioFileId) {
      skippedSceneNumbers.push(sceneNumber);
      await appendLog(`Scene ${sceneNumber}: skipped (no voiceover).`);
    } else {
      try {
        const file = await resolveFilePath(project.id, scene.audioFileId);
        if (file.purpose !== 'voiceover' || file.mimeType !== 'audio/wav') throw new Error('Scene voiceover is not a WAV file.');
        const voiceoverDurationSec = await probeAudioDuration(await readFile(file.absolutePath));
        const durationSec = durationWithTail(voiceoverDurationSec, project.sceneTailSec);
        updates.push({ sceneId: scene.id, audioFileId: scene.audioFileId, voiceoverDurationSec, durationSec });
        await appendLog(`Scene ${sceneNumber}: ${scene.durationSec}s → ${durationSec}s (voiceover ${voiceoverDurationSec.toFixed(2)}s + tail ${project.sceneTailSec.toFixed(2)}s).`);
      } catch (error) {
        failedSceneNumbers.push(sceneNumber);
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Scene duration recompute failed for scene ${sceneNumber}.`, error);
        await appendLog(`Scene ${sceneNumber}: probe failed — ${message}`);
      }
    }
    await reportProgress(project.scenes.length > 0 ? Math.round(((index + 1) / project.scenes.length) * 100) : 100);
  }

  if (updates.length > 0) await setProjectSceneDurations(project.id, project.version, updates);
  const result = { updated: updates.length, skippedSceneNumbers, failedSceneNumbers };
  await appendLog(`Duration recompute complete: ${JSON.stringify(result)}.`);
  return result;
}
