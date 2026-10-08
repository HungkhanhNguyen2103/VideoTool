import { useEffect, useMemo, useRef, useState } from 'react';
import type { QAIssue } from '../api';
import type { QaBulkApplyOption, QaBulkApplyPlan, QaBulkSkip } from '../chapter-actions';
import { Button } from '../../../shared/ui/Button';
import styles from './QaApplyAllDialog.module.css';

export type QaApplyAllResult = {
  option: QaBulkApplyOption;
  appliedPatches: number;
  regeneratedChapters: number;
  skipped: QaBulkSkip[];
  failures: Array<{ chapterNo: number; issues: QAIssue[]; message: string }>;
  cancelled: boolean;
  undoAvailable: boolean;
  undoBlocked: string | null;
  restored: boolean;
};

type QaApplyAllDialogProps = {
  plans: Record<QaBulkApplyOption, QaBulkApplyPlan>;
  providerLabel: string;
  regenMode: 'automatic' | 'manual';
  qaStale: boolean;
  historyAtLimit: boolean;
  disabled: boolean;
  busy: boolean;
  result: QaApplyAllResult | null;
  onStart: (option: QaBulkApplyOption) => void;
  onUndo: () => void;
  onDismissResult: () => void;
};

const OPTIONS: Array<{ id: QaBulkApplyOption; label: string }> = [
  { id: 'high', label: 'Mức cao' },
  { id: 'high-medium', label: 'Cao + trung bình' },
  { id: 'all', label: 'Toàn bộ' },
];

function summarizeSkipped(skipped: readonly QaBulkSkip[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of skipped) counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count }));
}

