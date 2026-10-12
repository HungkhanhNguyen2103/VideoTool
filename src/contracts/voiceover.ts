import { z } from 'zod';
import { hashNarration } from './name-keywords';

export const DEFAULT_VOICE_SPEED = 1;

export function hasVoiceSpeedStep(value: number): boolean {
  return Math.abs(value * 20 - Math.round(value * 20)) < 1e-8;
}

export const VoiceSpeedSchema = z.number().finite().min(0.8).max(1.3).refine(hasVoiceSpeedStep, {
  message: 'Voice speed must use 0.05 steps.',
}).default(DEFAULT_VOICE_SPEED);

const EffectiveTtsSpeedSchema = z.number().finite().min(0.5).max(2);
export const VoiceoverInputSchema = z.object({
  voice: z.string().min(1),
  speed: EffectiveTtsSpeedSchema,
  // Older projects have no narration fingerprint. They parse safely but are stale
  // until regenerated, because freshness requires this value to be present.
  narrationHash: z.string().min(1).optional(),
});
export type VoiceoverInput = z.infer<typeof VoiceoverInputSchema>;

export function isVoiceoverFresh(
  scene: { narration: string; audioFileId: string | null; voiceoverInput?: VoiceoverInput | null },
  project: { voiceoverVoice: string; voiceSpeed: number },
): boolean {
  return scene.audioFileId !== null
    && scene.voiceoverInput != null
    && scene.voiceoverInput.voice === project.voiceoverVoice
    && scene.voiceoverInput.speed === project.voiceSpeed
    && scene.voiceoverInput.narrationHash === hashNarration(scene.narration);
}
