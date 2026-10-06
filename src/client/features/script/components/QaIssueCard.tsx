import type { QAIssue } from '../api';
import type { QaQuoteTarget, QuoteMatchOutcome } from '../chapter-actions';
import { qaSeverityTone } from '../chapter-actions';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import styles from '../ReviewScriptPage.module.css';

type QaIssueCardProps = {
  issue: QAIssue;
  typeLabel: string;
  severityLabel: string;
  actionLabel: string;
  patchTarget: QaQuoteTarget | null;
  quoteMatch: QuoteMatchOutcome | null;
  replacement: string | undefined;
  removesParagraph: boolean;
  regenerationInstruction: string;
  regenerationLevel: 'light' | 'medium';
  confirming: boolean;
  accepted: boolean;
  onApply: () => void;
  onAccept: () => void;
  onCancel: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  onDetails: () => void;
};

function wordCount(value: string): number {
  return value.match(/\S+/gu)?.length ?? 0;
}

export function QaIssueCard({
  issue,
  typeLabel,
  severityLabel,
  actionLabel,
  patchTarget,
  quoteMatch,
  replacement,
  removesParagraph,
  regenerationInstruction,
  regenerationLevel,
  confirming,
  accepted,
  onApply,
  onAccept,
  onCancel,
  onEdit,
  onDismiss,
  onDetails,
}: QaIssueCardProps) {
  const isPatchable = patchTarget !== null && replacement !== undefined;
  const wordDelta = replacement === undefined || issue.quote === undefined ? null : wordCount(replacement.normalize('NFC')) - wordCount(issue.quote.normalize('NFC'));
  const quoteFallback = !isPatchable && issue.quote && replacement !== undefined
    ? quoteMatch === 'none'
      ? 'Không tìm thấy câu trích trong chương hiện tại, nên chuyển sang tái tạo.'
      : quoteMatch === 'multiple'
        ? 'Câu trích xuất hiện nhiều lần trong chương, nên chuyển sang tái tạo.'
        : null
    : null;

  return <article className={`${styles.qaIssue} ${accepted ? styles.qaIssueAccepted : ''}`}>
    <div className={styles.qaIssueTop}>
      <div>
        <div className={styles.qaIssueLocation}>Chương {issue.chapter}{issue.paragraph ? ` · đoạn ${issue.paragraph}` : ''}</div>
        <strong>{typeLabel}</strong>
      </div>
      <Badge tone={qaSeverityTone(issue.severity)}>Mức độ: {severityLabel}</Badge>
    </div>
    {accepted ? <><Badge tone="muted">Đã áp dụng</Badge><div className={styles.qaIssueActions}><Button size="sm" onClick={onDetails}>Chi tiết chương</Button></div></> : <>
      {issue.quote && <div className={styles.qaIssueText}><strong>Trích:</strong> “{issue.quote}”</div>}
      <div className={styles.qaIssueText}><strong>Vì sao:</strong> {issue.reason}</div>
      {issue.fixInstruction && <div className={styles.qaIssueText}><strong>Gợi ý sửa:</strong> {issue.fixInstruction}</div>}
      {!issue.fixInstruction && <div className={styles.qaIssueAction}>Đề xuất: {actionLabel}</div>}
      {isPatchable ? <div className={styles.qaDiff} aria-label="Bản xem trước thay đổi">
        <div className={styles.qaDiffBefore}><span aria-hidden="true">−</span><del>{issue.quote}</del></div>
        <div className={styles.qaDiffAfter}><span aria-hidden="true">+</span>{replacement || <em>(xoá đoạn trích)</em>}</div>
        {wordDelta !== null && <div className={styles.qaDiffDelta}>{wordDelta > 0 ? '+' : ''}{wordDelta} từ</div>}
        {removesParagraph && <p className={styles.qaDiffWarning}>Đoạn này sẽ bị xoá; số cảnh sẽ giảm đi một.</p>}
      </div> : <div className={styles.qaRegenInstruction}>
        <div className={styles.qaRegenInstructionHead}><strong>Lệnh tái tạo</strong><Badge tone="indigo">Mức: {regenerationLevel === 'light' ? 'Nhẹ' : 'Vừa'}</Badge></div>
        <p>{regenerationInstruction}</p>
      </div>}
      {quoteFallback && <p className={styles.qaFallbackReason}>{quoteFallback}</p>}
      <div className={styles.qaIssueActions}>
        {confirming ? <><Button size="sm" variant="amber" onClick={onAccept}>Chấp nhận</Button><Button size="sm" onClick={onCancel}>Huỷ</Button></> : <Button size="sm" variant="indigoline" onClick={onApply}>Áp dụng gợi ý</Button>}
        <Button size="sm" onClick={onEdit}>Sửa tay đoạn này</Button>
        {!confirming && <Button size="sm" variant="ghost" onClick={onDismiss}>Bỏ qua</Button>}
        <Button size="sm" onClick={onDetails}>Chi tiết chương</Button>
      </div>
    </>}
  </article>;
}
