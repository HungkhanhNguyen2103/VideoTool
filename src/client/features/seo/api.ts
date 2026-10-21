import { z } from 'zod';
import type { FileSummary } from '../../../contracts/file';
import { FileSummarySchema } from '../../../contracts/file';
import { ProjectDetailSchema, type ProjectDetail } from '../../../contracts/project';
import { SEO_SECTIONS, SeoPatchSchema, type SeoPatch, type SeoSection } from '../../../contracts/seo';
import { ApiError, apiRequest } from '../../shared/api-client';
import { ApiErrorBodySchema } from '../../../contracts/common';

const JobResponseSchema = z.object({ jobId: z.string() });
const ManualPromptResponseSchema = z.object({ prompt: z.string(), promptVersion: z.string() });
const FileListSchema = z.array(FileSummarySchema);
const ChannelTitlesResponseSchema = z.object({ titles: z.array(z.string()) }).strict();

export function getSeoProject(projectId: string): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}`, ProjectDetailSchema);
}

export function listSeoFiles(projectId: string): Promise<FileSummary[]> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/files`, FileListSchema);
}

export async function getSeoChannelTitles(projectId: string): Promise<string[]> {
  const response = await apiRequest(`/api/project/${encodeURIComponent(projectId)}/seo/channel-titles`, ChannelTitlesResponseSchema);
  return response.titles;
}

export function generateSeo(projectId: string, sections: SeoSection[] = [...SEO_SECTIONS]): Promise<{ jobId: string }> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/seo/generate`, JobResponseSchema, { method: 'POST', body: { sections } });
}

export function getSeoManualPrompt(projectId: string, sections: SeoSection[] = [...SEO_SECTIONS.filter((section) => section !== 'shorts')]): Promise<{ prompt: string; promptVersion: string }> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/seo/manual-prompt`, ManualPromptResponseSchema, {
    query: { sections: sections.join(',') },
  });
}

export function importSeo(projectId: string, raw: string, sections: SeoSection[]): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/seo/manual-import`, ProjectDetailSchema, {
    method: 'POST', body: { raw, sections },
  });
}

export function patchSeo(projectId: string, patch: SeoPatch): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/seo`, ProjectDetailSchema, {
    method: 'PATCH', body: SeoPatchSchema.parse(patch),
  });
}

async function thumbnailRequest(projectId: string, init: RequestInit): Promise<ProjectDetail> {
  const response = await fetch(`/api/project/${encodeURIComponent(projectId)}/seo/thumbnail`, init);
  if (!response.ok) {
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = null; }
    const parsed = ApiErrorBodySchema.safeParse(payload);
    if (parsed.success) throw new ApiError(parsed.data.error.message, response.status, parsed.data.error.code, parsed.data.error.fields);
    throw new ApiError(`Yêu cầu thất bại (${response.status}).`, response.status, 'unknown_error');
  }
  return ProjectDetailSchema.parse(await response.json());
}

export function uploadSeoThumbnail(projectId: string, file: File): Promise<ProjectDetail> {
  const body = new FormData();
  body.append('file', file);
  return thumbnailRequest(projectId, { method: 'PUT', body });
}

export function removeSeoThumbnail(projectId: string): Promise<ProjectDetail> {
  return thumbnailRequest(projectId, { method: 'DELETE' });
}

export function setSeoAiProvider(projectId: string, provider: 'deepseek' | 'claude', aiModel?: string): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/ai-provider`, ProjectDetailSchema, { method: 'PATCH', body: { provider, ...(aiModel === undefined ? {} : { aiModel }) } });
}
