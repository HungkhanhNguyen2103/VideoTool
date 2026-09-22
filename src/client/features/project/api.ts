import { z } from 'zod';
import {
  type CreateProjectRequest,
  type ListProjectsQuery,
  ProjectDetailSchema,
  ProjectSummarySchema,
} from '../../../contracts/project';
import { apiRequest } from '../../shared/api-client';

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
