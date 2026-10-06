import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AiProvider } from '../../../../contracts/project';
import { countNarrationWords, type ChapterDoc } from '../../../../contracts/script';
import type { QAIssue } from '../api';
import * as api from '../api';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast-store';
import {
  chapterWordBudgetNote,
  chapterWordCount,
  explainQuoteMatch,
  findQuoteTarget,
} from '../chapter-actions';
import styles from './QaFixDialog.module.css';

type RegenLevel = 'light' | 'medium' | 'rewrite';
type ContextTab = 'chapter' | 'previous' | 'next';

type QaFixDialogProps = {
  projectId: string;
  issue: QAIssue | null;
  typeLabel?: string;
  chapter: ChapterDoc;
  chapters: readonly ChapterDoc[];
  baseline: ChapterDoc;
  mode: 'automatic' | 'manual';
  provider: AiProvider;
  initialInstruction: string;
  initialLevel: RegenLevel;
  viewOnly: boolean;
  isRunning: boolean;
  otherRegenRunning: boolean;
  preview: string;
  result: boolean;
  restored: boolean;
  undoIndex: number | null;
  onClose: () => void;
  onChangeMode: (mode: 'automatic' | 'manual') => void;
  onRegenerate: (instruction: string, level: RegenLevel) => void;
  onAbort: () => void;
  onImport: (raw: string) => Promise<string | null>;
  onUndo: () => void;
  onKeep: () => void;
  onDismiss: () => void;
  onContinueNext: (chapter: ChapterDoc) => void;
};

function providerLabel(provider: AiProvider): string {
  return provider === 'claude' ? 'Claude' : 'DeepSeek';
}

