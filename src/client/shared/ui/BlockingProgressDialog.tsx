import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import {
  blockingProgressViewModel,
  shouldShowBlockingProgress,
  type BlockingProgressInput,
  type BlockingTask,
} from './blocking-progress';
import styles from './BlockingProgressDialog.module.css';

type BlockingProgressDialogProps = {
  visible: boolean;
  task: BlockingTask;
  jobId: string | null;
  progress: BlockingProgressInput | null;
  uploadProgress: number | null;
  startedAt: number;
  lastEventAt: number | null;
  onCancel?: () => void;
  onClose: () => void;
  onReload?: () => void;
  onUnlock?: () => void;
};

const NON_CANCELLABLE_KINDS = new Set<BlockingTask['kind']>([
  'voiceover', 'sfx', 'bgm', 'video-distribution-preview', 'video-distribution-apply', 'fit-to-clip', 'preview', 'quick',
]);

export function BlockingProgressDialog({
  visible,
  task,
  jobId,
  progress,
  uploadProgress,
  startedAt,
  lastEventAt,
  onCancel,
  onClose,
  onReload,
  onUnlock,
}: BlockingProgressDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const view = blockingProgressViewModel({ task, jobId, progress, uploadProgress, startedAt, lastEventAt, now });
  const running = !view.terminal;
  const uploadOnly = task.kind === 'import-zip';
  const show = visible && (view.terminal || view.staleConnection || shouldShowBlockingProgress(true, task.immediate !== false, now - startedAt));

  useEffect(() => {
    if (!show) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [show]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (show && !dialog.open) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      cardRef.current?.focus();
    } else if (!show && dialog.open) {
      dialog.close();
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    }
    return () => {
      if (dialog.open) dialog.close();
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [show]);

  function close(): void {
    if (running) return;
    onClose();
  }

  const noCancelHint = !view.staleConnection && running && !view.canCancel && task.kind !== 'import-zip' && NON_CANCELLABLE_KINDS.has(task.kind);
  if (!show) return <dialog ref={dialogRef} className={styles.dialog} aria-hidden="true" />;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="blocking-progress-title"
      aria-describedby={!uploadOnly ? 'blocking-progress-description' : undefined}
      onCancel={(event) => { if (running) event.preventDefault(); else close(); }}
    >
      <div ref={cardRef} className={styles.card} tabIndex={-1}>
        <div className={styles.header}>
          <div>
            <p className={styles.kicker}>Studio</p>
            <h2 id="blocking-progress-title">{view.title}</h2>
          </div>
            {!uploadOnly && <span id="blocking-progress-description" className={styles.status} aria-live="polite">{view.statusText}</span>}
          </div>
        {!uploadOnly && <div className={styles.meta}>
          <span>Đã chạy {view.elapsedText}</span>
          {view.percent !== null && <strong>{view.percent}%</strong>}
        </div>}
        <div className={`${styles.barTrack} ${view.indeterminate ? styles.indeterminate : ''}`} role="progressbar" aria-label="Tiến độ tác vụ" aria-valuemin={0} aria-valuemax={100} {...(view.percent === null ? {} : { 'aria-valuenow': view.percent })}>
          {view.percent !== null && <span className={styles.barFill} style={{ width: `${view.percent}%` }} />}
        </div>
        {!uploadOnly && view.logs.length > 0 && <div className={styles.logs} aria-live="polite">{view.logs.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}</div>}
        {view.error && <p className={styles.error}>{view.error}</p>}
        {view.staleConnection && <div className={styles.warning}><strong>Mất kết nối với tiến trình</strong><span>Không nhận được cập nhật trong 45 giây.</span></div>}
        {!view.terminal && !view.staleConnection && task.kind === 'import-zip' && <p className={styles.hint}>Không đóng tab trong khi file đang được nhập.</p>}
        {noCancelHint && <p className={styles.hint}>Tác vụ này không có đường hủy riêng.</p>}
        <div className={styles.actions}>
          {view.staleConnection ? <>
            <Button variant="indigoline" onClick={onReload}>Tải lại trạng thái</Button>
            <Button onClick={onUnlock}>Mở khoá giao diện</Button>
          </> : view.terminal ? <Button variant="indigoline" onClick={close}>Đóng</Button> : view.canCancel ? <Button variant="red" onClick={() => { if (window.confirm('Bạn có chắc muốn huỷ tác vụ này không?')) onCancel?.(); }}>Huỷ tác vụ</Button> : null}
        </div>
      </div>
    </dialog>
  );
}
