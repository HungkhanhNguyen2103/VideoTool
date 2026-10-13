import { describe, expect, it } from 'vitest';
import { activeScenes, countInactiveScenes, isSceneActive } from './scene-active';

describe('scene active helpers', () => {
  it('treats scenes without the additive flag as active and preserves active order', () => {
    const scenes = [
      { id: 'scene-1' },
      { id: 'scene-2', active: false },
      { id: 'scene-3', active: true },
    ];

    expect(isSceneActive(scenes[0]!)).toBe(true);
    expect(activeScenes(scenes).map((scene) => scene.id)).toEqual(['scene-1', 'scene-3']);
    expect(countInactiveScenes(scenes)).toBe(1);
  });
});
