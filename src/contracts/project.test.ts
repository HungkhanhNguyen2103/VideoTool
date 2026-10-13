import { describe, expect, it } from 'vitest';
import { CreateProjectRequestSchema, SceneSchema } from './project';

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
  it('defaults create requests to cinematic, accepts flat-cartoon and strategic-map, and rejects unknown styles', () => {
    expect(CreateProjectRequestSchema.parse(validCreateInput).visualStylePresetId).toBe('cinematic');
    expect(CreateProjectRequestSchema.parse({ ...validCreateInput, visualStylePresetId: 'flat-cartoon' }).visualStylePresetId).toBe('flat-cartoon');
    expect(CreateProjectRequestSchema.parse({ ...validCreateInput, visualStylePresetId: 'strategic-map' as never }).visualStylePresetId).toBe('strategic-map');
    expect(() => CreateProjectRequestSchema.parse({ ...validCreateInput, visualStylePresetId: 'oil' })).toThrow();
  });

});

describe('script preset project field', () => {
  it('accepts strategist as a script preset', () => {
    expect(CreateProjectRequestSchema.parse({ ...validCreateInput, scriptPresetId: 'strategist' as never }).scriptPresetId).toBe('strategist');
  });
});

describe('voice speed project field', () => {
  it('defaults new project requests to normal narration speed and preserves valid steps', () => {
    expect(CreateProjectRequestSchema.parse(validCreateInput).voiceSpeed).toBe(1);
    expect(CreateProjectRequestSchema.parse({ ...validCreateInput, voiceSpeed: 1.2 }).voiceSpeed).toBe(1.2);
  });

  it('rejects speeds outside 0.8–1.3 or off the 0.05 step', () => {
    expect(() => CreateProjectRequestSchema.parse({ ...validCreateInput, voiceSpeed: 0.75 })).toThrow();
    expect(() => CreateProjectRequestSchema.parse({ ...validCreateInput, voiceSpeed: 1.31 })).toThrow();
    expect(() => CreateProjectRequestSchema.parse({ ...validCreateInput, voiceSpeed: 1.11 })).toThrow();
  });
});

describe('scene active field', () => {
  const legacyScene = { id: 'scene-1', narration: 'Narration', visualPrompt: '', durationSec: 1 };

  it('defaults legacy scenes to active and preserves an explicit inactive flag', () => {
    expect(SceneSchema.parse(legacyScene).active).toBe(true);
    expect(SceneSchema.parse({ ...legacyScene, active: false }).active).toBe(false);
  });
});
