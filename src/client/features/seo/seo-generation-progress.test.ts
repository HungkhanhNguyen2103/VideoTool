import { describe, expect, it } from 'vitest';
import {
  deriveSeoGenerationStep,
  formatSeoElapsed,
  getSeoGenerationLiveness,
  getSeoGenerationStepStartAt,
  parseSeoGenerationStep,
  windowSeoGenerationLogs,
} from './seo-generation-progress';

describe('SEO generation progress helpers', () => {
  it('parses the step number, total, and name from a Vietnamese step log', () => {
    expect(parseSeoGenerationStep('Bước 2/2 — Shorts: vẫn đang chờ (03:30)…')).toEqual({ index: 2, total: 2, name: 'Shorts' });
    expect(parseSeoGenerationStep('Đã lưu gói SEO. Tổng thời gian 03:31.')).toBeNull();
  });

  it('derives the most recent step from progress logs', () => {
    expect(deriveSeoGenerationStep([
      'Bắt đầu tạo gói SEO: 2 bước (Phần chính, Shorts). Cách sinh: Claude CLI claude-sonnet-5-5.',
      'Bước 1/2 — Phần chính: xong.',
      'Bước 2/2 — Shorts: gửi yêu cầu (153 byte).',
    ])).toEqual({ index: 2, total: 2, name: 'Shorts' });
    expect(deriveSeoGenerationStep([])).toBeNull();
  });

  it('formats elapsed time as minutes and seconds', () => {
    expect(formatSeoElapsed(0)).toBe('00:00');
    expect(formatSeoElapsed(65_999)).toBe('01:05');
    expect(formatSeoElapsed(3_600_000)).toBe('60:00');
  });

  it('reports stale events and steps running for more than three minutes only while active', () => {
    expect(getSeoGenerationLiveness({ active: true, now: 200_000, lastEventAt: 155_000, stepStartedAt: 19_999 })).toEqual({ noSignalSeconds: null, slowStep: true });
    expect(getSeoGenerationLiveness({ active: true, now: 200_001, lastEventAt: 155_000, stepStartedAt: 19_999 })).toEqual({ noSignalSeconds: 45, slowStep: true });
    expect(getSeoGenerationLiveness({ active: false, now: 1_000_000, lastEventAt: 0, stepStartedAt: 0 })).toEqual({ noSignalSeconds: null, slowStep: false });
  });

  it('keeps the first request time for the current step across retries and heartbeat logs', () => {
    expect(getSeoGenerationStepStartAt([
      { text: 'Bước 1/2 — Phần chính: gửi yêu cầu (10 byte).', receivedAt: 100 },
      { text: 'Bước 1/2 — Phần chính: vẫn đang chờ (00:30)…', receivedAt: 30_100 },
      { text: 'Bước 1/2 — Phần chính: JSON chưa hợp lệ, thử lại 1 lần: invalid object', receivedAt: 60_100 },
      { text: 'Bước 1/2 — Phần chính: gửi yêu cầu (30 byte).', receivedAt: 60_101 },
    ])).toBe(100);
  });

  it('shows the newest log window in original arrival order', () => {
    expect(windowSeoGenerationLogs(Array.from({ length: 12 }, (_, index) => `line-${index + 1}`), 10))
      .toEqual(Array.from({ length: 10 }, (_, index) => `line-${index + 3}`));
    expect(windowSeoGenerationLogs(['one', 'two'], 10)).toEqual(['one', 'two']);
  });
});
