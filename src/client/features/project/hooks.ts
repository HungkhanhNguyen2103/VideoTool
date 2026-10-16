import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateProjectRequest, ListProjectsQuery } from '../../../contracts/project';
import type { VisualStyleId } from '../../../contracts/project';
import * as api from './api';

const PROJECTS_KEY = ['projects'] as const;
const projectKey = (id: string) => ['projects', 'detail', id] as const;

export function useProjects(query: ListProjectsQuery) {
  return useQuery({ queryKey: [...PROJECTS_KEY, 'list', query], queryFn: () => api.listProjects(query) });
}

/** Used by the page header to show the currently open project's title/meta. */
export function useProject(id: string | null) {
  return useQuery({
    queryKey: id ? projectKey(id) : projectKey('none'),
    queryFn: () => api.getProject(id as string),
    enabled: id !== null,
  });
}

function useInvalidateProjects() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
}

export function useCreateProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (input: CreateProjectRequest) => api.createProject(input),
    onSuccess: invalidate,
  });
}

export function useDuplicateProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({ mutationFn: (id: string) => api.duplicateProject(id), onSuccess: invalidate });
}

export function useDeleteProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({ mutationFn: (id: string) => api.deleteProject(id), onSuccess: invalidate });
}

export function useVisualStyleSamples() {
  return useQuery({ queryKey: ['visual-style-samples'], queryFn: api.getVisualStyleSamples });
}

export function useUploadVisualStyleSample() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ styleId, file }: { styleId: import('../../../contracts/project').VisualStyleId; file: File }) => api.uploadVisualStyleSample(styleId, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['visual-style-samples'] }),
  });
}

const VISUAL_STYLE_PACKS_KEY = ['visual-style-packs'] as const;

export function useVisualStylePacks() {
  return useQuery({ queryKey: VISUAL_STYLE_PACKS_KEY, queryFn: api.getVisualStylePacks });
}

export function useUploadVisualStylePackImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ styleId, slotId, file }: { styleId: VisualStyleId; slotId: string; file: File }) => api.uploadVisualStylePackImage(styleId, slotId, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: VISUAL_STYLE_PACKS_KEY }),
  });
}

export function useDeleteVisualStylePackImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ styleId, slotId }: { styleId: VisualStyleId; slotId: string }) => api.deleteVisualStylePackImage(styleId, slotId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: VISUAL_STYLE_PACKS_KEY }),
  });
}
