import { describe, expect, it } from 'vitest';
import { FlowSceneExportSchema } from './asset';

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
