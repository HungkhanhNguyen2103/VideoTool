import { useEffect, useMemo, useRef, useState } from 'react';
import type { JobProgressState } from '../../../shared/hooks/use-job-progress';
import { cancelJob } from '../../../shared/job-api';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast-store';
import {
  deriveSeoGenerationStep,
  formatSeoElapsed,
  getSeoGenerationLiveness,
  getSeoGenerationStepStartAt,
  windowSeoGenerationLogs,
  type TimestampedSeoGenerationLog,
} from '../seo-generation-progress';
import styles from './GenerationProgress.module.css';

type Props = {
  jobId: string;
  progress: JobProgressState | null;
  startedAt: number;
  onClose: () => void;
};

const TERMINAL_STATUSES = ['done', 'failed', 'cancelled'];

export function GenerationProgress({ jobId, progress, startedAt, onClose }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [logsExpanded, setLogsExpanded] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [timestampedLogs, setTimestampedLogs] = useState<TimestampedSeoGenerationLog[]>([]);
  const seenLogCount = useRef(0);
  const logListRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const logs = progress?.logs ?? [];
  const active = !progress || ['queued', 'running'].includes(progress.status);
  const terminal = Boolean(progress && TERMINAL_STATUSES.includes(progress.status));
  const currentStep = deriveSeoGenerationStep(logs);
  const stepStartedAt = getSeoGenerationStepStartAt(timestampedLogs);
  const liveness = getSeoGenerationLiveness({
    active,
    now,
    lastEventAt: progress?.lastEventAt ?? startedAt,
    stepStartedAt,
  });
  const visibleLogs = useMemo(() => windowSeoGenerationLogs(logs), [logs]);
  const finalLine = logs.at(-1) ?? progress?.error ?? '';

  useEffect(() => {
    const newLogs = logs.slice(seenLogCount.current);
    if (newLogs.length === 0) return;
    seenLogCount.current = logs.length;
    const receivedAt = Date.now();
    setTimestampedLogs((previous) => [...previous, ...newLogs.map((text) => ({ text, receivedAt }))]);
  }, [logs]);

  useEffect(() => {
    setNow(Date.now());
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);

  useEffect(() => {
    const list = logListRef.current;
    if (logsExpanded && list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [logsExpanded, logs.length]);

  async function handleCancel() {
    if (cancelling) return;
    setCancelling(true);
    try {
      await cancelJob(jobId);
      toast('Đã gửi yêu cầu hủy');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thể gửi yêu cầu hủy.');
    } finally {
      setCancelling(false);
    }
  }

  function updateScrollPosition() {
    const list = logListRef.current;
    if (!list) return;
    stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight <= 24;
  }

  const elapsed = formatSeoElapsed(now - startedAt);
  const percentage = progress?.progress ?? 0;

  return (
    <section className={styles.panel} aria-label="Tiến độ tạo gói SEO">
      <div className={styles.header}>
        <div className={styles.heading}>
          <strong>{currentStep ? `Bước ${currentStep.index}/${currentStep.total} — ${currentStep.name}` : 'Đang tạo gói SEO…'}</strong>
          <span>Thời gian {elapsed}</span>
        </div>
        <span className={styles.percentage}>{percentage}%</span>
      </div>
      <progress className={styles.progress} value={percentage} max={100} aria-label="Phần trăm hoàn thành" />
      {terminal && finalLine && <p className={styles.finalLine}>{finalLine}</p>}
      {liveness.noSignalSeconds !== null && (
        <p className={styles.warning} role="status">Chưa có tín hiệu mới từ server ({liveness.noSignalSeconds}s). Claude CLI có thể đang chạy lâu.</p>
      )}
      {liveness.slowStep && <p className={styles.warning} role="status">Bước này đang chạy lâu hơn bình thường.</p>}
      <div className={styles.logHeader}>
        <button className={styles.logToggle} type="button" aria-expanded={logsExpanded} onClick={() => setLogsExpanded((expanded) => !expanded)}>
          {logsExpanded ? 'Ẩn log' : 'Xem log'}
        </button>
        <div className={styles.actions}>
          {active && <Button size="sm" onClick={() => void handleCancel()} disabled={cancelling}>{cancelling ? 'Đang gửi…' : 'Hủy'}</Button>}
          {terminal && <Button size="sm" onClick={onClose}>Đóng</Button>}
        </div>
      </div>
      {logsExpanded && (
        <div className={styles.logList} ref={logListRef} onScroll={updateScrollPosition} role="log" aria-live="polite" aria-relevant="additions">
          {visibleLogs.length > 0 ? <ol>{visibleLogs.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ol> : <p>Đang chờ nhật ký từ server…</p>}
        </div>
      )}
    </section>
  );
}
