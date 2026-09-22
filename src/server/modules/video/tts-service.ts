import type { TtsOptions } from '../../shared/tts';
import { getTtsClient, masterAudio, probeAudioDuration } from '../../shared/tts';
import { createFileStoreService } from '../file-store';
import { getProject, patchProjectScene } from '../project';
import type { SceneDoc } from '../project';
import { logger } from '../../shared/logger';
import { NotFound } from '../../shared/errors';
import { AUDIO_BUFFER_SECONDS } from './docs';

let storeFile = createFileStoreService('./data/files').storeFile;

export function configureVideoTts(filesDir: string): void {
  storeFile = createFileStoreService(filesDir).storeFile;
}

export async function generateSceneVoiceover(projectId: string, sceneId: string, options: TtsOptions = {}): Promise<SceneDoc> {
  const project = await getProject(projectId);
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new NotFound('Không tìm thấy cảnh.');

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
  return updated.scenes.find((candidate) => candidate.id === sceneId)!;
}

export async function generateProjectVoiceovers(projectId: string, appendLog: (message: string) => Promise<void>): Promise<void> {
  const project = await getProject(projectId);
  const failed: number[] = [];
  for (const [index, scene] of project.scenes.entries()) {
    const sceneNumber = index + 1;
    await appendLog(`Generating voiceover for scene ${sceneNumber}/${project.scenes.length}…`);
    try {
      await generateSceneVoiceover(projectId, scene.id);
    } catch (error) {
      failed.push(sceneNumber);
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Voiceover generation failed for scene ${sceneNumber}.`, error);
      await appendLog(`Scene ${sceneNumber} failed: ${message}`);
    }
  }
  if (failed.length > 0) await appendLog(`Voiceover failed for scenes: ${failed.join(', ')}`);
}
