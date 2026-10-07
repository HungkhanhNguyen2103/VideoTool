import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENE_TAIL_SEC,
  SceneDurationSecSchema,
  SceneTailSecSchema,
  durationWithTail,
  formatDurationSeconds,
  hasUnappliedSceneTail,
} from './scene-duration';

describe('scene duration helpers', () => {
  it('adds a configurable tail and rounds the result to two decimals', () => {
    expect(durationWithTail(1.239, 0.2)).toBe(1.44);
    expect(durationWithTail(1.239, 0)).toBe(1.24);
    expect(durationWithTail(1.239, 2)).toBe(3.24);
  });

  it('validates fractional scene durations and tail settings while preserving legacy integers', () => {
    expect(DEFAULT_SCENE_TAIL_SEC).toBe(0.2);
    expect(SceneDurationSecSchema.safeParse(12).success).toBe(true);
    expect(SceneDurationSecSchema.safeParse(12.34).success).toBe(true);
    expect(SceneDurationSecSchema.safeParse(12.345).success).toBe(false);
    expect([0, 0.2, 2].every((value) => SceneTailSecSchema.safeParse(value).success)).toBe(true);
    expect([ -0.01, 2.01, 0.005 ].some((value) => SceneTailSecSchema.safeParse(value).success)).toBe(false);
  });

  it('formats durations with at most one decimal and keeps whole seconds compact', () => {
    expect([12, 12.4, 12.46].map(formatDurationSeconds)).toEqual(['12', '12.4', '12.5']);
  });

  it('flags existing or unmeasured voiceovers whose tail setting is not applied', () => {
    const scene = { durationSec: 2.4, audioFileId: 'voice-1', voiceoverDurationSec: 2.2 };
    expect(hasUnappliedSceneTail([scene], 0.2)).toBe(false);
    expect(hasUnappliedSceneTail([scene], 0.5)).toBe(true);
    expect(hasUnappliedSceneTail([{ ...scene, voiceoverDurationSec: null }], 0.2)).toBe(true);
    expect(hasUnappliedSceneTail([{ ...scene, audioFileId: null }], 0.5)).toBe(false);
    expect(hasUnappliedSceneTail([], 0.2)).toBe(false);
  });
});
