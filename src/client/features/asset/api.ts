import { z } from 'zod';
import { FlowSceneExportSchema, ImportAssetsResultSchema, VideoDistributionPreviewSchema, type FlowSceneExport, type ImportAssetsResult, type VideoDistributionPreview } from '../../../contracts/asset';
import { FileSummarySchema, type FileSummary } from '../../../contracts/file';
import { AI_PROVIDERS, FILM_LOOK_STYLES, PARALLAX_STYLES, ProjectDetailSchema, RENDER_ENGINES, TRANSITION_STYLES, type FilmLookStyle, type ParallaxStyle, type ProjectDetail, type RenderEngine, type TransitionStyle, type VisualStyleId } from '../../../contracts/project';
import { ApiError, apiRequest } from '../../shared/api-client';
import { ApiErrorBodySchema } from '../../../contracts/common';
import type { PopupBackend, PopupDensity, PopupPlanPopup } from '../../../contracts/popup-analysis';
import { ClaudeCliStatusSchema, type ClaudeCliStatus } from '../../../contracts/script';
import { activeScenes } from '../../../contracts/scene-active';

const ImportResultSchema = ImportAssetsResultSchema;
const FileListSchema = z.array(FileSummarySchema);
const JobResponseSchema = z.object({ jobId: z.string() });
const NameKeywordAnalysisSummarySchema = z.object({
  scenesAnalyzed: z.number().int().nonnegative(),
  scenesSkippedNoTimings: z.number().int().nonnegative(),
  scenesWithName: z.number().int().nonnegative(),
  rejectedCandidates: z.number().int().nonnegative(),
  provider: z.enum(AI_PROVIDERS),
  model: z.string().min(1),
  skippedInactive: z.number().int().nonnegative(),
});
const NameKeywordPopupSchema = z.object({
  text: z.string(),
  type: z.enum(['person', 'place', 'other']),
  source: z.enum(['ai', 'rules']),
});
const NameKeywordPreviewsSchema = z.array(z.object({ sceneId: z.string(), popup: NameKeywordPopupSchema.nullable() }));
const VoiceoverBatchResultSchema = z.object({
  generated: z.number().int().nonnegative(),
  skippedSceneNumbers: z.array(z.number().int().positive()),
  failedSceneNumbers: z.array(z.number().int().positive()),
  skippedInactive: z.number().int().nonnegative(),
});
const RecomputeSceneDurationsResultSchema = z.object({
  updated: z.number().int().nonnegative(),
  skippedSceneNumbers: z.array(z.number().int().positive()),
  failedSceneNumbers: z.array(z.number().int().positive()),
  skippedInactive: z.number().int().nonnegative(),
});
const PopupPlanConflictSchema = z.object({ sceneId: z.string(), sceneNumber: z.number().int().positive(), anchor: z.string(), reason: z.string() });
const PopupPlanMutationResultSchema = z.object({ project: ProjectDetailSchema, conflicts: z.array(PopupPlanConflictSchema) });

export type VoiceoverBatchResult = z.infer<typeof VoiceoverBatchResultSchema>;
export type RecomputeSceneDurationsResult = z.infer<typeof RecomputeSceneDurationsResultSchema>;
export type PopupAnalysisResult = { scenesApplied: number; scenesExpected: number; summary: { rejectedCandidates: number } };
export type PopupPlanMutationResult = z.infer<typeof PopupPlanMutationResultSchema>;
export type PopupPlanConflict = z.infer<typeof PopupPlanConflictSchema>;
export type NameKeywordAnalysisSummary = z.infer<typeof NameKeywordAnalysisSummarySchema>;
export type NameKeywordPopupPreview = z.infer<typeof NameKeywordPopupSchema>;
export type NameKeywordScenePreview = z.infer<typeof NameKeywordPreviewsSchema>[number];

export type { FlowSceneExport };
export type { ImportAssetsResult };

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

export function setSceneActive(projectId: string, sceneId: string, active: boolean, expectedVersion: number): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/active`, ProjectDetailSchema, {
    method: 'PATCH', body: { active, expectedVersion },
  });
}

export function setAllAssetType(projectId: string, assetType: 'image' | 'video'): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/set-asset-type`, ProjectDetailSchema, {
    method: 'POST', body: { assetType },
  });
}

export function generateAllVoiceovers(projectId: string, options: { startSceneId?: string } = {}): Promise<{ jobId: string }> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/generate-voiceover`, JobResponseSchema, {
    method: 'POST',
    ...(options.startSceneId === undefined ? {} : { body: options }),
  });
}

export function fitSceneToClip(projectId: string, sceneId: string, expectedVersion: number): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/fit-to-clip`, ProjectDetailSchema, {
    method: 'POST', body: { expectedVersion },
  });
}

