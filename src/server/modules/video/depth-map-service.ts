import { readFile } from 'node:fs/promises';
import type { Scene } from '../../../contracts/project';
import { loadConfig } from '../../config';
import { logger } from '../../shared/logger';
import { createFileStoreService } from '../file-store';
import { getProject, setSceneDepthMap } from '../project';

let resolveFilePath = createFileStoreService('./data/files').resolveFilePath;
let store = createFileStoreService('./data/files');

export function configureDepthMapService(filesDir: string): void {
  store = createFileStoreService(filesDir);
  resolveFilePath = store.resolveFilePath;
}

export type DepthMapStatus = 'generated' | 'skipped' | 'failed' | 'stale';

async function requestDepthMap(image: Buffer, originalName: string): Promise<{ buffer: Buffer; score: number }> {
  const config = loadConfig();
  const form = new FormData();
  form.set('image', new Blob([new Uint8Array(image)], { type: 'image/png' }), originalName);
  const response = await fetch(config.DEPTH_API_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(config.DEPTH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Depth service HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const score = Number(response.headers.get('X-Depth-Score'));
  if (!Number.isFinite(score)) throw new Error('Depth service returned no valid X-Depth-Score header.');
  return { buffer: Buffer.from(await response.arrayBuffer()), score };
}

export async function generateSceneDepthMap(projectId: string, scene: Pick<Scene, 'id' | 'assetType' | 'assetFileId' | 'depthMap'>, onFailure?: (message: string) => void): Promise<DepthMapStatus> {
  if (scene.assetType !== 'image' || !scene.assetFileId) return 'skipped';
  if (scene.depthMap?.assetFileId === scene.assetFileId) return 'skipped';
  let storedId: string | null = null;
  try {
    const asset = await resolveFilePath(projectId, scene.assetFileId);
    if (asset.purpose !== 'reference' || !asset.mimeType.startsWith('image/')) return 'skipped';
    const result = await requestDepthMap(await readFile(asset.absolutePath), `${scene.id}.png`);
    const stored = await store.storeFile({ projectId, originalName: `${scene.id}.depth.png`, mimeType: 'image/png', buffer: result.buffer, purpose: 'depth' });
    storedId = stored.id;
    const written = await setSceneDepthMap(projectId, scene.id, scene.assetFileId, { assetFileId: scene.assetFileId, fileId: stored.id, score: result.score });
    if (!written) {
      await store.deleteFile(stored.id).catch(() => undefined);
      return 'stale';
    }
    return 'generated';
  } catch (error) {
    if (storedId) await store.deleteFile(storedId).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Depth map failed for scene ${scene.id}: ${message}`);
    onFailure?.(message);
    return 'failed';
  }
}

export async function generateProjectDepthMaps(
  projectId: string,
  appendLog: (message: string) => Promise<void>,
  reportProgress: (percent: number) => Promise<void>,
  isCancelled: () => Promise<boolean>,
): Promise<{ generated: number; skipped: number; failed: number; stale: number }> {
  const project = await getProject(projectId);
  const totals = { generated: 0, skipped: 0, failed: 0, stale: 0 };
  if (project.scenes.length === 0) { await reportProgress(100); return totals; }
  for (const [index, snapshot] of project.scenes.entries()) {
    if (await isCancelled()) break;
    const current = (await getProject(projectId)).scenes.find((scene) => scene.id === snapshot.id);
    if (!current) continue;
    let failureMessage = '';
    const status = await generateSceneDepthMap(projectId, current, (message) => { failureMessage = message; });
    totals[status] += 1;
    await appendLog(`Depth map scene ${index + 1}/${project.scenes.length}: ${status}${failureMessage ? ` — ${failureMessage}` : ''}`);
    await reportProgress(Math.round(((index + 1) / project.scenes.length) * 100));
  }
  await appendLog(`Depth map totals: ${JSON.stringify(totals)}`);
  return totals;
}
