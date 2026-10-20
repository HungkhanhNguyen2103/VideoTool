import { describe, expect, it } from 'vitest';
import { FlowSceneExportSchema, SceneAssetsResponseSchema } from './asset';

const exportedScene = {
  sceneId: 1,
  sceneNumber: 1,
  title: 'opening',
  prompt: 'A wide valley.',
  assetType: 'image' as const,
  motionPrompt: '',
};

describe('FlowSceneExportSchema', () => {
  it('parses legacy exports without reference tags', () => {
    expect(FlowSceneExportSchema.parse(exportedScene)).toEqual(exportedScene);
  });

  it('parses exports with reference tags', () => {
    expect(FlowSceneExportSchema.parse({ ...exportedScene, referenceTags: ['core', 'wide'] })).toEqual({
      ...exportedScene,
      referenceTags: ['core', 'wide'],
    });
  });
});

describe('SceneAssetsResponseSchema', () => {
  it('parses a scene upload response with nullable updated slots and file summaries', () => {
    expect(SceneAssetsResponseSchema.parse({
      sceneId: 'scene-1',
      updated: { assetFileId: 'asset-1', videoKeyframeFileId: null, videoTailFileId: 'tail-1', videoDurationSec: 2.5 },
      files: [{ id: 'asset-1', projectId: 'project-1', originalName: 'clip.mp4', mimeType: 'video/mp4', ext: 'mp4', sizeBytes: 4, purpose: 'reference', storedPath: 'asset-1.mp4', createdAt: '2026-10-20T00:00:00.000Z' }],
    })).toMatchObject({ sceneId: 'scene-1', updated: { assetFileId: 'asset-1' } });
  });
});
