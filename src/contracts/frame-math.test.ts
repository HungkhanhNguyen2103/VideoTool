import { describe, expect, it } from 'vitest';
import { sceneFrames, secondsToFrames } from './frame-math';

describe('shared frame conversion', () => {
  it('rounds each scene once and totals exactly the segment frame counts', () => {
    const durations = [1.01, 1.02, 2.03];
    const segments = sceneFrames(durations, 24);
    expect(segments).toEqual([24, 24, 49]);
    expect(segments.reduce((sum, frames) => sum + frames, 0)).toBe(97);
    expect(durations.reduce((sum, duration) => sum + secondsToFrames(duration, 24), 0)).toBe(97);
  });
});
