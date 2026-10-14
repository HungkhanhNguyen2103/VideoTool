import { countInactiveScenes, activeScenes, type SceneActivationState } from '../../../contracts/scene-active';
import * as api from './api';

type SceneWithDuration = SceneActivationState & { durationSec: number };

export type SceneActivitySummary = {
  activeCount: number;
  inactiveCount: number;
  activeDurationSec: number;
};

export function summarizeSceneActivity(scenes: readonly SceneWithDuration[]): SceneActivitySummary {
  const active = activeScenes(scenes);
  return {
    activeCount: active.length,
    inactiveCount: countInactiveScenes(scenes),
    activeDurationSec: active.reduce((sum, scene) => sum + scene.durationSec, 0),
  };
}

export function formatSceneActivityHeader(summary: SceneActivitySummary): string {
  return `${summary.activeCount} scene đang bật · ${summary.inactiveCount} đã tắt`;
}

export function formatBatchSceneCount<T extends SceneActivationState>(
  scenes: readonly T[],
  eligible: (scene: T) => boolean = () => true,
): string {
  const count = activeScenes(scenes).filter(eligible).length;
  const inactiveCount = countInactiveScenes(scenes);
  return `${count} scene${inactiveCount > 0 ? `, bỏ qua ${inactiveCount} scene đã tắt` : ''}`;
}

export function formatSkippedInactiveToast(result: unknown): string | null {
  if (!result || typeof result !== 'object' || !('skippedInactive' in result)) return null;
  const skippedInactive = (result as { skippedInactive?: unknown }).skippedInactive;
  return typeof skippedInactive === 'number' && Number.isInteger(skippedInactive) && skippedInactive >= 0
    ? `Tác vụ hoàn tất; bỏ qua ${skippedInactive} scene đã tắt.`
    : null;
}

export function isSceneToggleDisabled(input: {
  jobId: string | null;
  progress: { status: string } | null;
  busy: string | null;
  mutationPending: boolean;
}): boolean {
  return input.mutationPending || input.busy !== null || api.isProjectJobActive(input.jobId, input.progress);
}