export function setSceneTail(projectId: string, sceneTailSec: number): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scene-tail`, ProjectDetailSchema, {
    method: 'PATCH', body: { sceneTailSec },
  });
}

export function setSfxVolume(projectId: string, sfxVolume: number): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/sfx-volume`, ProjectDetailSchema, {
    method: 'PATCH', body: { sfxVolume },
  });
}

export function setVoiceSpeed(projectId: string, voiceSpeed: number): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/voice-speed`, ProjectDetailSchema, {
    method: 'PATCH', body: { voiceSpeed },
  });
}

export function recomputeSceneDurations(projectId: string): Promise<RecomputeSceneDurationsResult> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/recompute-durations`, RecomputeSceneDurationsResultSchema, { method: 'POST' });
}

export function voiceoverSummary(result: unknown): string | null {
  const parsed = VoiceoverBatchResultSchema.safeParse(result);
  if (!parsed.success) return null;
  const { generated, skippedSceneNumbers, skippedInactive } = parsed.data;
  return `Đã tạo voiceover cho ${generated} scene; bỏ qua ${skippedSceneNumbers.length} scene không có lời dẫn${skippedSceneNumbers.length > 0 ? ` (scene ${skippedSceneNumbers.join(', ')})` : ''}; bỏ qua ${skippedInactive} scene đã tắt.`;
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

export function generateAllSfx(projectId: string, onlyMissing = false): Promise<{ jobId: string }> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/generate-all-sfx`, JobResponseSchema, { method: 'POST', body: { onlyMissing } });
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

async function projectLogoRequest(projectId: string, init: RequestInit): Promise<ProjectDetail> {
  const response = await fetch(`/api/project/${encodeURIComponent(projectId)}/logo`, init);
  if (!response.ok) {
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = null; }
    const parsed = ApiErrorBodySchema.safeParse(payload);
    if (parsed.success) throw new ApiError(parsed.data.error.message, response.status, parsed.data.error.code, parsed.data.error.fields);
    throw new ApiError(`Yêu cầu thất bại (${response.status}).`, response.status, 'unknown_error');
  }
  return ProjectDetailSchema.parse(await response.json());
}

export function uploadProjectLogo(projectId: string, file: File): Promise<ProjectDetail> {
  const body = new FormData();
  body.append('file', file);
  return projectLogoRequest(projectId, { method: 'PUT', body });
}

export function removeProjectLogo(projectId: string): Promise<ProjectDetail> {
  return projectLogoRequest(projectId, { method: 'DELETE' });
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

export function analyzeProjectNameKeywords(projectId: string): Promise<NameKeywordAnalysisSummary> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/name-keywords/analyze`, NameKeywordAnalysisSummarySchema, { method: 'POST' });
}

export function analyzeProjectPopups(projectId: string, options: { backend: PopupBackend; density: PopupDensity; cliModel?: string }): Promise<{ jobId: string }> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/popup-analysis`, JobResponseSchema, {
    method: 'POST',
    body: { backend: options.backend, density: options.density, ...(options.backend === 'cli' && options.cliModel ? { cliModel: options.cliModel } : {}) },
  });
}

export function getClaudeCliStatus(): Promise<ClaudeCliStatus> {
  return apiRequest('/api/script/cli-status', ClaudeCliStatusSchema);
}

export function setPopupDensity(projectId: string, density: PopupDensity): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/popup-density`, ProjectDetailSchema, { method: 'PATCH', body: { density } });
}

export function setPopupPlanFlags(projectId: string, sceneId: string, input: { anchor: string; pinned?: boolean; suppressed?: boolean }): Promise<PopupPlanMutationResult> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/popup-plan/flags`, PopupPlanMutationResultSchema, { method: 'PATCH', body: input });
}

export function editPopupPlan(projectId: string, sceneId: string, popup: PopupPlanPopup): Promise<PopupPlanMutationResult> {
  const candidate = { kind: popup.kind, anchor: popup.anchor, display: popup.display, importance: popup.importance, reason: popup.reason, ...(popup.role ? { role: popup.role } : {}), ...(popup.evidence ? { evidence: popup.evidence } : {}) };
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/popup-plan`, PopupPlanMutationResultSchema, { method: 'PATCH', body: candidate });
}


export function getNameKeywordPreviews(projectId: string): Promise<NameKeywordScenePreview[]> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/name-keywords/previews`, NameKeywordPreviewsSchema);
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

export function setAiProvider(projectId: string, provider: 'deepseek' | 'claude', aiModel?: string): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/ai-provider`, ProjectDetailSchema, {
    method: 'PATCH', body: { provider, ...(aiModel === undefined ? {} : { aiModel }) },
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
  const entries = activeScenes(project.scenes.map((scene, index) => ({ scene, index, active: scene.active })));
  return entries.flatMap(({ scene, index }) => scene.assetFileId ? [] : [index + 1]);
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
