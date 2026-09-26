import { readFile } from 'node:fs/promises';
import type { Scene } from '../../../contracts/project';
import { createFileStoreService } from '../file-store';
import { getProject, setSceneWordTimings } from '../project';
import { probeAudioDuration } from '../../shared/tts';
import { requestWhisperAlignment } from '../../shared/tts/align';
import { logger } from '../../shared/logger';
import { alignNarrationWords } from './word-alignment';

let resolveFilePath = createFileStoreService('./data/files').resolveFilePath;

export function configureWordTimingService(filesDir: string): void {
  resolveFilePath = createFileStoreService(filesDir).resolveFilePath;
}

export type AlignmentStatus = 'aligned' | 'rejected' | 'failed' | 'stale';

export async function alignSceneWordTimings(projectId: string, scene: Pick<Scene, 'id' | 'narration' | 'audioFileId'>, suppliedAudio?: Buffer, onFailure?: (message: string) => void): Promise<AlignmentStatus> {
  if (!scene.audioFileId) return 'stale';
  try {
    let audio = suppliedAudio;
    if (!audio) {
      const file = await resolveFilePath(projectId, scene.audioFileId);
      if (file.purpose !== 'voiceover' || file.mimeType !== 'audio/wav') throw new Error('Scene voiceover is not a WAV file.');
      audio = await readFile(file.absolutePath);
    }
    const [duration, transcript] = await Promise.all([probeAudioDuration(audio), requestWhisperAlignment(audio, scene.narration)]);
    const result = alignNarrationWords(scene.narration, transcript, duration);
    if (!result.words) {
      logger.warn(`Word alignment rejected for scene ${scene.id}: ${result.reason}`);
      const written = await setSceneWordTimings(projectId, scene.id, scene.audioFileId, scene.narration, null);
      return written ? 'rejected' : 'stale';
    }
    const written = await setSceneWordTimings(projectId, scene.id, scene.audioFileId, scene.narration, { audioFileId: scene.audioFileId, words: result.words });
    return written ? 'aligned' : 'stale';
  } catch (error) {
    logger.warn(`Word alignment failed for scene ${scene.id}.`, error);
    onFailure?.(error instanceof Error ? error.message : String(error));
    return 'failed';
  }
}

export async function alignProjectWordTimings(
  projectId: string,
  appendLog: (message: string) => Promise<void>,
  reportProgress: (percent: number) => Promise<void>,
  isCancelled: () => Promise<boolean>,
): Promise<{ aligned: number; rejected: number; failed: number; stale: number; skipped: number }> {
  const project = await getProject(projectId);
  const totals = { aligned: 0, rejected: 0, failed: 0, stale: 0, skipped: 0 };
  for (const [index, snapshot] of project.scenes.entries()) {
    if (await isCancelled()) break;
    const current = (await getProject(projectId)).scenes.find((scene) => scene.id === snapshot.id);
    if (!current?.audioFileId || current.wordTimings?.audioFileId === current.audioFileId) {
      totals.skipped += 1;
    } else {
      let failureMessage = '';
      const status = await alignSceneWordTimings(projectId, current, undefined, (message) => { failureMessage = message; });
      totals[status] += 1;
      await appendLog(`Word alignment scene ${index + 1}/${project.scenes.length}: ${status}${failureMessage ? ` — ${failureMessage}` : ''}`);
    }
    await reportProgress(Math.round((index + 1) / project.scenes.length * 100));
  }
  await appendLog(`Word alignment totals: ${JSON.stringify(totals)}`);
  return totals;
}
