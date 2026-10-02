import { z } from 'zod';
import { FlowSceneExportSchema, VideoDistributionPreviewSchema, type FlowSceneExport, type VideoDistributionPreview } from '../../../contracts/asset';
import { FileSummarySchema, type FileSummary } from '../../../contracts/file';
import { AI_PROVIDERS, FILM_LOOK_STYLES, PARALLAX_STYLES, ProjectDetailSchema, RENDER_ENGINES, TRANSITION_STYLES, type FilmLookStyle, type ParallaxStyle, type ProjectDetail, type RenderEngine, type TransitionStyle, type VisualStyleId } from '../../../contracts/project';
import { ApiError, apiRequest } from '../../shared/api-client';

const ImportResultSchema = z.object({ updated: z.number().int().nonnegative(), skipped: z.array(z.string()) });
const FileListSchema = z.array(FileSummarySchema);
const JobResponseSchema = z.object({ jobId: z.string() });
const VoiceoverBatchResultSchema = z.object({
  generated: z.number().int().nonnegative(),
  skippedSceneNumbers: z.array(z.number().int().positive()),
  failedSceneNumbers: z.array(z.number().int().positive()),
});

export type VoiceoverBatchResult = z.infer<typeof VoiceoverBatchResultSchema>;

export type { FlowSceneExport };
export type ImportAssetsResult = z.infer<typeof ImportResultSchema>;

export const RENDER_ENGINE_OPTIONS = [
  { value: RENDER_ENGINES[0], label: 'FFmpeg' },
  { value: RENDER_ENGINES[1], label: 'Remotion' },
] as const;

export const TRANSITION_STYLE_OPTIONS = [
  { value: TRANSITION_STYLES[1], label: 'Đa dạng' },
  { value: TRANSITION_STYLES[0], label: 'Chỉ mờ dần' },
] as const;

export const FILM_LOOK_OPTIONS = [
  { value: FILM_LOOK_STYLES[0], label: 'Tự động (trước 1990)' },
  { value: FILM_LOOK_STYLES[1], label: 'Luôn bật' },
  { value: FILM_LOOK_STYLES[2], label: 'Tắt' },
] as const;

export const PARALLAX_OPTIONS = [
  { value: PARALLAX_STYLES[0], label: 'Tự động' },
  { value: PARALLAX_STYLES[1], label: 'Tắt' },
] as const;

export const AI_PROVIDER_OPTIONS = [
  { value: AI_PROVIDERS[0], label: 'DeepSeek' },
  { value: AI_PROVIDERS[1], label: 'Claude' },
] as const;

export const VISUAL_STYLE_OPTIONS = [
  { value: 'cinematic', label: 'Cinematic (điện ảnh)' },
  { value: 'anime', label: 'Anime' },
  { value: 'watercolor', label: 'Watercolor (màu nước)' },
  { value: 'photorealistic', label: 'Photorealistic (ảnh thực)' },
  { value: 'flat-cartoon', label: 'Flat Cartoon' },
  { value: 'strategic-map', label: 'Strategic Map (2D)' },
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
  body: { narration?: string; visualPrompt?: string; assetType?: 'image' | 'video'; sfxPrompt?: string; motionPrompt?: string; expectedVersion?: number },
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

export function fitSceneToClip(projectId: string, sceneId: string, expectedVersion: number): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/fit-to-clip`, ProjectDetailSchema, {
    method: 'POST', body: { expectedVersion },
  });
}

export function voiceoverSummary(result: unknown): string | null {
  const parsed = VoiceoverBatchResultSchema.safeParse(result);
  if (!parsed.success) return null;
  const { generated, skippedSceneNumbers } = parsed.data;
  return `Voiceover done for ${generated} scenes; skipped ${skippedSceneNumbers.length} scenes with no narration (scene numbers ${skippedSceneNumbers.join(', ')}).`;
}

export function previewVideoDistribution(projectId: string, targetPercent: number): Promise<VideoDistributionPreview> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/video-distribution/preview`, VideoDistributionPreviewSchema, {
    method: 'POST', body: { targetPercent },
  });
}

export function applyVideoDistribution(projectId: string, targetPercent: number, expectedVersion: number): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/video-distribution/apply`, ProjectDetailSchema, {
    method: 'POST', body: { targetPercent, expectedVersion },
  });
}

export function alignWordTimings(projectId: string): Promise<{ jobId: string }> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/align-words`, JobResponseSchema, { method: 'POST' });
}

export function generateAllSfx(projectId: string): Promise<{ jobId: string }> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/generate-all-sfx`, JobResponseSchema, { method: 'POST' });
}

export function generateDepthMaps(projectId: string): Promise<{ jobId: string }> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/generate-depth-maps`, JobResponseSchema, { method: 'POST' });
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

export function renderProject(projectId: string, draft = false): Promise<{ jobId: string }> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/render`, JobResponseSchema, {
    method: 'POST',
    ...(draft ? { body: { draft: true } } : {}),
  });
}

export function setRenderEngine(projectId: string, engine: RenderEngine): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/render-engine`, ProjectDetailSchema, {
    method: 'PATCH', body: { engine },
  });
}

export function setKeywordPopups(projectId: string, enabled: boolean): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/keyword-popups`, ProjectDetailSchema, {
    method: 'PATCH', body: { enabled },
  });
}

export function setTransitionStyle(projectId: string, style: TransitionStyle): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/transition-style`, ProjectDetailSchema, {
    method: 'PATCH', body: { style },
  });
}

export function setFilmLook(projectId: string, style: FilmLookStyle): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/film-look`, ProjectDetailSchema, {
    method: 'PATCH', body: { style },
  });
}

export function setParallax(projectId: string, style: ParallaxStyle): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/parallax`, ProjectDetailSchema, {
    method: 'PATCH', body: { style },
  });
}

export function setAiProvider(projectId: string, provider: 'deepseek' | 'claude'): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/ai-provider`, ProjectDetailSchema, {
    method: 'PATCH', body: { provider },
  });
}

export function setVisualStyle(projectId: string, visualStylePresetId: VisualStyleId): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/visual-style`, ProjectDetailSchema, {
    method: 'PATCH', body: { visualStylePresetId },
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
