import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { getReviewStepperState, qaReviewerDisplay, shouldOfferOpeningHook } from './ReviewScriptPage';

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

describe('ReviewScriptPage opening hook action', () => {
  it('offers the hook only when chapter one does not already start with it', () => {
    expect(shouldOfferOpeningHook({ no: 1, paragraphs: ['Different first paragraph'] }, 'The opening hook.')).toBe(true);
    expect(shouldOfferOpeningHook({ no: 1, paragraphs: [' The opening hook. '] }, 'The opening hook.')).toBe(false);
    expect(shouldOfferOpeningHook({ no: 2, paragraphs: ['Different first paragraph'] }, 'The opening hook.')).toBe(false);
  });
});

describe('ReviewScriptPage QA reviewer display', () => {
  it('shows the provider before QA, the returned model after QA, and the legacy fallback', () => {
    expect(qaReviewerDisplay('deepseek', null)).toEqual({
      line: 'Sẽ kiểm tra bằng: DeepSeek',
      hint: null,
    });
    expect(qaReviewerDisplay('deepseek', { issues: [], reviewedBy: { provider: 'deepseek', model: 'deepseek-chat' } })).toEqual({
      line: 'Đã kiểm tra bằng: DeepSeek · deepseek-chat',
      hint: 'Cùng nhà cung cấp với bước viết kịch bản; kết quả có thể bỏ sót các lỗi tương tự. Hãy đối chiếu số liệu với tài liệu tham khảo.',
    });
    expect(qaReviewerDisplay('claude', { issues: [] })).toEqual({
      line: 'Đã kiểm tra bằng: Claude · Model: không có thông tin',
      hint: null,
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

  it('renders finalization failures as a visible alert', async () => {
    const source = await readFile('src/client/features/script/ReviewScriptPage.tsx', 'utf8');

    expect(source).toContain('role="alert"');
    expect(source).toContain('finalizeError');
  });

  it('renders the QA reviewer metadata below the QA button', async () => {
    const source = await readFile('src/client/features/script/ReviewScriptPage.tsx', 'utf8');

    expect(source).toContain('qaReviewerDisplay');
    expect(source).toContain('Sẽ kiểm tra bằng:');
    expect(source).toContain('Đã kiểm tra bằng:');
    expect(source).toContain('Model: không có thông tin');
  });
});
