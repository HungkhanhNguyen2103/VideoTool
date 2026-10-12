import { describe, expect, it } from 'vitest';
import { hashNarration } from './name-keywords';
import { DEFAULT_VOICE_SPEED, VoiceSpeedSchema, isVoiceoverFresh } from './voiceover';

describe('voiceover freshness contract', () => {
  it('defaults and validates the project narration speed', () => {
    expect(VoiceSpeedSchema.parse(undefined)).toBe(DEFAULT_VOICE_SPEED);
    expect(VoiceSpeedSchema.parse(0.8)).toBe(0.8);
    expect(VoiceSpeedSchema.parse(1.3)).toBe(1.3);
    expect(() => VoiceSpeedSchema.parse(0.75)).toThrow();
    expect(() => VoiceSpeedSchema.parse(1.1)).not.toThrow();
    expect(() => VoiceSpeedSchema.parse(1.11)).toThrow();
  });

  it('treats legacy and mismatched voice inputs as stale', () => {
    const project = { voiceoverVoice: 'Truc Ly', voiceSpeed: 1 };
    const baseScene = { narration: 'Narration', audioFileId: 'voice-1', voiceoverInput: { voice: 'Truc Ly', speed: 1, narrationHash: hashNarration('Narration') } };

    expect(isVoiceoverFresh({ ...baseScene, voiceoverInput: null }, project)).toBe(false);
    expect(isVoiceoverFresh({ ...baseScene, voiceoverInput: { voice: 'Truc Ly', speed: 1.2 } }, project)).toBe(false);
    expect(isVoiceoverFresh({ ...baseScene, voiceoverInput: { voice: 'Other', speed: 1 } }, project)).toBe(false);
    expect(isVoiceoverFresh(baseScene, project)).toBe(true);
  });
});
