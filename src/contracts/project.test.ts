import { describe, expect, it } from 'vitest';
import { CreateProjectRequestSchema } from './project';

const validCreateInput = {
  title: 'Contract project',
  brief: 'A sufficiently long project brief.',
  language: 'vi' as const,
  referencesText: '',
  scriptPresetId: 'documentary' as const,
  targetDurationSec: 60,
  chapterCount: 1,
  voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

describe('visual style project field', () => {
  it('defaults create requests to cinematic and rejects unknown styles', () => {
    expect(CreateProjectRequestSchema.parse(validCreateInput).visualStylePresetId).toBe('cinematic');
    expect(() => CreateProjectRequestSchema.parse({ ...validCreateInput, visualStylePresetId: 'oil' })).toThrow();
  });

});
