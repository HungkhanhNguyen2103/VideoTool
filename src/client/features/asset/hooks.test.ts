import { QueryClient, type MutationFunctionContext } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../shared/api-client';
import type { ProjectDetail } from '../../../contracts/project';
import { createSceneActiveMutationOptions, sceneDetailQueryKey } from './hooks';

function project(): ProjectDetail {
  return {
    id: 'project-1', version: 4,
    scenes: [{ id: 'scene-1', active: true }, { id: 'scene-2', active: false }],
  } as unknown as ProjectDetail;
}

describe('scene activation mutation', () => {
  it('optimistically toggles one scene, sends the expected version, installs the response, and invalidates details', async () => {
    const client = new QueryClient();
    const original = project();
    const saved = { ...original, version: 5, scenes: [{ ...original.scenes[0]!, active: false }, original.scenes[1]!] } as ProjectDetail;
    const request = vi.fn().mockResolvedValue(saved);
    client.setQueryData(sceneDetailQueryKey(original.id), original);
    const options = createSceneActiveMutationOptions(original.id, client, request, vi.fn());
    const variables = { sceneId: 'scene-1', active: false, expectedVersion: 4 };
    const mutationContext: MutationFunctionContext = { client, meta: undefined };
    const context = await options.onMutate?.(variables, mutationContext);
    if (!context) throw new Error('Expected an optimistic mutation context.');

    expect(client.getQueryData<ProjectDetail>(sceneDetailQueryKey(original.id))?.scenes[0]?.active).toBe(false);
    expect(await options.mutationFn?.(variables, mutationContext)).toBe(saved);
    expect(request).toHaveBeenCalledWith('project-1', 'scene-1', false, 4);
    await options.onSuccess?.(saved, variables, context, mutationContext);
    await options.onSettled?.(saved, null, variables, context, mutationContext);

    expect(client.getQueryData(sceneDetailQueryKey(original.id))).toEqual(saved);
    expect(client.getQueryState(sceneDetailQueryKey(original.id))?.isInvalidated).toBe(true);
  });

  it('rolls back an optimistic toggle on a 409 and shows a Vietnamese conflict message', async () => {
    const client = new QueryClient();
    const original = project();
    const notify = vi.fn();
    const error = new ApiError('Project changed, preview again.', 409, 'PROJECT_CHANGED');
    client.setQueryData(sceneDetailQueryKey(original.id), original);
    const options = createSceneActiveMutationOptions(original.id, client, vi.fn(), notify);
    const variables = { sceneId: 'scene-1', active: false, expectedVersion: 4 };
    const mutationContext: MutationFunctionContext = { client, meta: undefined };
    const context = await options.onMutate?.(variables, mutationContext);

    await options.onError?.(error, variables, context, mutationContext);

    expect(client.getQueryData(sceneDetailQueryKey(original.id))).toEqual(original);
    expect(notify).toHaveBeenCalledWith('Dự án vừa thay đổi hoặc đang xử lý; vui lòng thử lại.');
  });
});
