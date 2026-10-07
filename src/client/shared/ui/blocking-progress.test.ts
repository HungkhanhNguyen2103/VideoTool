import { describe, expect, it } from 'vitest';
import {
  blockingProgressViewModel,
  blockingTaskTitle,
  formatElapsedMs,
  isStudioLocked,
  shouldShowBlockingProgress,
  taskFromBusyKey,
} from './blocking-progress';

describe('blocking progress helpers', () => {
  it('derives human-readable task titles, including a scene label', () => {
    expect(blockingTaskTitle({ kind: 'render' })).toBe('Đang render video');
    expect(blockingTaskTitle({ kind: 'voiceover', detail: 'Scene 02' })).toBe('Đang tạo voiceover · Scene 02');
  });

  it('maps per-scene busy keys without inventing a scene number', () => {
    expect(taskFromBusyKey('voice:scene-2', (id) => id === 'scene-2' ? 'Scene 02' : undefined)).toEqual({ kind: 'voiceover', detail: 'Scene 02' });
    expect(taskFromBusyKey('voice:missing', () => undefined)).toEqual({ kind: 'voiceover' });
    expect(taskFromBusyKey('render-engine', () => undefined)).toEqual({ kind: 'quick', detail: 'đổi render engine', immediate: false });
    expect(taskFromBusyKey('copy', () => undefined)).toEqual({ kind: 'quick', detail: 'sao chép JSON', immediate: false });
    expect(taskFromBusyKey('unknown', () => undefined)).toBeNull();
  });

  it('shows the indeterminate name-popup analysis task through the shared blocking overlay', () => {
    const task = taskFromBusyKey('name-keywords', () => undefined);
    expect(task).toEqual({ kind: 'name-keywords' });
    expect(blockingTaskTitle(task!)).toBe('Đang phân tích tên popup');
    expect(isStudioLocked('name-keywords', null, null)).toBe(true);
    expect(blockingProgressViewModel({ task: task!, jobId: null, progress: null, uploadProgress: null, startedAt: 0, lastEventAt: null, now: 1 }).indeterminate).toBe(true);
  });

  it('locks while an operation is busy or an active job has not reached a terminal state', () => {
    expect(isStudioLocked('import', null, null)).toBe(true);
    expect(isStudioLocked(null, 'job-1', null)).toBe(true);
    expect(isStudioLocked(null, 'job-1', { status: 'running' })).toBe(true);
    expect(isStudioLocked(null, 'job-1', { status: 'failed' })).toBe(false);
    expect(isStudioLocked(null, null, null)).toBe(false);
  });

  it('delays non-job overlays but shows immediate tasks at once', () => {
    expect(shouldShowBlockingProgress(true, false, 399)).toBe(false);
    expect(shouldShowBlockingProgress(true, false, 400)).toBe(true);
    expect(shouldShowBlockingProgress(true, true, 0)).toBe(true);
  });

  it('keeps only the newest real log lines and marks stale progress', () => {
    const view = blockingProgressViewModel({
      task: { kind: 'render' },
      jobId: 'job-1',
      progress: { status: 'running', progress: 42, error: null, logs: ['one', 'two', 'three', 'four'] },
      uploadProgress: null,
      startedAt: 0,
      lastEventAt: 0,
      now: 45_000,
    });
    expect(view.statusText).toBe('Đang chạy');
    expect(view.percent).toBe(42);
    expect(view.logs).toEqual(['two', 'three', 'four']);
    expect(view.elapsedText).toBe('00:45');
    expect(view.staleConnection).toBe(true);
    expect(view.canCancel).toBe(true);
  });

  it('uses upload progress and exposes terminal failure without fabricated details', () => {
    const view = blockingProgressViewModel({
      task: { kind: 'import-zip' },
      jobId: null,
      progress: { status: 'failed', progress: 0, error: 'ZIP hỏng', logs: [] },
      uploadProgress: 18,
      startedAt: 10_000,
      lastEventAt: null,
      now: 11_234,
    });
    expect(view.percent).toBe(18);
    expect(view.statusText).toBe('Tác vụ thất bại');
    expect(view.error).toBe('ZIP hỏng');
    expect(view.canCancel).toBe(false);
    expect(view.detail).toBeNull();
  });

  it('labels an awaited non-job operation as running instead of queued', () => {
    const view = blockingProgressViewModel({
      task: { kind: 'voiceover', detail: 'Scene 01' },
      jobId: null,
      progress: null,
      uploadProgress: null,
      startedAt: 0,
      lastEventAt: null,
      now: 1_000,
    });
    expect(view.statusText).toBe('Đang chạy');
  });

  it('formats elapsed time as minutes and seconds', () => {
    expect(formatElapsedMs(65_000)).toBe('01:05');
    expect(formatElapsedMs(3_665_000)).toBe('61:05');
  });
});
