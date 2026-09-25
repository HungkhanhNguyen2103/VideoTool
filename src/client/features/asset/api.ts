import { z } from 'zod';
import { FlowSceneExportSchema, type FlowSceneExport } from '../../../contracts/asset';
import { FileSummarySchema, type FileSummary } from '../../../contracts/file';
import { AI_PROVIDERS, ProjectDetailSchema, RENDER_ENGINES, type ProjectDetail, type RenderEngine } from '../../../contracts/project';
import { ApiError, apiRequest } from '../../shared/api-client';

const ImportResultSchema = z.object({ updated: z.number().int().nonnegative(), skipped: z.array(z.string()) });
const FileListSchema = z.array(FileSummarySchema);
const JobResponseSchema = z.object({ jobId: z.string() });

export type { FlowSceneExport };
export type ImportAssetsResult = z.infer<typeof ImportResultSchema>;

export const RENDER_ENGINE_OPTIONS = [
  { value: RENDER_ENGINES[0], label: 'FFmpeg' },
  { value: RENDER_ENGINES[1], label: 'Remotion' },
] as const;

export const AI_PROVIDER_OPTIONS = [
  { value: AI_PROVIDERS[0], label: 'DeepSeek' },
  { value: AI_PROVIDERS[1], label: 'Claude' },
] as const;

export function selectedRenderEngine(engine: RenderEngine): RenderEngine {
  return engine;
}

export function fileUrlForSummary(file: Pick<FileSummary, 'storedPath'>): string {
  if (!/^[0-9A-Z]{26}\.[a-z0-9]+$/i.test(file.storedPath)) throw new Error('Invalid stored path.');
  return `/files/${encodeURIComponent(file.storedPath)}`;
}

export function mediaTypeForMime(mimeType: string): 'image' | 'video' | null {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return null;
}

export function getProject(id: string): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(id)}`, ProjectDetailSchema);
}

export function listProjectFiles(projectId: string): Promise<FileSummary[]> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/files`, FileListSchema);
}

export function exportScenesJson(projectId: string): Promise<FlowSceneExport[]> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/export-json`, z.array(FlowSceneExportSchema));
}

export function patchScene(
  projectId: string,
  sceneId: string,
  body: { visualPrompt?: string; assetType?: 'image' | 'video'; sfxPrompt?: string },
): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}`, ProjectDetailSchema, {
    method: 'PATCH', body,
  });
}

export function setAllAssetType(projectId: string, assetType: 'image' | 'video'): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/set-asset-type`, ProjectDetailSchema, {
    method: 'POST', body: { assetType },
  });
}

export function generateAllVoiceovers(projectId: string): Promise<{ jobId: string }> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/generate-voiceover`, JobResponseSchema, { method: 'POST' });
}

export function generateVisualPrompts(projectId: string): Promise<{ jobId: string }> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/generate-visual-prompts`, JobResponseSchema, { method: 'POST' });
}

export function splitScenes(projectId: string): Promise<{ jobId: string }> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/split`, JobResponseSchema, { method: 'POST' });
}

export function isProjectJobActive(jobId: string | null, progress: { status: string } | null): boolean {
  return Boolean(jobId) && (progress === null || progress.status === 'queued' || progress.status === 'running');
}

export function regenerateVoiceover(
  projectId: string,
  sceneId: string,
  body: { voice?: string; speed?: number; temperature?: number; refAudioPath?: string; refAudioText?: string } = {},
): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/regenerate-voiceover`, ProjectDetailSchema, { method: 'POST', body });
}

export function generateSceneSfx(projectId: string, sceneId: string): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/generate-sfx`, ProjectDetailSchema, { method: 'POST' });
}

export function generateBgm(projectId: string, mood: string): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/generate-bgm`, ProjectDetailSchema, { method: 'POST', body: { mood } });
}

export function renderProject(projectId: string): Promise<{ jobId: string }> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/render`, JobResponseSchema, { method: 'POST' });
}

export function setRenderEngine(projectId: string, engine: RenderEngine): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/render-engine`, ProjectDetailSchema, {
    method: 'PATCH', body: { engine },
  });
}

export function setAiProvider(projectId: string, provider: 'deepseek' | 'claude'): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/ai-provider`, ProjectDetailSchema, {
    method: 'PATCH', body: { provider },
  });
}

export async function previewScene(projectId: string, sceneId: string): Promise<Blob> {
  const response = await fetch(`/api/project/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/render-preview`);
  if (!response.ok) throw new ApiError(`Preview failed (${response.status}).`, response.status, 'PREVIEW_FAILED');
  return response.blob();
}

export function filesByPurpose(files: FileSummary[], purpose: FileSummary['purpose']): FileSummary[] {
  return files.filter((file) => file.purpose === purpose);
}

export function missingSceneNumbers(project: Pick<ProjectDetail, 'scenes'>): number[] {
  return project.scenes.flatMap((scene, index) => scene.assetFileId ? [] : [index + 1]);
}

export function importAssetsZip(
  projectId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ImportAssetsResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/project/${encodeURIComponent(projectId)}/scenes/import-assets`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error('Không thể tải ZIP lên.'));
    xhr.onload = () => {
      let payload: unknown;
      try { payload = JSON.parse(xhr.responseText); } catch { payload = null; }
      if (xhr.status < 200 || xhr.status >= 300) {
        const parsed = z.object({ error: z.object({ message: z.string(), code: z.string(), fields: z.array(z.object({ path: z.string(), message: z.string() })).optional() }) }).safeParse(payload);
        reject(parsed.success ? new ApiError(parsed.data.error.message, xhr.status, parsed.data.error.code, parsed.data.error.fields) : new Error(`Upload failed (${xhr.status}).`));
        return;
      }
      const parsed = ImportResultSchema.safeParse(payload);
      if (!parsed.success) { reject(new Error('Phản hồi import không hợp lệ.')); return; }
      resolve(parsed.data);
    };
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}
