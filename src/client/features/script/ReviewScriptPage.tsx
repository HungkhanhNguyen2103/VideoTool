import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AiProvider } from '../../../contracts/project';
import type { ChapterDoc } from '../../../contracts/script';
import type { QAIssue, QAResult } from './api';
import { Badge } from '../../shared/ui/Badge';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { toast } from '../../shared/ui/toast-store';
import { useJobProgress } from '../../shared/hooks/use-job-progress';
import * as api from './api';
import {
  approveAllTargets,
  chapterMetaText,
  chaptersSummaryText,
  buildQaRegenInstruction,
  findChapterIdByNumber,
  generationModeForChapters,
  groupQaIssuesByChapter,
  historyVersionLabel,
  manualTextAfterImport,
  runRegenerationQueue,
  selectedRegenTargets,
  qaSeverityTone,
  toggleApproveStatus,
  toggleFlagStatus,
} from './chapter-actions';
import styles from './ReviewScriptPage.module.css';

const statusTone = { approved: 'green', 'needs-fix': 'amber', generating: 'indigo', pending: 'muted' } as const;
const statusLabel = { approved: 'Đã duyệt', 'needs-fix': 'Cần sửa', generating: 'Đang tạo lại', pending: 'Chưa duyệt' } as const;
const qaTypeLabel: Record<QAResult['issues'][number]['type'], string> = {
  REPETITION: 'Trùng lặp', CONTRADICTION: 'Mâu thuẫn', DEAD_CHAPTER: 'Chương chết', POSSIBLE_FILLER: 'Có thể lược bỏ',
  WEAK_HOOK: 'Hook yếu', FLAT_PACING: 'Nhịp phẳng', PREMATURE_REVEAL: 'Tiết lộ sớm', UNRESOLVED_LOOP: 'Nút chưa gỡ',
  WEAK_PAYOFF: 'Payoff yếu', AWKWARD_TRANSITION: 'Chuyển đoạn gượng', TONE_DRIFT: 'Lệch giọng', CREDIBILITY_RISK: 'Rủi ro độ tin cậy',
};
const qaSeverityLabel = { high: 'cao', medium: 'trung bình', low: 'thấp' } as const;
const qaActionLabel: Record<QAResult['issues'][number]['suggestedAction'], string> = {
  REMOVE_DUPLICATION: 'Loại bỏ trùng lặp', REGENERATE: 'Tái tạo', SHORTEN: 'Rút gọn', MOVE_REVEAL: 'Dời tiết lộ', REVIEW_FACT: 'Kiểm tra dữ kiện',
};
const aiProviderLabel: Record<AiProvider, string> = { deepseek: 'DeepSeek', claude: 'Claude' };
const manualRegenHelp = 'lấy prompt, dán vào AI bất kỳ, rồi dán JSON kết quả vào';

export function regenerationStatusLabel(mode: 'automatic' | 'manual', provider: AiProvider): string {
  return mode === 'automatic' ? `Tự động bằng ${aiProviderLabel[provider]}` : 'Thủ công: tự dán JSON';
}

const qaSameProviderHint = 'Model kiểm tra có thể bỏ sót các lỗi giống model đã viết kịch bản nếu hai bên cùng nhà cung cấp. Hãy đối chiếu số liệu với tài liệu tham khảo.';

export function qaReviewerDisplay(projectProvider: AiProvider, result: QAResult | null): { lines: string[]; hint: string | null } {
  if (!result) return { lines: [`Tự động bằng ${aiProviderLabel[projectProvider]}`], hint: null };
  const reviewer = result.reviewedBy;
  if (!reviewer) return { lines: ['Đã kiểm tra: không có thông tin về model'], hint: null };
  if (reviewer.provider === 'manual') return { lines: ['Đã kiểm tra: thủ công (dán JSON)'], hint: null };
  if (reviewer.provider !== projectProvider) {
    return {
      lines: [`Lần kiểm tra trước: ${aiProviderLabel[reviewer.provider]} · ${reviewer.model}`, `Lần chạy tiếp theo: ${aiProviderLabel[projectProvider]}`],
      hint: null,
    };
  }
  return {
    lines: [`Đã kiểm tra bằng: ${aiProviderLabel[reviewer.provider]} · ${reviewer.model}`],
    hint: qaSameProviderHint,
  };
}

type ReviewStepState = 'done' | 'active' | 'todo';

type ReviewStep = { label: string; sub: string; state: ReviewStepState };

export function getReviewStepperState(chapterCount: number, approvedCount: number, jobId: string | null) {
  const hasChapters = chapterCount > 0;
  const allApproved = hasChapters && approvedCount === chapterCount;
  const currentStep = !hasChapters ? 1 : allApproved ? 3 : 2;
  const steps: ReviewStep[] = [
    { label: 'Dàn ý', sub: 'Hoàn tất', state: 'done' },
    { label: 'Nháp kịch bản', sub: hasChapters ? 'Hoàn tất' : jobId ? 'Đang thực hiện' : 'Chưa bắt đầu', state: hasChapters ? 'done' : 'active' },
    { label: 'Duyệt & tái tạo', sub: !hasChapters ? 'Chưa bắt đầu' : allApproved ? 'Hoàn tất' : `Đã duyệt ${approvedCount}/${chapterCount}`, state: !hasChapters ? 'todo' : allApproved ? 'done' : 'active' },
    { label: 'Chốt & chia cảnh', sub: allApproved ? 'Sẵn sàng' : 'Chưa bắt đầu', state: allApproved ? 'active' : 'todo' },
  ];
  return { currentStep, steps };
}

