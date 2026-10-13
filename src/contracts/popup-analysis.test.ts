import { describe, expect, it } from 'vitest';
import { PopupDensitySchema, PopupPlanSchema } from './popup-analysis';

describe('popup analysis contracts', () => {
  it('defaults popup density to low for legacy project reads', () => {
    expect(PopupDensitySchema.parse(undefined)).toBe('low');
  });

  it('defaults an absent scene popup plan to null and accepts verdict metadata', () => {
    expect(PopupPlanSchema.parse(null)).toBeNull();
    expect(PopupPlanSchema.parse({
      narrationHash: 'fnv1a64:1',
      audioFileId: 'voice-1',
      provider: 'deepseek',
      model: 'deepseek-chat',
      backend: 'api',
      density: 'low',
      generatedAt: '2026-10-13T00:00:00.000Z',
      needed: false,
      reason: 'Không cần popup vì không có mốc mới.',
      popups: [],
      dropped: [],
    })).toMatchObject({ needed: false, popups: [], dropped: [] });
  });
});