function previewStats(preview: string, targetWords: number | null): { words: number; percent: number | null } | null {
  const trimmed = preview.trim();
  if (!trimmed || /^\s*(?:```(?:json)?\s*)?[\[{]/i.test(trimmed)) return null;
  const words = countNarrationWords(preview);
  return { words, percent: targetWords ? Math.min(100, Math.round(words / targetWords * 100)) : null };
}

function sameParagraph(left: string | undefined, right: string | undefined): boolean {
  return left === right;
}

export function QaFixDialog({
  projectId,
  issue,
  typeLabel,
  chapter,
  chapters,
  baseline,
  mode,
  provider,
  initialInstruction,
  initialLevel,
  viewOnly: initialViewOnly,
  isRunning,
  otherRegenRunning,
  preview,
  result,
  restored,
  undoIndex,
  onClose,
  onChangeMode,
  onRegenerate,
  onAbort,
  onImport,
  onUndo,
  onKeep,
  onDismiss,
  onContinueNext,
}: QaFixDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const outputRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const wasRunningRef = useRef(false);
  const hadResultRef = useRef(false);
  const [instruction, setInstruction] = useState(initialInstruction);
  const [level, setLevel] = useState<RegenLevel>(initialLevel);
  const [viewOnly, setViewOnly] = useState(initialViewOnly);
  const [manualPrompt, setManualPrompt] = useState<{ prompt: string; promptVersion: string } | null>(null);
  const [manualRaw, setManualRaw] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [contextTab, setContextTab] = useState<ContextTab>('chapter');
  const [manualResult, setManualResult] = useState(false);
  const hasResult = result || manualResult;
  const previousChapter = chapters.find((item) => item.no === chapter.no - 1);
  const nextChapter = chapters.find((item) => item.no === chapter.no + 1);
  const budgetNote = chapterWordBudgetNote(chapter);
  const quoteMatch = issue ? explainQuoteMatch(chapter, issue) : 'no-quote';
  const quoteTarget = issue && quoteMatch === 'unique' ? findQuoteTarget(chapter, issue) : null;
  const stats = previewStats(preview, chapter.targetWords ?? null);
  const outputTitle = viewOnly ? 'Chương toàn văn' : hasResult ? 'So sánh với bản trước khi mở dialog' : 'Chương hiện tại';

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const smallViewport = typeof window !== 'undefined' && window.innerWidth < 1000;
    if (smallViewport && isRunning && !wasRunningRef.current) {
      const prefersReducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      outputRef.current?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    }
    if (smallViewport && hasResult && (!hadResultRef.current || wasRunningRef.current)) {
      const prefersReducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      outputRef.current?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      resultRef.current?.focus();
    }
    wasRunningRef.current = isRunning;
    hadResultRef.current = hasResult;
  }, [hasResult, isRunning]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      if (!isRunning) onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusables = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusables.length) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function loadPrompt() {
    setManualBusy(true);
    setManualError(null);
    try {
      setManualPrompt(await api.getRegenerationManualPrompt(projectId, chapter.id, { instruction, level }));
    } catch (error) {
      setManualError(error instanceof Error ? error.message : 'Không thể tải prompt tái tạo.');
    } finally {
      setManualBusy(false);
    }
  }

  async function copyPrompt() {
    if (!manualPrompt) return;
    try {
      await navigator.clipboard.writeText(manualPrompt.prompt);
      toast('Đã sao chép prompt tái tạo.');
    } catch {
      toast('Không thể sao chép prompt.');
    }
  }

  async function importChapter() {
    if (!manualRaw.trim()) return;
    setManualBusy(true);
    setManualError(null);
    const error = await onImport(manualRaw);
    if (error) setManualError(error);
    else setManualResult(true);
    setManualBusy(false);
  }

  function renderChapterParagraph(paragraph: string, paragraphIndex: number) {
    if (!quoteTarget || quoteTarget.paragraphIndex !== paragraphIndex) return <p key={`${chapter.id}-${paragraphIndex}`}>{paragraph}</p>;
    const normalized = paragraph.normalize('NFC');
    return <p key={`${chapter.id}-${paragraphIndex}`}>{normalized.slice(0, quoteTarget.start)}<mark>{normalized.slice(quoteTarget.start, quoteTarget.end)}</mark>{normalized.slice(quoteTarget.end)}</p>;
  }

  function renderContextParagraphs(items: readonly string[], prefix: string) {
    return <div className={styles.chapterText}>{items.map((paragraph, index) => <p key={`${prefix}-${index}`}>{paragraph}</p>)}</div>;
  }

  function renderCurrentChapter() {
    if (isRunning) {
      return <div className={styles.streamingBox} aria-live="polite"><div className={styles.streamingHead}><span className={styles.pulse} /><strong>Bản mới (đang viết…)</strong>{stats && <span className={styles.previewStats}>{stats.words} từ{stats.percent != null ? ` · ${stats.percent}% mục tiêu` : ''}</span>}</div><pre className={styles.preview}>{preview || 'Đang nhận token…'}</pre></div>;
    }
    if (hasResult) {
      const length = Math.max(baseline.paragraphs.length, chapter.paragraphs.length);
      return <div className={styles.compareView}>
        <div className={styles.compareSummary}><strong>trước {chapterWordCount(baseline)} từ → sau {chapterWordCount(chapter)} từ</strong>{budgetNote && <Badge tone={budgetNote.tone}>{budgetNote.text}</Badge>}</div>
        {Array.from({ length }, (_, index) => {
          const oldText = baseline.paragraphs[index];
          const newText = chapter.paragraphs[index];
          if (sameParagraph(oldText, newText)) return <div className={styles.sameText} key={`same-${index}`}><span>KHÔNG ĐỔI</span><p>{newText ?? oldText}</p></div>;
          return <div className={styles.comparePair} key={`changed-${index}`}><div className={styles.oldText}><span>ĐOẠN CŨ</span><del>{oldText ?? '(đoạn đã xoá)'}</del></div><div className={styles.newText}><span>ĐOẠN MỚI</span><p>{newText ?? '(đoạn đã xoá)'}</p></div></div>;
        })}
      </div>;
    }
    return <div className={styles.chapterText}>{chapter.paragraphs.map(renderChapterParagraph)}</div>;
  }

  function renderOutput() {
    if (contextTab === 'previous' && previousChapter) return renderContextParagraphs(previousChapter.paragraphs.slice(-2), `previous-${previousChapter.id}`);
    if (contextTab === 'next' && nextChapter) return renderContextParagraphs(nextChapter.paragraphs.slice(0, 2), `next-${nextChapter.id}`);
    return renderCurrentChapter();
  }

  const title = viewOnly
    ? `Chương ${chapter.no}${issue?.paragraph ? ` · đoạn ${issue.paragraph}` : ''}${issue ? ` — ${typeLabel ?? issue.type}` : ' — xem lại sau khi chương trước đổi'}`
    : `Chương ${chapter.no}${issue?.paragraph ? ` · đoạn ${issue.paragraph}` : ''} — ${issue ? typeLabel ?? issue.type : 'xem lại sau khi chương trước đổi'}`;
  const showUpstreamNotice = hasResult && nextChapter?.reviewStatus === 'upstream-changed';

  return <div className={styles.backdrop} onKeyDown={handleKeyDown}>
    <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={`qa-fix-dialog-title-${chapter.id}`} tabIndex={-1}>
      <header className={styles.dialogHeader}>
        <div><div className={styles.kicker}>{viewOnly ? 'Chi tiết chương · chỉ xem' : 'Xử lý gợi ý QA'}</div><h2 id={`qa-fix-dialog-title-${chapter.id}`}>{title}</h2></div>
        <div className={styles.headerActions}><Badge tone={issue?.severity === 'high' ? 'red' : issue?.severity === 'medium' ? 'amber' : 'muted'}>{issue ? `Mức độ: ${issue.severity === 'high' ? 'cao' : issue.severity === 'medium' ? 'trung bình' : 'thấp'}` : 'Cần xem lại'}</Badge><Button size="icon" disabled={isRunning} aria-label="Đóng" onClick={onClose}>×</Button></div>
      </header>

      <div className={`${styles.dialogBody} ${viewOnly ? styles.viewOnly : ''}`}>
        {!viewOnly && <section className={styles.inputColumn} aria-label="Đầu vào">
          <div className={styles.sectionTitle}><span className={styles.stepNumber}>1</span><div><strong>Đầu vào</strong></div></div>
          {issue && <div className={styles.issueBlock}><p>{issue.quote && <><span className={styles.fieldLabel}>Trích</span><q>{issue.quote}</q></>}</p><p><span className={styles.fieldLabel}>Vì sao</span>{issue.reason}</p><p><span className={styles.fieldLabel}>Gợi ý sửa</span>{issue.fixInstruction ?? `Đề xuất: ${issue.suggestedAction}`}</p></div>}
          <label className={styles.fieldLabel} htmlFor={`qa-fix-instruction-${chapter.id}`}>Lệnh tái tạo</label>
          <textarea id={`qa-fix-instruction-${chapter.id}`} className={styles.textarea} value={instruction} disabled={isRunning || otherRegenRunning} onChange={(event) => setInstruction(event.target.value)} />
          <fieldset className={styles.segmented} disabled={isRunning || otherRegenRunning}><legend className={styles.fieldLabel}>Mức thay đổi</legend><div className={styles.segments}>{([['light', 'Nhẹ'], ['medium', 'Vừa'], ['rewrite', 'Viết lại']] as const).map(([value, label]) => <label key={value}><input type="radio" name={`qa-fix-level-${chapter.id}`} value={value} checked={level === value} onChange={() => setLevel(value)} /><span>{label}</span></label>)}</div></fieldset>
          <fieldset className={styles.segmented} disabled={isRunning || otherRegenRunning}><legend className={styles.fieldLabel}>Chế độ tái tạo</legend><div className={styles.segments}><label><input type="radio" name={`qa-fix-mode-${chapter.id}`} value="automatic" checked={mode === 'automatic'} onChange={() => onChangeMode('automatic')} /><span>Tự động</span></label><label><input type="radio" name={`qa-fix-mode-${chapter.id}`} value="manual" checked={mode === 'manual'} onChange={() => onChangeMode('manual')} /><span>Thủ công (JSON)</span></label></div></fieldset>
          <p className={styles.providerLine}><span className={styles.statusDot} />{mode === 'automatic' ? `Tự động bằng ${providerLabel(provider)}` : 'Thủ công: tự dán JSON'}</p>
          {otherRegenRunning && <p className={styles.muted}>Một chương khác đang tái tạo; dialog sẽ chạy sau khi luồng đó kết thúc.</p>}
          <div className={styles.actionStack}>{mode === 'automatic' ? <Button variant={isRunning ? 'red' : 'amber'} className={styles.primaryAction} disabled={otherRegenRunning || viewOnly} onClick={isRunning ? onAbort : () => onRegenerate(instruction, level)}>{isRunning ? 'Dừng' : hasResult ? 'Tái tạo lại' : `Tái tạo chương ${chapter.no}`}</Button> : <Button variant="amber" className={styles.primaryAction} disabled={manualBusy || otherRegenRunning || viewOnly} onClick={() => void loadPrompt()}>{manualBusy && !manualPrompt ? 'Đang lấy prompt…' : 'Lấy prompt'}</Button>}{issue && <Button className={styles.quietAction} disabled={isRunning} onClick={onDismiss}>Bỏ qua thẻ này</Button>}</div>
          {isRunning && <p className={styles.runningNote}>Khi đang chạy, dialog không thể đóng; có thể Dừng để quay lại.</p>}
          {mode === 'manual' && manualPrompt && <div className={styles.manualPanel}><div className={styles.manualHeader}><strong>Prompt tái tạo chương {chapter.no}</strong><Button size="sm" disabled={manualBusy} onClick={() => void copyPrompt()}>Sao chép</Button></div><p className={styles.promptVersion}>Prompt {manualPrompt.promptVersion}</p><pre className={styles.promptBox}>{manualPrompt.prompt}</pre><label className={styles.fieldLabel} htmlFor={`qa-fix-json-${chapter.id}`}>JSON kết quả</label><textarea id={`qa-fix-json-${chapter.id}`} className={styles.textarea} value={manualRaw} disabled={manualBusy} onChange={(event) => { setManualRaw(event.target.value); setManualError(null); }} placeholder="Dán JSON do AI trả về…" />{manualError && <p className={styles.error}>{manualError}</p>}<Button variant="amber" disabled={manualBusy || !manualRaw.trim()} onClick={() => void importChapter()}>Nhập chương</Button></div>}
        </section>}

        {viewOnly && <section className={styles.viewIssue}><div className={styles.issueBlock}>{issue && <><p>{issue.quote && <><span className={styles.fieldLabel}>Trích</span><q>{issue.quote}</q></>}</p><p><span className={styles.fieldLabel}>Vì sao</span>{issue.reason}</p><p><span className={styles.fieldLabel}>Gợi ý sửa</span>{issue.fixInstruction ?? `Đề xuất: ${issue.suggestedAction}`}</p></>}<div className={styles.actionStack}><Button variant="amber" onClick={() => setViewOnly(false)}>Xử lý gợi ý</Button><Button onClick={onClose}>Đóng</Button></div></div></section>}

        <section ref={outputRef} className={styles.outputColumn} aria-label="Đầu ra và ngữ cảnh">
          <div className={styles.sectionTitle}><span className={styles.stepNumber}>2</span><div><strong>{outputTitle}</strong></div></div>
          <div className={styles.contextTabs}><button className={contextTab === 'chapter' ? styles.activeTab : ''} type="button" onClick={() => setContextTab('chapter')}>Chương {chapter.no}</button>{previousChapter && <button className={contextTab === 'previous' ? styles.activeTab : ''} type="button" onClick={() => setContextTab('previous')}>Chương {previousChapter.no} (cuối)</button>}{nextChapter && <button className={contextTab === 'next' ? styles.activeTab : ''} type="button" onClick={() => setContextTab('next')}>Chương {nextChapter.no} (đầu)</button>}</div>
          <div className={styles.contextPane}><div className={styles.contextTitle}><strong>{contextTab === 'chapter' ? `Chương ${chapter.no} · toàn văn` : contextTab === 'previous' ? `Chương ${previousChapter?.no} · hai đoạn cuối` : `Chương ${nextChapter?.no} · hai đoạn đầu`}</strong>{contextTab === 'chapter' && budgetNote && <Badge tone={budgetNote.tone}>{budgetNote.text}</Badge>}</div>{renderOutput()}</div>
          {quoteMatch !== 'unique' && issue?.quote && !hasResult && <p className={styles.muted}>Không tìm thấy câu trích duy nhất trong chương; hiển thị nguyên văn.</p>}
        </section>
      </div>

      {hasResult && <div ref={resultRef} className={styles.resultFooter} tabIndex={-1}><div><strong>{restored ? `Đã hoàn tác chương ${chapter.no}.` : `Đã tái tạo chương ${chapter.no}.`}</strong><span>{restored ? 'Đang hiển thị lại bản trước lần tái tạo đầu tiên.' : 'Bản cũ nằm trong Lịch sử phiên bản.'}</span></div><Button disabled={undoIndex == null} onClick={onUndo}>Hoàn tác</Button><Button variant="amber" onClick={onKeep}>Giữ bản mới</Button></div>}
      {hasResult && undoIndex == null && <p className={styles.undoWarning}>Đã có thay đổi khác sau lần tái tạo này; dùng Lịch sử phiên bản để khôi phục.</p>}
      {showUpstreamNotice && nextChapter && <div className={styles.upstreamNotice}><div><strong>Chương {nextChapter.no} được đánh dấu 'Cần xem lại: chương trước đã đổi'</strong><span>Nên xử lý tiếp trước khi chốt kịch bản.</span></div><Button onClick={() => onContinueNext(nextChapter)}>Xử lý tiếp chương {nextChapter.no}</Button></div>}
    </section>
  </div>;
}
