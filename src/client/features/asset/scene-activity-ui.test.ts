import { describe, expect, it } from 'vitest';
import { formatBatchSceneCount, formatSkippedInactiveToast, isSceneToggleDisabled, summarizeSceneActivity } from './scene-activity-ui';

describe('Studio scene activity summaries', () => {
  it('counts active scenes and duration while reporting inactive scenes separately', () => {
    expect(summarizeSceneActivity([
      { durationSec: 3 },
      { active: false, durationSec: 11 },
      { active: true, durationSec: 4.5 },
    ])).toEqual({ activeCount: 2, inactiveCount: 1, activeDurationSec: 7.5 });
  });

  it('shows skipped inactive count only when nonzero and counts eligible active scenes', () => {
    const scenes = [
      { narration: 'ready', active: true },
      { narration: 'off', active: false },
      { narration: '', active: true },
    ];

    expect(formatBatchSceneCount(scenes, (scene) => scene.narration.trim().length > 0)).toBe('1 scene, bỏ qua 1 scene đã tắt');
    expect(formatBatchSceneCount([{ active: true }, { active: true }])).toBe('2 scene');
  });

  it('disables the activation switch while a project job or local write is active', () => {
    expect(isSceneToggleDisabled({ jobId: 'job-1', progress: null, busy: null, mutationPending: false })).toBe(true);
    expect(isSceneToggleDisabled({ jobId: null, progress: null, busy: 'scene:scene-1', mutationPending: false })).toBe(true);
    expect(isSceneToggleDisabled({ jobId: null, progress: null, busy: null, mutationPending: true })).toBe(true);
    expect(isSceneToggleDisabled({ jobId: null, progress: null, busy: null, mutationPending: false })).toBe(false);
  });

  it('formats batch completion toasts only when a valid skippedInactive count exists', () => {
    expect(formatSkippedInactiveToast({ skippedInactive: 2 })).toBe('Tác vụ hoàn tất; bỏ qua 2 scene đã tắt.');
    expect(formatSkippedInactiveToast({ skippedInactive: 0 })).toBe('Tác vụ hoàn tất; bỏ qua 0 scene đã tắt.');
    expect(formatSkippedInactiveToast({})).toBeNull();
  });
});
