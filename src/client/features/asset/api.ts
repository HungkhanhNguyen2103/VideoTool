import { z } from 'zod';
import { FlowSceneExportSchema, type FlowSceneExport } from '../../../contracts/asset';
import { FileSummarySchema, type FileSummary } from '../../../contracts/file';
import { ProjectDetailSchema, type ProjectDetail } from '../../../contracts/project';
import { ApiError, apiRequest } from '../../shared/api-client';

const ImportResultSchema = z.object({ updated: z.number().int().nonnegative(), skipped: z.array(z.string()) });
const FileListSchema = z.array(FileSummarySchema);

export type { FlowSceneExport };
export type ImportAssetsResult = z.infer<typeof ImportResultSchema>;

export function fileUrlForSummary(file: Pick<FileSummary, 'storedPath'>): string {
  if (!/^[0-9A-Z]{26}\.[a-z0-9]+$/i.test(file.storedPath)) throw new Error('Invalid stored path.');
  return `/files/${encodeURIComponent(file.storedPath)}`;
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
  body: { visualPrompt?: string; assetType?: 'image' | 'video' },
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
