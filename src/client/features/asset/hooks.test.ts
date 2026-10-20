import { QueryClient, type MutationFunctionContext } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../shared/api-client';
import type { ProjectDetail } from '../../../contracts/project';
import { createRemoveSceneAssetMutationOptions, createSceneActiveMutationOptions, createUploadSceneAssetsMutationOptions, sceneDetailQueryKey, sceneFilesQueryKey } from './hooks';

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

describe('scene asset mutations', () => {
  it('uploads, clears the scene preview, and invalidates project and files', async () => {
    const client = new QueryClient();
    const clearPreview = vi.fn();
    const request = vi.fn().mockResolvedValue({ sceneId: 'scene-1', updated: { assetFileId: 'asset-1' }, files: [] });
    client.setQueryData(sceneDetailQueryKey('project-1'), project());
    client.setQueryData(sceneFilesQueryKey('project-1'), []);
    const options = createUploadSceneAssetsMutationOptions('project-1', client, clearPreview, request);
    const variables = { sceneId: 'scene-1', files: [new File(['x'], 'x.png')], onProgress: vi.fn() };
    const context: MutationFunctionContext = { client, meta: undefined };
    const result = await options.mutationFn?.(variables, context);
    await options.onSuccess?.(result!, variables, undefined, context);
    expect(request).toHaveBeenCalledWith('project-1', 'scene-1', variables.files, variables.onProgress);
    expect(clearPreview).toHaveBeenCalledWith('scene-1');
    expect(client.getQueryState(sceneDetailQueryKey('project-1'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(sceneFilesQueryKey('project-1'))?.isInvalidated).toBe(true);
  });

  it('removes a slot and invalidates both caches', async () => {
    const client = new QueryClient();
    const clearPreview = vi.fn();
    const request = vi.fn().mockResolvedValue({ sceneId: 'scene-1', updated: { assetFileId: null }, files: [] });
    client.setQueryData(sceneDetailQueryKey('project-1'), project());
    client.setQueryData(sceneFilesQueryKey('project-1'), []);
    const options = createRemoveSceneAssetMutationOptions('project-1', client, clearPreview, request);
    const variables = { sceneId: 'scene-1', slot: 'asset' as const };
    const context: MutationFunctionContext = { client, meta: undefined };
    const result = await options.mutationFn?.(variables, context);
    await options.onSuccess?.(result!, variables, undefined, context);
    expect(request).toHaveBeenCalledWith('project-1', 'scene-1', 'asset');
    expect(clearPreview).toHaveBeenCalledWith('scene-1');
    expect(client.getQueryState(sceneFilesQueryKey('project-1'))?.isInvalidated).toBe(true);
  });
});
