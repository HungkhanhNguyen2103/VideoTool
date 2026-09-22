import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { getReviewStepperState } from './ReviewScriptPage';

describe('ReviewScriptPage stepper', () => {
  it('marks script generation as not started when there are no chapters or job', () => {
    expect(getReviewStepperState(0, 0, null)).toEqual({
      currentStep: 1,
      steps: [
        { label: 'Dàn ý', sub: 'Hoàn tất', state: 'done' },
        { label: 'Nháp kịch bản', sub: 'Chưa bắt đầu', state: 'active' },
        { label: 'Duyệt & tái tạo', sub: 'Chưa bắt đầu', state: 'todo' },
        { label: 'Chốt & chia cảnh', sub: 'Chưa bắt đầu', state: 'todo' },
      ],
    });
  });

  it('marks script generation as active while a chapter-generation job is running', () => {
    expect(getReviewStepperState(0, 0, 'job-1')).toEqual({
      currentStep: 1,
      steps: [
        { label: 'Dàn ý', sub: 'Hoàn tất', state: 'done' },
        { label: 'Nháp kịch bản', sub: 'Đang thực hiện', state: 'active' },
        { label: 'Duyệt & tái tạo', sub: 'Chưa bắt đầu', state: 'todo' },
        { label: 'Chốt & chia cảnh', sub: 'Chưa bắt đầu', state: 'todo' },
      ],
    });
  });

  it('advances to finalization after all chapters are approved', () => {
    expect(getReviewStepperState(2, 2, null)).toEqual({
      currentStep: 3,
      steps: [
        { label: 'Dàn ý', sub: 'Hoàn tất', state: 'done' },
        { label: 'Nháp kịch bản', sub: 'Hoàn tất', state: 'done' },
        { label: 'Duyệt & tái tạo', sub: 'Hoàn tất', state: 'done' },
        { label: 'Chốt & chia cảnh', sub: 'Sẵn sàng', state: 'active' },
      ],
    });
  });

  it('shows the approved chapter count while review is still active', () => {
    expect(getReviewStepperState(5, 2, null)).toEqual({
      currentStep: 2,
      steps: [
        { label: 'Dàn ý', sub: 'Hoàn tất', state: 'done' },
        { label: 'Nháp kịch bản', sub: 'Hoàn tất', state: 'done' },
        { label: 'Duyệt & tái tạo', sub: 'Đã duyệt 2/5', state: 'active' },
        { label: 'Chốt & chia cảnh', sub: 'Chưa bắt đầu', state: 'todo' },
      ],
    });
  });

  it('moves the active state to finalization once every chapter is approved', () => {
    expect(getReviewStepperState(3, 3, null).steps.map((step) => step.state)).toEqual([
      'done',
      'done',
      'done',
      'active',
    ]);
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