export function QaApplyAllDialog({
  plans,
  providerLabel,
  regenMode,
  qaStale,
  historyAtLimit,
  disabled,
  busy,
  result,
  onStart,
  onUndo,
  onDismissResult,
}: QaApplyAllDialogProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedOption, setSelectedOption] = useState<QaBulkApplyOption | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectedPlan = selectedOption ? plans[selectedOption] : null;
  const resultSkipped = useMemo(() => result ? summarizeSkipped(result.skipped) : [], [result]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.focus();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const menu = rootRef.current?.querySelector<HTMLElement>('[role="menu"]');
      if (!menu?.contains(event.target as Node)) return;
      const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
      if (items.length === 0) return;
      event.preventDefault();
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[nextIndex]!.focus();
    };
    const focusFirstMenuItem = () => {
      rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    focusFirstMenuItem();
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const shouldOpen = !busy && (Boolean(result) || selectedOption !== null);
    if (shouldOpen && !dialog.open) dialog.showModal();
    else if (!shouldOpen && dialog.open) dialog.close();
  }, [busy, result, selectedOption]);

  function chooseOption(option: QaBulkApplyOption): void {
    setMenuOpen(false);
    setSelectedOption(option);
  }

  function closeDialog(): void {
    if (result) {
      setSelectedOption(null);
      onDismissResult();
      return;
    }
    setSelectedOption(null);
  }

  const manualChapters = selectedPlan
    ? [...new Set(selectedPlan.skipped.filter((item) => item.reason === 'manual-regeneration').map((item) => item.issue.chapter))].sort((a, b) => a - b)
    : [];

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.splitControl}>
        <Button
          variant="amber"
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >Áp dụng tất cả</Button>
        <Button
          variant="amber"
          size="icon"
          className={styles.menuToggle}
          disabled={disabled}
          aria-label="Chọn mức áp dụng tất cả"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >⌄</Button>
      </div>
      {menuOpen && <div className={styles.menu} role="menu" aria-label="Chọn mức áp dụng QA">
        {OPTIONS.map((option) => <button
          key={option.id}
          type="button"
          role="menuitem"
          className={styles.menuItem}
          disabled={plans[option.id].actionableCount === 0}
          onClick={() => chooseOption(option.id)}
        >{option.label} ({plans[option.id].actionableCount})</button>)}
      </div>}

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby="qa-apply-all-title"
        onCancel={(event) => { event.preventDefault(); closeDialog(); }}
        onClick={(event) => { if (event.target === event.currentTarget) closeDialog(); }}
      >
        <div className={styles.dialogCard}>
          <div className={styles.dialogHeader}>
            <p className={styles.kicker}>Duyệt & Tái Tạo</p>
            <h2 id="qa-apply-all-title">{result ? 'Kết quả áp dụng QA' : 'Xác nhận áp dụng QA'}</h2>
          </div>
          {result ? <div className={styles.dialogBody}>
            <p className={styles.resultLead}>
              Đã áp dụng {result.appliedPatches} sửa cục bộ và tái tạo {result.regeneratedChapters} chương.
            </p>
            {result.cancelled && <p className={styles.warning}>Đã huỷ giữa lượt chạy; các thay đổi đã hoàn tất vẫn được giữ.</p>}
            {result.skipped.length > 0 && <section className={styles.summaryGroup} aria-label="Gợi ý đã bỏ qua">
              <h3>Đã bỏ qua {result.skipped.length} gợi ý</h3>
              {resultSkipped.map((item) => <p key={item.label}>{item.count} · {item.label}</p>)}
            </section>}
            {result.failures.length > 0 && <section className={styles.summaryGroup} aria-label="Lỗi theo chương">
              <h3>Không áp dụng được {result.failures.reduce((count, failure) => count + failure.issues.length, 0)} gợi ý</h3>
              {result.failures.map((failure) => <p key={`${failure.chapterNo}-${failure.message}`}>Chương {failure.chapterNo} · {failure.message}</p>)}
            </section>}
            {result.undoBlocked && <p className={styles.warning} role="alert">{result.undoBlocked}</p>}
            {result.restored && <p className={styles.success}>Đã khôi phục bản trước khi áp dụng QA.</p>}
            {!result.restored && <p className={styles.hint}>Kịch bản đã thay đổi; hãy chạy lại QA để cập nhật các gợi ý.</p>}
          </div> : selectedPlan && <div className={styles.dialogBody}>
            <p className={styles.optionSummary}>{OPTIONS.find((option) => option.id === selectedOption)?.label}: {selectedPlan.actionableCount} gợi ý sẽ được áp dụng.</p>
            <p>{selectedPlan.patches.reduce((count, patch) => count + patch.issues.length, 0)} sửa cục bộ · {selectedPlan.regenerations.length} chương tái tạo · {selectedPlan.skipped.length} gợi ý bỏ qua</p>
            <p className={styles.warning}>Tái tạo có thể diễn đạt lại chương và sẽ đánh dấu chương tiếp theo cần xem lại.</p>
            {regenMode === 'manual' && <div className={styles.notice}>
              <strong>Chỉ áp dụng các sửa cục bộ trong lượt này.</strong>
              {manualChapters.length > 0 && <span>Cần tái tạo thủ công các chương: {manualChapters.join(', ')}.</span>}
            </div>}
            {qaStale && <p className={styles.warning}>Kịch bản đã đổi sau lần chạy QA; một số trích dẫn có thể không còn khớp và sẽ bị bỏ qua.</p>}
            {historyAtLimit && <p className={styles.warning}>Lịch sử đã đủ 10 phiên bản. Lượt này chỉ thêm một bản hoàn tác; phiên bản cũ nhất sẽ rời danh sách.</p>}
            {selectedPlan.skipped.length > 0 && <section className={styles.summaryGroup} aria-label="Gợi ý sẽ bỏ qua">
              <h3>Sẽ bỏ qua {selectedPlan.skipped.length} gợi ý</h3>
              {summarizeSkipped(selectedPlan.skipped).map((item) => <p key={item.label}>{item.count} · {item.label}</p>)}
            </section>}
            {regenMode === 'automatic' && selectedPlan.regenerations.length > 0 && <p className={styles.provider}>Nhà cung cấp: {providerLabel}</p>}
          </div>}
          <div className={styles.dialogFooter}>
            {result ? <>
              {result.undoAvailable && !result.restored && <Button variant="red" onClick={onUndo}>Hoàn tác tất cả</Button>}
              <Button variant="indigoline" onClick={closeDialog}>Đóng</Button>
            </> : <>
              <Button variant="indigoline" onClick={closeDialog}>Huỷ</Button>
              <Button variant="amber" disabled={!selectedPlan || selectedPlan.actionableCount === 0} onClick={() => selectedOption && onStart(selectedOption)}>Bắt đầu</Button>
            </>}
          </div>
        </div>
      </dialog>
    </div>
  );
}
