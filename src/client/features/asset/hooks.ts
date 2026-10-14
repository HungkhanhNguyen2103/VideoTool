import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query';
import type { ProjectDetail } from '../../../contracts/project';
import { ApiError } from '../../shared/api-client';
import { toast } from '../../shared/ui/toast-store';
import * as api from './api';

export const sceneDetailQueryKey = (projectId: string) => ['projects', 'detail', projectId] as const;

export type SetSceneActiveInput = { sceneId: string; active: boolean; expectedVersion: number };
type SceneActiveMutationContext = { previousProject: ProjectDetail | undefined };
type SetSceneActiveRequest = typeof api.setSceneActive;

export function createSceneActiveMutationOptions(
  projectId: string,
  queryClient: QueryClient,
  request: SetSceneActiveRequest = api.setSceneActive,
  notify: (message: string) => void = toast,
): UseMutationOptions<ProjectDetail, Error, SetSceneActiveInput, SceneActiveMutationContext> {
  const queryKey = sceneDetailQueryKey(projectId);
  return {
    mutationFn: ({ sceneId, active, expectedVersion }) => request(projectId, sceneId, active, expectedVersion),
    onMutate: async ({ sceneId, active }) => {
      await queryClient.cancelQueries({ queryKey });
      const previousProject = queryClient.getQueryData<ProjectDetail>(queryKey);
      if (previousProject) {
        queryClient.setQueryData<ProjectDetail>(queryKey, {
          ...previousProject,
          version: previousProject.version + 1,
          scenes: previousProject.scenes.map((scene) => scene.id === sceneId ? { ...scene, active } : scene),
        });
      }
      return { previousProject };
    },
    onError: (error, _variables, context) => {
      if (context?.previousProject) queryClient.setQueryData(queryKey, context.previousProject);
      notify(error instanceof ApiError && error.status === 409
        ? 'Dự án vừa thay đổi hoặc đang xử lý; vui lòng thử lại.'
        : 'Không thể thay đổi trạng thái scene.');
    },
    onSuccess: (project) => { queryClient.setQueryData(queryKey, project); },
    onSettled: async () => { await queryClient.invalidateQueries({ queryKey }); },
  };
}

export function useSetSceneActive(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation(createSceneActiveMutationOptions(projectId, queryClient));
}
