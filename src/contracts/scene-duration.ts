import { z } from 'zod';

/** Owner-chosen short buffer after each voiceover; editable per project. */
export const DEFAULT_SCENE_TAIL_SEC = 0.2;

export function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}

export const SceneDurationSecSchema = z.number().finite().nonnegative().refine(hasAtMostTwoDecimals);
export const SceneTailSecSchema = z.number().finite().min(0).max(2).refine(hasAtMostTwoDecimals);

export function roundDurationSeconds(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function durationWithTail(audioDurationSec: number, sceneTailSec: number): number {
  return roundDurationSeconds(audioDurationSec + sceneTailSec);
}

export function formatDurationSeconds(durationSec: number): string {
  return Number.isInteger(durationSec) ? String(durationSec) : String(Number(durationSec.toFixed(1)));
}

export type SceneDurationStatusInput = {
  durationSec: number;
  audioFileId: string | null;
  voiceoverDurationSec?: number | null;
};

export function hasUnappliedSceneTailForScene(scene: SceneDurationStatusInput, sceneTailSec: number): boolean {
  if (!scene.audioFileId) return false;
  if (scene.voiceoverDurationSec == null) return true;
  return scene.durationSec !== durationWithTail(scene.voiceoverDurationSec, sceneTailSec);
}

export function hasUnappliedSceneTail(scenes: readonly SceneDurationStatusInput[], sceneTailSec: number): boolean {
  return scenes.some((scene) => hasUnappliedSceneTailForScene(scene, sceneTailSec));
}
