import { describe, expect, it } from 'vitest';
import { pickVideoSceneIndexes } from './video-scene-picker';

function sorted(result: Set<number>): number[] {
  return [...result].sort((a, b) => a - b);
}

describe('pickVideoSceneIndexes', () => {
  it('selects exactly 20% and includes every chapter opener deterministically', () => {
    const input = {
      chapterSceneCounts: Array.from({ length: 10 }, () => 10),
      currentTypes: Array.from({ length: 100 }, () => 'image' as const),
      locked: Array.from({ length: 100 }, () => false),
      targetPercent: 20,
    };

    const first = pickVideoSceneIndexes(input);
    const second = pickVideoSceneIndexes(input);

    expect(first.size).toBe(20);
    expect([...first].every((index) => index >= 0 && index < 100)).toBe(true);
    expect(Array.from({ length: 10 }, (_, chapter) => chapter * 10).every((index) => first.has(index))).toBe(true);
    expect(sorted(first)).toEqual(sorted(second));
  });

  it('uses the first opener when the target is smaller than the chapter count', () => {
    const result = pickVideoSceneIndexes({
      chapterSceneCounts: Array.from({ length: 10 }, () => 2),
      currentTypes: Array.from({ length: 20 }, () => 'image'),
      locked: Array.from({ length: 20 }, () => false),
      targetPercent: 15,
    });

    expect(sorted(result)).toEqual([0, 6, 12]);
  });

  it('handles zero, one-scene, and full targets', () => {
    expect(pickVideoSceneIndexes({ chapterSceneCounts: [3], currentTypes: ['image', 'image', 'image'], locked: [false, false, false], targetPercent: 0 })).toEqual(new Set());
    expect(pickVideoSceneIndexes({ chapterSceneCounts: [1], currentTypes: ['image'], locked: [false], targetPercent: 20 })).toEqual(new Set([0]));
    expect(pickVideoSceneIndexes({ chapterSceneCounts: [3], currentTypes: ['image', 'image', 'image'], locked: [false, false, false], targetPercent: 100 })).toEqual(new Set([0, 1, 2]));
  });

  it('falls back to one chapter when chapter layout is missing or mismatched', () => {
    const input = {
      currentTypes: Array.from({ length: 6 }, () => 'image' as const),
      locked: Array.from({ length: 6 }, () => false),
      targetPercent: 50,
    };

    expect(sorted(pickVideoSceneIndexes({ ...input, chapterSceneCounts: [] }))).toEqual([0, 2, 4]);
    expect(sorted(pickVideoSceneIndexes({ ...input, chapterSceneCounts: [2, 2] }))).toEqual([0, 2, 4]);
    expect(() => pickVideoSceneIndexes({ ...input, chapterSceneCounts: [2, -1, 5.5] })).not.toThrow();
  });

  it('counts locked videos, never picks locked images, and keeps locked videos above target', () => {
    const result = pickVideoSceneIndexes({
      chapterSceneCounts: [4, 3],
      currentTypes: ['video', 'image', 'video', 'image', 'image', 'image', 'video'],
      locked: [true, true, false, false, false, false, true],
      targetPercent: 20,
    });

    expect(sorted(result)).toEqual([0, 6]);
    expect(result.has(1)).toBe(false);
  });

  it('does not create an opener from a chapter whose scenes are all locked', () => {
    const result = pickVideoSceneIndexes({
      chapterSceneCounts: [2, 3],
      currentTypes: ['image', 'video', 'image', 'image', 'image'],
      locked: [true, true, false, false, false],
      targetPercent: 60,
    });

    expect(sorted(result)).toEqual([1, 2, 4]);
  });

  it('takes evenly spaced remaining unlocked scenes after all openers', () => {
    const result = pickVideoSceneIndexes({
      chapterSceneCounts: [3, 3],
      currentTypes: Array.from({ length: 6 }, () => 'image'),
      locked: [false, false, false, false, false, false],
      targetPercent: 100,
    });

    expect(sorted(result)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