export function shouldOfferOpeningHook(chapter: Pick<ChapterDoc, 'no' | 'paragraphs'>, openingHook: string): boolean {
  const hook = openingHook.trim();
  return chapter.no === 1 && hook.length > 0 && chapter.paragraphs[0]?.trim() !== hook;
}

export function ReviewScriptPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [jobId, setJobId] = useState<string | null>(null);
  const [qaJobId, setQaJobId] = useState<string | null>(null);
  const [qaResult, setQaResult] = useState<QAResult | null>(null);
  const [qaMode, setQaMode] = useState<'automatic' | 'manual'>('automatic');
  const [qaManualPrompt, setQaManualPrompt] = useState<{ prompt: string; promptVersion: string } | null>(null);
  const [qaManualRaw, setQaManualRaw] = useState('');
  const [qaManualError, setQaManualError] = useState<string | null>(null);
  const [qaManualBusy, setQaManualBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editParagraphs, setEditParagraphs] = useState<string[]>([]);
  const [regen, setRegen] = useState<{ id: string; instruction: string; level: 'light' | 'medium' | 'rewrite'; preview: string; controller: AbortController } | null>(null);
  const [regenInstruction, setRegenInstruction] = useState('');
  const [regenLevel, setRegenLevel] = useState<'light' | 'medium' | 'rewrite'>('medium');
  const [regenMode, setRegenMode] = useState<'automatic' | 'manual'>('automatic');
  const [manualRegen, setManualRegen] = useState<{ chapterId: string; prompt: string; promptVersion: string; raw: string; error: string | null } | null>(null);
  const [manualRegenBusy, setManualRegenBusy] = useState(false);
  const [generationMode, setGenerationMode] = useState<'automatic' | 'manual'>('automatic');
  const [manualRaw, setManualRaw] = useState('');
  const [manualPrompt, setManualPrompt] = useState<{ prompt: string; promptVersion: string } | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const regenControllerRef = useRef<AbortController | null>(null);
  const regenInstructionRef = useRef<HTMLTextAreaElement>(null);
  const manualRegenBoxRef = useRef<HTMLDivElement>(null);
  const manualRegenTextareaRef = useRef<HTMLTextAreaElement>(null);
  const lifecycleRef = useRef(0);
  const initialExpansionProjectIdRef = useRef<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const progress = useJobProgress(jobId);
  const qaProgress = useJobProgress(qaJobId);
  const projectQuery = useQuery({ queryKey: ['projects', 'detail', projectId], queryFn: () => api.getProject(projectId), enabled: Boolean(projectId) });
  const historyQuery = useQuery({ queryKey: ['projects', 'chapters', 'history', projectId], queryFn: () => api.getChapterHistory(projectId), enabled: Boolean(projectId) });
  const chapters = projectQuery.data?.chapters ?? [];
  const approvedCount = chapters.filter((chapter) => chapter.status === 'approved').length;
  const allApproved = chapters.length > 0 && approvedCount === chapters.length;
  const { steps } = getReviewStepperState(chapters.length, approvedCount, jobId);
  const selectedChapters = useMemo(() => chapters.filter((chapter) => selected.has(chapter.id)), [chapters, selected]);
  const selectedRegenIds = selectedRegenTargets(chapters, selected);
  const regenerateAllIds = approveAllTargets(chapters);
  const allSelected = chapters.length > 0 && selectedChapters.length === chapters.length;
  const hasGenerating = Boolean(regen) || chapters.some((chapter) => chapter.status === 'generating');
  const hasApprovableChapters = chapters.some((chapter) => chapter.status !== 'generating' && chapter.status !== 'approved');
  const history = historyQuery.data ?? [];
  const effectiveGenerationMode = generationModeForChapters(chapters.length, generationMode);
  const controlsBusy = Boolean(jobId) || hasGenerating || manualBusy || manualRegenBusy || providerBusy;
  const qaBusy = Boolean(qaJobId);
  const qaControlsBusy = qaBusy || qaManualBusy;
  const qaReviewer = qaReviewerDisplay(projectQuery.data?.aiProvider ?? 'deepseek', qaResult);

  useEffect(() => {
    const lifecycle = ++lifecycleRef.current;
    setSelected(new Set());
    setExpanded(new Set());
    setEditing(null);
    setRegenInstruction('');
    setRegenLevel('medium');
    setManualRegen(null);
    setFinalizeError(null);
    setQaJobId(null);
    setQaResult(null);
    setQaMode('automatic');
    setQaManualPrompt(null);
    setQaManualRaw('');
    setQaManualError(null);
    initialExpansionProjectIdRef.current = null;
    return () => {
      if (lifecycleRef.current === lifecycle) lifecycleRef.current += 1;
      regenControllerRef.current?.abort();
    };
  }, [projectId]);

  useEffect(() => {
    if (!chapters.length || projectQuery.data?.id !== projectId || initialExpansionProjectIdRef.current === projectId) return;
    initialExpansionProjectIdRef.current = projectId;
    setExpanded(new Set([chapters[0]!.id]));
  }, [chapters]);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedChapters.length > 0 && !allSelected;
  }, [allSelected, selectedChapters.length]);

  useEffect(() => {
    if (progress?.status === 'done') {
      void refresh();
      setJobId(null);
      toast('Đã tạo xong bản nháp kịch bản.');
    } else if (progress?.status === 'failed' || progress?.status === 'cancelled') {
      toast(progress.error ?? 'Không thể tạo kịch bản.');
      setJobId(null);
    }
  }, [progress?.status]);

  useEffect(() => {
    if (qaProgress?.status === 'done') {
      const result = api.QAResultSchema.safeParse(qaProgress.result);
      if (result.success) {
        setQaResult(result.data);
        toast('Đã hoàn tất kiểm tra QA.');
      } else {
        toast('Kết quả QA không hợp lệ.');
      }
      setQaJobId(null);
    } else if (qaProgress?.status === 'failed' || qaProgress?.status === 'cancelled') {
      toast(qaProgress.error ?? 'Không thể kiểm tra QA.');
      setQaJobId(null);
    }
  }, [qaProgress?.status, qaProgress?.result]);

  useEffect(() => {
    if (!manualRegen) return;
    const prefersReducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    manualRegenBoxRef.current?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    manualRegenTextareaRef.current?.focus();
  }, [manualRegen?.chapterId, manualRegen?.prompt]);

  async function generate() {
    try { setJobId((await api.generateScript(projectId)).jobId); } catch (error) { toast(error instanceof Error ? error.message : 'Không thể tạo kịch bản.'); }
  }

  async function runQa() {
    try { setQaResult(null); setQaManualError(null); setQaJobId((await api.runFinalQa(projectId)).jobId); } catch (error) { toast(error instanceof Error ? error.message : 'Không thể chạy kiểm tra QA.'); }
  }

  async function loadQaManualPrompt() {
    setQaManualBusy(true);
    setQaManualError(null);
    try {
      setQaManualPrompt(await api.getFinalQaManualPrompt(projectId));
    } catch (error) {
      setQaManualError(error instanceof Error ? error.message : 'Không thể tải prompt QA.');
    } finally { setQaManualBusy(false); }
  }

  async function copyQaManualPrompt() {
    if (!qaManualPrompt) return;
    try { await navigator.clipboard.writeText(qaManualPrompt.prompt); toast('Đã sao chép prompt QA.'); } catch { toast('Không thể sao chép prompt QA.'); }
  }

  async function importQaManual() {
    setQaManualBusy(true);
    setQaManualError(null);
    try {
      setQaResult(await api.importFinalQa(projectId, qaManualRaw));
      toast('Đã nhập kết quả QA.');
    } catch (error) {
      setQaManualError(error instanceof Error ? error.message : 'Không thể nhập kết quả QA.');
    } finally { setQaManualBusy(false); }
  }

  function applyQaIssue(issue: QAIssue) {
    const chapterId = findChapterIdByNumber(chapters, issue.chapter);
    if (!chapterId) { toast('Không tìm thấy chương tương ứng.'); return; }
    setSelected(new Set([chapterId]));
    setExpanded((current) => new Set(current).add(chapterId));
    setRegenInstruction(buildQaRegenInstruction(issue, qaTypeLabel[issue.type], qaActionLabel[issue.suggestedAction]));
    regenInstructionRef.current?.focus();
  }

  async function changeProvider(provider: 'deepseek' | 'claude') {
    setProviderBusy(true);
    try { await api.setAiProvider(projectId, provider); await projectQuery.refetch(); toast('Đã đổi nhà cung cấp AI.'); } catch (error) { toast(error instanceof Error ? error.message : 'Không thể đổi nhà cung cấp AI.'); } finally { setProviderBusy(false); }
  }

  async function loadManualPrompt() {
    setManualBusy(true);
    try { setManualPrompt(await api.getManualScriptPrompt(projectId)); } catch (error) { toast(error instanceof Error ? error.message : 'Không thể tải prompt thủ công.'); } finally { setManualBusy(false); }
  }

  async function copyManualPrompt() {
    if (!manualPrompt) return;
    try { await navigator.clipboard.writeText(manualPrompt.prompt); toast('Đã sao chép prompt.'); } catch { toast('Không thể sao chép prompt.'); }
  }

  async function importManual() {
    setManualBusy(true);
    try {
      await api.importManualScript(projectId, manualRaw);
      setManualRaw(manualTextAfterImport(manualRaw, true));
      setManualPrompt(null);
      await refresh();
      toast('Đã nhập bản thảo thủ công.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thể nhập bản thảo thủ công.');
      setManualRaw(manualTextAfterImport(manualRaw, false));
    } finally { setManualBusy(false); }
  }

  async function loadManualRegenPrompt(chapter: ChapterDoc) {
    setManualRegenBusy(true);
    try {
      const prompt = await api.getRegenerationManualPrompt(projectId, chapter.id, { instruction: regenInstruction, level: regenLevel });
      setManualRegen({ chapterId: chapter.id, prompt: prompt.prompt, promptVersion: prompt.promptVersion, raw: '', error: null });
      toast(`Đã tải prompt tái tạo chương ${chapter.no}. Sao chép rồi dán JSON kết quả vào ô bên dưới.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thể tải prompt tái tạo.');
    } finally { setManualRegenBusy(false); }
  }

  async function copyManualRegenPrompt() {
    if (!manualRegen) return;
    try { await navigator.clipboard.writeText(manualRegen.prompt); toast('Đã sao chép prompt tái tạo.'); } catch { toast('Không thể sao chép prompt.'); }
  }

  async function importManualRegen(chapter: ChapterDoc) {
    if (!manualRegen || manualRegen.chapterId !== chapter.id) return;
    setManualRegenBusy(true);
    try {
      await api.importRegeneratedChapter(projectId, chapter.id, manualRegen.raw);
      await refresh();
      setManualRegen(null);
      toast(`Đã nhập chương ${chapter.no}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể nhập chương tái tạo.';
      setManualRegen((current) => current ? { ...current, error: message } : current);
    } finally { setManualRegenBusy(false); }
  }

  async function refresh() { await Promise.all([projectQuery.refetch(), historyQuery.refetch()]); }

  async function patch(chapterId: string, body: Parameters<typeof api.patchChapter>[2]) {
    try { await api.patchChapter(projectId, chapterId, body); await refresh(); } catch (error) { toast(error instanceof Error ? error.message : 'Không thể cập nhật chương.'); }
  }

  function startEdit(chapter: ChapterDoc) {
    setEditing(chapter.id);
    setExpanded((current) => new Set(current).add(chapter.id));
    setEditParagraphs([...chapter.paragraphs]);
  }

  function toggleExpanded(chapterId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  }

  async function saveEdit(chapterId: string) { await patch(chapterId, { paragraphs: editParagraphs }); setEditing(null); }

  async function regenerate(chapter: ChapterDoc, instruction = regenInstruction, level: 'light' | 'medium' | 'rewrite' = regenLevel): Promise<boolean> {
    if (regenControllerRef.current) return false;
    const controller = new AbortController();
    let aborted = false;
    regenControllerRef.current = controller;
    setRegen({ id: chapter.id, instruction, level, preview: '', controller });
    try {
      await api.regenerateChapter(projectId, chapter.id, { instruction, level }, (chunk) => setRegen((current) => current ? { ...current, preview: current.preview + chunk } : current), controller.signal);
      await refresh();
    } catch (error) {
      aborted = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      if (!aborted) toast(error instanceof Error ? error.message : 'Không thể tái tạo chương.');
      await refresh();
    } finally {
      if (regenControllerRef.current === controller) regenControllerRef.current = null;
      setRegen((current) => current?.controller === controller ? null : current);
    }
    return aborted || controller.signal.aborted;
  }

  async function regenerateChapterIds(chapterIds: readonly string[]) {
    if (regenControllerRef.current) return;
    const lifecycle = lifecycleRef.current;
    const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    await runRegenerationQueue(chapterIds, async (chapterId) => {
      if (lifecycleRef.current !== lifecycle) return true;
      const chapter = chapterById.get(chapterId);
      return chapter ? regenerate(chapter) : false;
    });
  }

  async function regenerateSelected() { await regenerateChapterIds(selectedRegenIds); }

  async function regenerateAll() {
    if (!window.confirm('Tái tạo toàn bộ kịch bản?')) return;
    await regenerateChapterIds(regenerateAllIds);
  }

  async function approveAll() {
    try {
      for (const chapterId of regenerateAllIds) {
        await api.patchChapter(projectId, chapterId, { status: 'approved' });
      }
      await refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thể duyệt tất cả chương.');
      await refresh();
    }
  }

  async function restore(index: number) {
    if (!window.confirm('Khôi phục phiên bản này?')) return;
    try { await api.restoreChapters(projectId, index); await refresh(); } catch (error) { toast(error instanceof Error ? error.message : 'Không thể khôi phục.'); }
  }

  async function finalize() {
    if (!window.confirm('Chốt kịch bản và chia cảnh?')) return;
    setFinalizeError(null);
    try { await api.finalizeScript(projectId); toast('Đã chốt kịch bản.'); navigate(`/production/${projectId}/studio`); } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể chốt kịch bản.';
      setFinalizeError(message);
      toast(message);
    }
  }

  async function insertOpeningHook(chapter: ChapterDoc) {
    const hook = projectQuery.data?.openingHook.trim() ?? '';
    if (!shouldOfferOpeningHook(chapter, hook)) return;
    await patch(chapter.id, { paragraphs: [hook, ...chapter.paragraphs] });
  }

  if (projectQuery.isLoading) return <section className={styles.panel}><p>Đang tải kịch bản…</p></section>;
  if (projectQuery.error) return <section className={styles.panel}><p className={styles.error}>Không thể tải dự án.</p></section>;

  return (
    <div className={styles.page}>
      <ol className={styles.stepper} aria-label="Tiến trình sản xuất">
        {steps.map((step, index) => (
          <Fragment key={step.label}>
            <li className={[styles.step, step.state === 'done' ? styles.stepDone : step.state === 'active' ? styles.stepActive : ''].filter(Boolean).join(' ')} aria-current={step.state === 'active' ? 'step' : undefined}>
              <span className={styles.stepDot}>{step.state === 'done' ? <Icon name="check" /> : index + 1}</span>
              <div><div className={styles.stepLabel}>{step.label}</div><div className={styles.stepSub}>{step.sub}</div></div>
            </li>
            {index < steps.length - 1 && <li className={[styles.stepLine, step.state === 'done' ? styles.stepLineDone : ''].filter(Boolean).join(' ')} aria-hidden="true" />}
          </Fragment>
        ))}
      </ol>

      {!chapters.length && !jobId ? (
        <section className={styles.panel} aria-labelledby="generate-title">
          <h2 id="generate-title">Nháp kịch bản</h2>
          <p className={styles.muted}>AI sẽ viết kịch bản theo brief và preset của dự án.</p>
          <label className={styles.inlineField} htmlFor="review-provider">Nhà cung cấp AI
            <select className={styles.input} id="review-provider" value={projectQuery.data?.aiProvider ?? 'deepseek'} disabled={controlsBusy} onChange={(event) => void changeProvider(event.target.value as 'deepseek' | 'claude')}>
              <option value="deepseek">DeepSeek</option><option value="claude">Claude</option>
            </select>
          </label>
          <fieldset className={styles.modeControls}>
            <legend>Phương thức tạo</legend>
            <label><input type="radio" name="generation-mode" value="automatic" checked={effectiveGenerationMode === 'automatic'} disabled={controlsBusy} onChange={() => setGenerationMode('automatic')} />Tự động</label>
            <label><input type="radio" name="generation-mode" value="manual" checked={effectiveGenerationMode === 'manual'} disabled={controlsBusy} onChange={() => setGenerationMode('manual')} />Thủ công</label>
          </fieldset>
          {effectiveGenerationMode === 'automatic' ? <Button variant="amber" disabled={controlsBusy} onClick={() => void generate()}>Tạo kịch bản</Button> : <div className={styles.manualBox}>
            <div className={styles.actions}><Button variant="indigoline" disabled={manualBusy || controlsBusy} onClick={() => void loadManualPrompt()}>Lấy prompt</Button>{manualPrompt && <Button disabled={manualBusy || controlsBusy} onClick={() => void copyManualPrompt()}>Sao chép</Button>}</div>
            {manualPrompt && <p className={styles.muted}>Prompt {manualPrompt.promptVersion}</p>}
            <textarea className={styles.textarea} value={manualRaw} onChange={(event) => setManualRaw(event.target.value)} placeholder="Dán JSON bản thảo hoàn chỉnh vào đây…" aria-label="Bản thảo thủ công" />
            <Button variant="amber" disabled={manualBusy || controlsBusy || !manualRaw.trim()} onClick={() => void importManual()}>Nhập bản thảo</Button>
          </div>}
        </section>
      ) : (
        <div className={styles.reviewGrid}>
          <section className={`${styles.panel} ${styles.chapters}`} aria-labelledby="chapters-title">
            {jobId && progress && progress.status !== 'done' && (
              <div className={styles.generationStatus} role="status"><strong>Đang tạo kịch bản… {Math.round(progress.progress)}%</strong><div className={styles.logs}>{progress.logs.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}</div></div>
            )}
            <div className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle} id="chapters-title"><Icon name="list" />Kịch bản theo chương</h2>
                <div className={styles.summary}>{chaptersSummaryText(chapters)}</div>
              </div>
              <div className={styles.actions}>
                <Button disabled={!hasApprovableChapters} onClick={() => void approveAll()}><Icon name="check" />Duyệt tất cả</Button>
                <Button variant="red" title={regenMode === 'manual' ? 'Chế độ thủ công chỉ tái tạo từng chương' : undefined} disabled={regenMode === 'manual' || Boolean(regen) || regenerateAllIds.length === 0} onClick={() => void regenerateAll()}><Icon name="refresh" />Tái tạo toàn bộ</Button>
              </div>
            </div>
            <div className={styles.regenToolbar}>
              <label className={styles.compactField} htmlFor="review-provider-existing">AI
                <select className={styles.input} id="review-provider-existing" value={projectQuery.data?.aiProvider ?? 'deepseek'} disabled={controlsBusy} onChange={(event) => void changeProvider(event.target.value as 'deepseek' | 'claude')}>
                  <option value="deepseek">DeepSeek</option><option value="claude">Claude</option>
                </select>
              </label>
              <span className={styles.toolbarDivider} aria-hidden="true" />
              <fieldset className={`${styles.segmented} ${styles.regenMode}`} aria-label="Chế độ tái tạo" disabled={controlsBusy}>
                <label><input type="radio" name="regeneration-mode" value="automatic" checked={regenMode === 'automatic'} onChange={() => setRegenMode('automatic')} /><span>Tự động</span></label>
                <label><input type="radio" name="regeneration-mode" value="manual" checked={regenMode === 'manual'} onChange={() => setRegenMode('manual')} /><span>Thủ công (JSON)</span></label>
              </fieldset>
              <div className={styles.regenStatus} title={regenMode === 'manual' ? manualRegenHelp : undefined}>
                {regenMode === 'automatic' && <span className={styles.statusDot} aria-hidden="true" />}
                <span className={styles.regenStatusText}>{regenerationStatusLabel(regenMode, projectQuery.data?.aiProvider ?? 'deepseek')}</span>
              </div>
            </div>
            {regenMode === 'manual' && <p className={styles.regenManualHelp}>{manualRegenHelp}</p>}
            {finalizeError && <div className={styles.errorAlert} role="alert">{finalizeError}</div>}
            <label className={styles.selectAll}><input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? new Set(chapters.map((chapter) => chapter.id)) : new Set())} />Chọn tất cả chương</label>
            <div className={styles.chapterList}>
              {chapters.map((chapter) => {
                const isCurrentRegen = regen?.id === chapter.id;
                const busy = Boolean(isCurrentRegen) || chapter.status === 'generating';
                const isEditing = editing === chapter.id;
                const isExpanded = expanded.has(chapter.id);
                const meta = chapterMetaText(chapter);
                return <article className={styles.chapter} data-selected={selected.has(chapter.id)} key={chapter.id}>
                  <div className={styles.chapterTop}>
                    <input type="checkbox" checked={selected.has(chapter.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(chapter.id); else next.delete(chapter.id); return next; })} aria-label={`Chọn chương ${chapter.no}`} />
                    <button type="button" className={styles.chapterToggle} aria-expanded={isExpanded || isEditing} aria-controls={`chapter-body-${chapter.id}`} onClick={() => toggleExpanded(chapter.id)}>
                      <span className={styles.chapterNo}>{String(chapter.no).padStart(2, '0')}</span><span className={styles.chapterTitle}>{chapter.title}</span>{meta && <span className={styles.chapterMeta}>{meta}</span>}<Icon name="chevron" className={styles.chapterChevron} />
                    </button>
                    <Badge tone={statusTone[chapter.status]}>{statusLabel[chapter.status]}</Badge><span className={styles.spacer} />
                    <div className={styles.actions}>
                      {isCurrentRegen ? <Button size="sm" variant="red" onClick={() => regen.controller.abort()}>Hủy</Button> : <>
                        <Button size="icon" active={chapter.status === 'needs-fix'} aria-label={`Đánh dấu cần sửa chương ${chapter.no}`} aria-pressed={chapter.status === 'needs-fix'} disabled={busy} onClick={() => void patch(chapter.id, { status: toggleFlagStatus(chapter.status) })}><Icon name="flag" /></Button>
                        <Button disabled={busy} onClick={() => startEdit(chapter)}><Icon name="edit" />Sửa</Button>
                        {regenMode === 'manual' ? <Button variant="indigoline" disabled={busy || manualRegenBusy} onClick={() => void loadManualRegenPrompt(chapter)}>{manualRegenBusy ? 'Đang lấy prompt…' : <><Icon name="refresh" />Lấy prompt tái tạo</>}</Button> : <Button variant="indigoline" disabled={busy || manualRegenBusy} onClick={() => void regenerate(chapter)}><Icon name="refresh" />Tái tạo</Button>}
                        <Button variant={chapter.status === 'approved' ? 'green' : 'ghost'} aria-pressed={chapter.status === 'approved'} disabled={busy} onClick={() => void patch(chapter.id, { status: toggleApproveStatus(chapter.status) })}><Icon name="check" />{chapter.status === 'approved' ? 'Đã duyệt' : 'Duyệt'}</Button>
                      </>}
                    </div>
                     </div>
                   {manualRegen?.chapterId === chapter.id && <div ref={manualRegenBoxRef} className={`${styles.manualBox} ${styles.chapterManualBox}`}>
                     <div className={styles.manualBoxHeader}><div><strong>{`Chương ${chapter.no}: ${chapter.title}`}</strong><p className={styles.muted}>Prompt {manualRegen.promptVersion}</p></div><Button size="sm" onClick={() => setManualRegen(null)}>Đóng</Button></div>
                     <p className={`${styles.muted} ${styles.manualBoxSteps}`}>Bước 1: Sao chép prompt · Bước 2: dán vào AI bất kỳ · Bước 3: dán JSON kết quả vào ô rồi bấm "Nhập chương".</p>
                     <div className={styles.actions}><Button variant="indigoline" disabled={manualRegenBusy} onClick={() => void copyManualRegenPrompt()}>Sao chép</Button></div>
                     <textarea ref={manualRegenTextareaRef} className={styles.textarea} value={manualRegen.raw} onChange={(event) => setManualRegen((current) => current ? { ...current, raw: event.target.value, error: null } : current)} placeholder='{"paragraphs":[…],"chapterSummary":"…","avoidRepeating":[…],"persistentFactsNext":[…]}' aria-label={`JSON tái tạo chương ${chapter.no}`} />
                     {manualRegen.error && <p className={styles.error}>{manualRegen.error}</p>}
                     <Button variant="amber" disabled={manualRegenBusy || !manualRegen.raw.trim()} onClick={() => void importManualRegen(chapter)}>Nhập chương</Button>
                   </div>}
                   {shouldOfferOpeningHook(chapter, projectQuery.data?.openingHook ?? '') && <div className={styles.hookCallout}><div><strong>Hook mở đầu đề xuất</strong><p>{projectQuery.data?.openingHook}</p></div><Button variant="amber" disabled={busy} onClick={() => void insertOpeningHook(chapter)}>Chèn hook làm đoạn đầu tiên</Button></div>}
                   <div className={styles.chapterBody} id={`chapter-body-${chapter.id}`} hidden={!isExpanded && !isEditing}>{isEditing ? <><textarea className={styles.textarea} value={editParagraphs.join('\n\n')} onChange={(event) => setEditParagraphs(event.target.value.split(/\n\s*\n/))} aria-label={`Sửa nội dung chương ${chapter.no}`} /><div className={styles.editorActions}><Button size="sm" onClick={() => setEditing(null)}>Hủy</Button><Button size="sm" variant="amber" onClick={() => void saveEdit(chapter.id)}><Icon name="save" />Lưu</Button></div></> : <><div className={styles.narrativeMeta}>{chapter.role && <span>Vai trò: {chapter.role}</span>}{chapter.targetWords != null && <span>Mục tiêu: {chapter.targetWords} từ</span>}{chapter.beat && <span>Nhịp: {chapter.beat}</span>}{chapter.endsOnTension && <span>Kết tension</span>}</div>{chapter.paragraphs.map((paragraph, index) => <p key={`${chapter.id}-${index}`}>{paragraph}</p>)}</>}</div>
                   {isCurrentRegen && <div className={styles.regen}><span>Đang xem trước bản tái tạo…</span><div className={styles.preview}>{regen.preview || 'Đang nhận token…'}</div></div>}
                </article>;
              })}
            </div>
          </section>

          <aside className={styles.side}>
            <section className={styles.panel} aria-labelledby="regen-title">
              <h2 className={`${styles.panelTitle} ${styles.panelTitleIndigo}`} id="regen-title"><Icon name="sparkles" />Yêu cầu tái tạo</h2>
              <div className={styles.selectedCount}>{selectedChapters.length ? `Áp dụng cho ${selectedChapters.length} chương đã chọn` : 'Chưa chọn chương nào'}</div>
              <label className="sr-only" htmlFor="regen-instruction">Yêu cầu cho lần tái tạo</label>
              <textarea ref={regenInstructionRef} id="regen-instruction" className={styles.textarea} rows={5} value={regenInstruction} onChange={(event) => setRegenInstruction(event.target.value)} placeholder="VD: Giọng kể trầm hơn, nhấn mạnh việc thuyền lương bị bỏ lại…" />
              <fieldset className={styles.segmented}>
                <legend>Mức thay đổi</legend>
                {([['light', 'Nhẹ'], ['medium', 'Vừa'], ['rewrite', 'Viết lại']] as const).map(([value, label]) => <label key={value}><input type="radio" name="regen-level" value={value} checked={regenLevel === value} onChange={() => setRegenLevel(value)} /><span>{label}</span></label>)}
              </fieldset>
               <Button variant="indigo" size="lg" className={styles.blockButton} title={regenMode === 'manual' ? 'Chế độ thủ công chỉ tái tạo từng chương' : undefined} disabled={regenMode === 'manual' || Boolean(regen) || selectedRegenIds.length === 0} onClick={() => void regenerateSelected()}><Icon name="refresh" />Tái tạo chương đã chọn</Button>
            </section>

            <section className={styles.panel} aria-labelledby="history-title">
              <h2 className={styles.panelTitle} id="history-title"><Icon name="history" />Lịch sử phiên bản</h2>
              <ul className={styles.historyList}>
                <li className={styles.historyItem}><div><div className={styles.historyName}>Bản {history.length + 1}</div><div className={styles.historyNote}>Bản đang mở · {projectQuery.data?.updatedAt ? new Date(projectQuery.data.updatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'vừa xong'}</div></div><Badge tone="green">Hiện tại</Badge></li>
                {history.map((snapshot, index) => <li className={styles.historyItem} key={`${snapshot.takenAt.toISOString()}-${index}`}><div><div className={styles.historyName}>{historyVersionLabel(index, history.length)}</div><div className={styles.historyNote}>Bản lưu tự động · {snapshot.takenAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</div></div><Button size="sm" onClick={() => void restore(index)}><Icon name="history" />Khôi phục</Button></li>)}
              </ul>
              {historyQuery.isLoading && <p className={styles.muted}>Đang tải lịch sử…</p>}
              {historyQuery.error && <p className={styles.error}>Không thể tải lịch sử.</p>}
            </section>

            <section className={styles.panel} aria-labelledby="qa-title">
              <h2 className={styles.panelTitle} id="qa-title"><Icon name="check" />Kiểm tra cuối (QA)</h2>
              <fieldset className={`${styles.segmented} ${styles.qaMode}`} aria-label="Chế độ kiểm tra QA" disabled={qaControlsBusy}>
                <label><input type="radio" name="qa-mode" value="automatic" checked={qaMode === 'automatic'} onChange={() => setQaMode('automatic')} /><span>Tự động</span></label>
                <label><input type="radio" name="qa-mode" value="manual" checked={qaMode === 'manual'} onChange={() => setQaMode('manual')} /><span>Thủ công (JSON)</span></label>
              </fieldset>
              {qaMode === 'manual' && !qaResult ? <p className={styles.muted}>Thủ công: lấy prompt, dán vào AI bất kỳ, rồi dán JSON kết quả vào</p> : qaReviewer.lines.map((line) => <p className={styles.muted} key={line}>{line}</p>)}
              {qaReviewer.hint && <p className={styles.muted}>{qaReviewer.hint}</p>}
              {qaMode === 'automatic' ? <Button variant="indigoline" disabled={chapters.length === 0 || qaBusy} onClick={() => void runQa()}>Chạy kiểm tra QA</Button> : <div className={styles.manualBox}>
                <div className={styles.actions}>
                  <Button variant="indigoline" disabled={qaControlsBusy} onClick={() => void loadQaManualPrompt()}>Lấy prompt QA</Button>
                  {qaManualPrompt && <Button disabled={qaControlsBusy} onClick={() => void copyQaManualPrompt()}>Sao chép</Button>}
                </div>
                {qaManualPrompt && <>
                  <p className={styles.muted}>Prompt {qaManualPrompt.promptVersion}</p>
                  <textarea className={styles.textarea} value={qaManualRaw} onChange={(event) => { setQaManualRaw(event.target.value); setQaManualError(null); }} placeholder='{"issues":[{"chapter":1,"type":"REPETITION","severity":"low","reason":"…","suggestedAction":"REMOVE_DUPLICATION"}]}' aria-label="JSON kết quả QA" />
                  <p className={styles.muted}>Loại: {api.QA_ISSUE_TYPES.join(', ')} · Mức độ: {api.QA_SEVERITIES.join(', ')} · Đề xuất: {api.QA_SUGGESTED_ACTIONS.join(', ')}</p>
                  {qaManualError && <p className={styles.error}>{qaManualError}</p>}
                  <Button variant="amber" disabled={qaControlsBusy || !qaManualRaw.trim()} onClick={() => void importQaManual()}>Nhập kết quả QA</Button>
                </>}
                {!qaManualPrompt && qaManualError && <p className={styles.error}>{qaManualError}</p>}
              </div>}
              {qaProgress && (qaProgress.status === 'queued' || qaProgress.status === 'running') && <div className={styles.generationStatus} role="status"><strong>Đang kiểm tra QA… {Math.round(qaProgress.progress)}%</strong></div>}
              {qaResult && (qaResult.issues.length === 0 ? <p className={styles.muted}>Không phát hiện vấn đề.</p> : <div className={styles.qaIssues}>
                {[...groupQaIssuesByChapter(qaResult.issues)].map(([chapter, issues]) => <div key={chapter}>
                  <h3 className={styles.qaGroupTitle}>Chương {chapter}</h3>
                  <div className={styles.qaIssueList}>{issues.map((issue, index) => <article className={styles.qaIssue} key={`${issue.type}-${index}`}>
                    <div className={styles.qaIssueTop}><strong>{qaTypeLabel[issue.type]}</strong><Badge tone={qaSeverityTone(issue.severity)}>Mức độ: {qaSeverityLabel[issue.severity]}</Badge></div>
                    <div className={styles.qaIssueText}>{issue.reason}</div>
                    <div className={styles.qaIssueAction}>Đề xuất: {qaActionLabel[issue.suggestedAction]}</div>
                    <Button size="sm" variant="indigoline" onClick={() => applyQaIssue(issue)}>Áp dụng</Button>
                  </article>)}</div>
                </div>)}
              </div>)}
            </section>
          </aside>
        </div>
      )}

      <footer className={styles.footer}><Button variant="amber" disabled={!allApproved || hasGenerating || Boolean(jobId)} onClick={() => void finalize()}>Chốt & chia cảnh</Button></footer>
    </div>
  );
}
