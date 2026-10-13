import { describe, expect, it } from 'vitest';
import { assertSceneActive } from './index';

describe('scene active guard', () => {
  it('rejects inactive single-scene actions with a Vietnamese SCENE_INACTIVE conflict', () => {
    try {
      assertSceneActive({ active: false });
      throw new Error('Expected an inactive scene to be rejected.');
    } catch (error) {
      expect(error).toMatchObject({ status: 409, code: 'SCENE_INACTIVE', message: expect.stringContaining('Scene này đang tắt') });
    }
  });

  it('allows legacy scenes without an active flag', () => {
    expect(() => assertSceneActive({})).not.toThrow();
  });
});
