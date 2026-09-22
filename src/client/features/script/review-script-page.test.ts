import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { getReviewStepperState } from './ReviewScriptPage';

describe('ReviewScriptPage stepper', () => {
  it('marks script generation as not started when there are no chapters or job', () => {
    expect(getReviewStepperState(0, null, false)).toEqual({
      currentStep: 1,
      stepSubs: ['Hoàn tất', 'Chưa bắt đầu', 'Chưa bắt đầu', 'Chưa bắt đầu'],
    });
  });

  it('marks script generation as active while a chapter-generation job is running', () => {
    expect(getReviewStepperState(0, 'job-1', false)).toEqual({
      currentStep: 1,
      stepSubs: ['Hoàn tất', 'Đang thực hiện', 'Chưa bắt đầu', 'Chưa bắt đầu'],
    });
  });

  it('advances to finalization after all chapters are approved', () => {
    expect(getReviewStepperState(2, null, true)).toEqual({
      currentStep: 3,
      stepSubs: ['Hoàn tất', 'Hoàn tất', 'Hoàn tất', 'Sẵn sàng'],
    });
  });
});

describe('ReviewScriptPage theme tokens', () => {
  it('uses the shared dark-theme tokens instead of undefined light fallbacks', async () => {
    const css = await readFile('src/client/features/script/ReviewScriptPage.module.css', 'utf8');

    expect(css).not.toMatch(/var\(--(?:surface|surface-subtle|line|muted|accent)\b/);
    expect(css).toContain('var(--panel)');
    expect(css).toContain('var(--panel-2)');
    expect(css).toContain('var(--border)');
    expect(css).toContain('var(--text-3)');
    expect(css).toContain('var(--amber)');
  });
});
