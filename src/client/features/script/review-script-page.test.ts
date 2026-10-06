import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { getReviewStepperState, qaReviewerDisplay, regenerationStatusLabel, shouldOfferOpeningHook } from './ReviewScriptPage';

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

describe('ReviewScriptPage regeneration toolbar', () => {
  it('labels automatic and manual status chips', () => {
    expect(regenerationStatusLabel('automatic', 'deepseek')).toBe('Tự động bằng DeepSeek');
    expect(regenerationStatusLabel('automatic', 'claude')).toBe('Tự động bằng Claude');
    expect(regenerationStatusLabel('manual', 'deepseek')).toBe('Thủ công: tự dán JSON');
  });
});

describe('ReviewScriptPage QA reviewer display', () => {
  it('shows the provider before QA and does not attribute a legacy result', () => {
    expect(qaReviewerDisplay('deepseek', null)).toEqual({
      lines: ['Tự động bằng DeepSeek'],
      hint: null,
    });
    expect(qaReviewerDisplay('claude', { issues: [] })).toEqual({
      lines: ['Đã kiểm tra: không có thông tin về model'],
      hint: null,
    });
  });

  it('shows the previous reviewer and next provider when the provider changed', () => {
    expect(qaReviewerDisplay('claude', { issues: [], reviewedBy: { provider: 'deepseek', model: 'deepseek-chat' } })).toEqual({
      lines: ['Lần kiểm tra trước: DeepSeek · deepseek-chat', 'Lần chạy tiếp theo: Claude'],
      hint: null,
    });
  });

  it('shows the same-provider result and the qualified caution hint', () => {
    expect(qaReviewerDisplay('deepseek', { issues: [], reviewedBy: { provider: 'deepseek', model: 'deepseek-chat' } })).toEqual({
      lines: ['Đã kiểm tra bằng: DeepSeek · deepseek-chat'],
      hint: 'Model kiểm tra có thể bỏ sót các lỗi giống model đã viết kịch bản nếu hai bên cùng nhà cung cấp. Hãy đối chiếu số liệu với tài liệu tham khảo.',
    });
  });

  it('labels a manually pasted result without a same-provider hint', () => {
    expect(qaReviewerDisplay('claude', { issues: [], reviewedBy: { provider: 'manual', model: 'Dán thủ công' } })).toEqual({
      lines: ['Đã kiểm tra: thủ công (dán JSON)'],
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
    expect(source).toContain('Tự động bằng');
    expect(source).toContain('Đã kiểm tra bằng:');
    expect(source).toContain('Đã kiểm tra: không có thông tin về model');
    expect(source).toContain('Lần kiểm tra trước:');
    expect(source).toContain('Lần chạy tiếp theo:');
    expect(source).toContain("useState<'automatic' | 'manual'>('automatic')");
    expect(source).toContain('Lấy prompt QA');
    expect(source).toContain('Nhập kết quả QA');
    expect(source).toContain('getFinalQaManualPrompt');
    expect(source).toContain('importFinalQa');
    expect(source).toContain('QA_ISSUE_TYPES');
    expect(source).toContain('Thủ công: lấy prompt, dán vào AI bất kỳ, rồi dán JSON kết quả vào');
    expect(source).toContain('value={qaManualRaw}');
    expect(source).toContain('setQaManualError(error instanceof Error ? error.message');
    expect(source).toContain('setQaManualRaw(event.target.value)');
  });

  it('exposes the visible regeneration modes and manual chapter import controls', async () => {
    const source = await readFile('src/client/features/script/ReviewScriptPage.tsx', 'utf8');

    expect(source).toContain('regenMode');
    expect(source).toContain('aria-label="Chế độ tái tạo"');
    expect(source).toContain('regenerationStatusLabel');
    expect(source).toContain('Thủ công: tự dán JSON');
    expect(source).toContain('title={regenMode === \'manual\' ? manualRegenHelp : undefined}');
    expect(source).toContain('{regenMode === \'manual\' && <p className={styles.regenManualHelp}>{manualRegenHelp}</p>}');
    expect(source).not.toContain('Tái tạo tự động bằng');
    expect(source).not.toContain('Tái tạo thủ công: lấy prompt, dán vào AI bất kỳ, rồi dán JSON kết quả vào');
    expect(source).toContain('Lấy prompt tái tạo');
    expect(source).toContain('Chế độ thủ công chỉ tái tạo từng chương');
    expect(source).toContain('{"paragraphs":[…],"chapterSummary":"…","avoidRepeating":[…],"persistentFactsNext":[…]}');
    expect(source).toContain('Đã nhập chương ${chapter.no}.');
  });

  it('keeps bulk regeneration instructions scoped and exposes review warnings', async () => {
    const source = await readFile('src/client/features/script/ReviewScriptPage.tsx', 'utf8');

    expect(source).toContain('instructionForChapter(instructionOrigin, regenInstruction, chapterId)');
    expect(source).toContain("setInstructionOrigin({ kind: 'qa', chapterId })");
    expect(source).toContain('Tái tạo ${regenerateAllIds.length} chương');
    expect(source).toContain('Bản cũ vẫn nằm trong lịch sử.');
    expect(source).toContain('Chọn ít nhất một chương để tái tạo.');
    expect(source).toContain('Cần xem lại: chương trước đã đổi');
    expect(source).toContain('chapter.reviewStatus === \'upstream-changed\'');
    expect(source).toContain('chapterWordBudgetNote(chapter)');
    expect(source).toContain('còn đánh dấu "cần xem lại"');
    expect(source).toContain("{ status: 'approved' });");
  });

  it('surfaces the manual regeneration result beside its chapter controls', async () => {
    const source = await readFile('src/client/features/script/ReviewScriptPage.tsx', 'utf8');
    const manualBoxIndex = source.indexOf('{manualRegen?.chapterId === chapter.id && <div ref={manualRegenBoxRef}');
    const chapterBodyIndex = source.indexOf('<div className={styles.chapterBody}');

    expect(manualBoxIndex).toBeGreaterThan(-1);
    expect(manualBoxIndex).toBeLessThan(chapterBodyIndex);
    expect(source).toContain('Chương ${chapter.no}: ${chapter.title}');
    expect(source).toContain('Bước 1: Sao chép prompt · Bước 2: dán vào AI bất kỳ · Bước 3: dán JSON kết quả vào ô rồi bấm "Nhập chương".');
    expect(source).toContain("manualRegenBusy ? 'Đang lấy prompt…'");
    expect(source).toContain('Lấy prompt tái tạo');
    expect(source).toContain('Đã tải prompt tái tạo chương ${chapter.no}. Sao chép rồi dán JSON kết quả vào ô bên dưới.');
    expect(source).toContain('onClick={() => setManualRegen(null)}>Đóng</Button>');
    expect(source).toContain('manualRegenTextareaRef');
    expect(source).toContain('manualRegenBoxRef.current?.scrollIntoView');
    expect(source).toContain("'(prefers-reduced-motion: reduce)'");
    expect(source).toContain('manualRegenTextareaRef.current?.focus()');
  });

  it('keeps QA controls in the side column and renders collapsible results above chapters', async () => {
    const source = await readFile('src/client/features/script/ReviewScriptPage.tsx', 'utf8');
    const resultPanelIndex = source.indexOf('qaResultsPanel');
    const chapterListIndex = source.indexOf('className={styles.chapterList}');
    expect(resultPanelIndex).toBeGreaterThan(-1);
    expect(resultPanelIndex).toBeLessThan(chapterListIndex);
    expect(source).toContain('QaIssueCard');
    expect(source).toContain('Kết quả QA có thể đã cũ vì kịch bản đã thay đổi. Chạy lại kiểm tra để cập nhật.');
    expect(source).toContain('Đã bỏ qua');
    expect(source).toContain('dismissedQaCount');
    expect(source).toContain('Kết quả QA không được lưu; chạy lại sau khi chỉnh kịch bản để cập nhật.');
    expect(source).toContain('qaResultsOpen');
    expect(source).toContain('qaLevelForAction');
    expect(source).toContain('scrollIntoView({ block: \'nearest\', behavior: prefersReducedMotion ? \'auto\' : \'smooth\' })');
  });

  it('explains quote fallback reasons and reserves room above the sticky footer', async () => {
    const source = await readFile('src/client/features/script/components/QaIssueCard.tsx', 'utf8');
    const page = await readFile('src/client/features/script/ReviewScriptPage.tsx', 'utf8');
    const css = await readFile('src/client/features/script/ReviewScriptPage.module.css', 'utf8');

    expect(source).toContain('Không tìm thấy câu trích trong chương hiện tại, nên chuyển sang tái tạo.');
    expect(source).toContain('Câu trích xuất hiện nhiều lần trong chương, nên chuyển sang tái tạo.');
    expect(source).toContain('quoteMatch');
    expect(page).toContain('explainQuoteMatch');
    expect(css).toContain('--review-footer-control-height');
    expect(css).toContain('padding-bottom:');
    expect(css).toContain('background: var(--panel)');
  });
});
