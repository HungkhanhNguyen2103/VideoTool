import { z } from 'zod';
import {
  type CreateProjectRequest,
  type ListProjectsQuery,
  ProjectDetailSchema,
  ProjectSummarySchema,
} from '../../../contracts/project';
import type { VisualStyleId } from '../../../contracts/project';
import { VisualStyleSampleSchema, VisualStyleSamplesSchema } from '../../../contracts/visual-style-sample';
import { ApiErrorBodySchema } from '../../../contracts/common';
import { ApiError, apiRequest } from '../../shared/api-client';

export function listProjects(query: ListProjectsQuery) {
  return apiRequest('/api/project', z.array(ProjectSummarySchema), {
    query: { q: query.q, status: query.status },
  });
}

export function createProject(input: CreateProjectRequest) {
  return apiRequest('/api/project', ProjectDetailSchema, { method: 'POST', body: input });
}

export function getProject(id: string) {
  return apiRequest(`/api/project/${id}`, ProjectDetailSchema);
}

export function duplicateProject(id: string) {
  return apiRequest(`/api/project/${id}/duplicate`, ProjectDetailSchema, { method: 'POST' });
}

export function deleteProject(id: string) {
  return apiRequest(`/api/project/${id}`, z.void(), { method: 'DELETE' });
}

export function getVisualStyleSamples() {
  return apiRequest('/api/visual-style-samples', VisualStyleSamplesSchema);
}

export async function uploadVisualStyleSample(styleId: VisualStyleId, file: File) {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`/api/visual-style-samples/${encodeURIComponent(styleId)}`, { method: 'PUT', body: form });
  if (!response.ok) {
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = null; }
    const parsed = ApiErrorBodySchema.safeParse(payload);
    if (parsed.success) throw new ApiError(parsed.data.error.message, response.status, parsed.data.error.code, parsed.data.error.fields);
    throw new ApiError(`Yêu cầu thất bại (${response.status}).`, response.status, 'unknown_error');
  }
  return VisualStyleSampleSchema.parse(await response.json());
}
