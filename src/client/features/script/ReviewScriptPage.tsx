import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AiProvider } from '../../../contracts/project';
import { AI_MODEL_REGISTRY } from '../../../contracts/ai-models';
import { CLAUDE_CLI_DEFAULT_EFFORT, CLAUDE_CLI_DEFAULT_MODEL } from '../../../contracts/claude-cli';
import { getReferenceCoverage, type ChapterDoc, type ScriptQualitySummary } from '../../../contracts/script';
import type { ManualScriptImportResult, QAIssue, QAResult } from './api';
import { isHardStopRegenerationError } from './api';
import { QaApplyAllDialog, type QaApplyAllResult } from './components/QaApplyAllDialog';
import { QaIssueCard } from './components/QaIssueCard';
import { QaFixDialog } from './components/QaFixDialog';
import { Badge } from '../../shared/ui/Badge';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { toast } from '../../shared/ui/toast-store';
import { useJobProgress } from '../../shared/hooks/use-job-progress';
import { BlockingProgressDialog } from '../../shared/ui/BlockingProgressDialog';
import { isStudioLocked, type BlockingProgressInput, type BlockingTask } from '../../shared/ui/blocking-progress';
import { cancelJob } from '../../shared/job-api';
import { AiModelSelect, aiModelForProviderChange } from '../../shared/ai/AiModelSelect';
import { ChapterRegenModelHelp, ChapterRegenModelSelect } from './ChapterRegenModelSelect';
import * as api from './api';
import { buildScriptGenerationRequest, cliGenerationEstimate, type ClaudeCliModelId, type ScriptGenerationBackend } from './generation-mode';
import {
  approveAllTargets,
  chapterWordBudgetNote,
  chapterMetaText,
  chaptersSummaryText,
  chaptersWithHighQaIssues,
  defaultExpandedQaKeys,
  applyReplacementToParagraphs,
  explainQuoteMatch,
  findChapterIdByNumber,
  findQuoteTarget,
  findUndoSnapshotIndex,
  historyVersionLabel,
  instructionForChapter,
  manualTextAfterImport,
  runRegenerationQueue,
  selectedRegenTargets,
  qaIssueInstruction,
  qaIssueKey,
  planBulkQaApply,
  bulkUndoIsSafe,
  bulkUndoRevisionMatches,
  qaLevelForAction,
  qaSeverityTone,
  sortQaIssues,
  splitQaIssuesByChapter,
  summarizeQaIssues,
  summarizeQaIssuesByChapter,
  toggleApproveStatus,
  toggleFlagStatus,
  runBulkQaApplyQueue,
  regenerationOutcomeAfterStream,
  type QuoteMatchOutcome,
  type QaBulkApplyOption,
  type QaBulkApplyPlan,
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

function manualQualitySignature(chapters: readonly ChapterDoc[]): string {
  return JSON.stringify(chapters.map(({ no, title, role, targetWords, paragraphs }) => ({ no, title, role, targetWords, paragraphs })));
}

export function regenerationStatusLabel(mode: 'automatic' | 'cli' | 'manual', provider: AiProvider): string {
  return mode === 'automatic' ? `Tự động bằng ${aiProviderLabel[provider]}` : mode === 'cli' ? 'Claude CLI trên máy này' : 'Thủ công: tự dán JSON';
}

export function formatCliStatusVersion(version: string | null | undefined): string {
  return version?.replace(/^Claude Code\s+/i, '').replace(/\s*\(Claude Code\)$/i, '').trim() || 'sẵn sàng';
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

type QaDialogState = {
  chapterId: string;
  issue: QAIssue | null;
  baseline: ChapterDoc;
  mode: 'automatic' | 'manual';
  initialInstruction: string;
  initialLevel: 'light' | 'medium' | 'rewrite';
  viewOnly: boolean;
  firstStartedAt: Date | null;
  result: boolean;
  restored: boolean;
};

type QaBulkUndoContext = {
  historyBatchId: string;
  expectedVersion: number;
  expectedAfter: ChapterDoc[];
  issueKeys: string[];
};

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

export function getResumableChapterNo(chapters: readonly Pick<ChapterDoc, 'no' | 'paragraphs'>[], generationJobId: string | null): number | null {
  if (generationJobId) return null;
  return chapters.find((chapter) => chapter.paragraphs.length === 0)?.no ?? null;
}

export function ReviewScriptPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [jobId, setJobId] = useState<string | null>(null);
  const [qaJobId, setQaJobId] = useState<string | null>(null);
  const [reviewJobTask, setReviewJobTask] = useState<BlockingTask | null>(null);
  const [reviewJobStartedAt, setReviewJobStartedAt] = useState<number | null>(null);
  const [reviewJobLastEventAt, setReviewJobLastEventAt] = useState<number | null>(null);
  const [reviewJobReconnectKey, setReviewJobReconnectKey] = useState(0);
  const [reviewJobLocallyUnlocked, setReviewJobLocallyUnlocked] = useState(false);
  const [qaResult, setQaResult] = useState<QAResult | null>(null);
  const [qaMode, setQaMode] = useState<'automatic' | 'manual'>('automatic');
  const [qaManualPrompt, setQaManualPrompt] = useState<{ prompt: string; promptVersion: string } | null>(null);
  const [qaManualRaw, setQaManualRaw] = useState('');
  const [qaManualError, setQaManualError] = useState<string | null>(null);
  const [qaManualBusy, setQaManualBusy] = useState(false);
  const [qaIssueStates, setQaIssueStates] = useState<Record<string, 'accepted' | 'dismissed'>>({});
  const [qaPatchConfirming, setQaPatchConfirming] = useState<string | null>(null);
  const [qaPatchBusy, setQaPatchBusy] = useState(false);
  const [qaBulkRunning, setQaBulkRunning] = useState(false);
  const [qaBulkProgress, setQaBulkProgress] = useState<BlockingProgressInput | null>(null);
  const [qaBulkStartedAt, setQaBulkStartedAt] = useState<number | null>(null);
  const [qaBulkLastEventAt, setQaBulkLastEventAt] = useState<number | null>(null);
  const [qaBulkResult, setQaBulkResult] = useState<QaApplyAllResult | null>(null);
  const [qaStale, setQaStale] = useState(false);
  const [qaResultsOpen, setQaResultsOpen] = useState(true);
  const [expandedQaKeys, setExpandedQaKeys] = useState<Set<string>>(new Set());
  const [qaDialog, setQaDialog] = useState<QaDialogState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editParagraphs, setEditParagraphs] = useState<string[]>([]);
  const [regen, setRegen] = useState<{ id: string; instruction: string; level: 'light' | 'medium' | 'rewrite'; preview: string; controller: AbortController } | null>(null);
  const [regenInstruction, setRegenInstruction] = useState('');
  const [instructionOrigin, setInstructionOrigin] = useState<{ kind: 'user' } | { kind: 'qa'; chapterId: string }>({ kind: 'user' });
  const [regenLevel, setRegenLevel] = useState<'light' | 'medium' | 'rewrite'>('medium');
  const [regenMode, setRegenMode] = useState<'automatic' | 'cli' | 'manual'>('automatic');
  const [cliModel, setCliModel] = useState<ClaudeCliModelId>(CLAUDE_CLI_DEFAULT_MODEL);
  const [cliJobId, setCliJobId] = useState<string | null>(null);
  const [cliJobStartedAt, setCliJobStartedAt] = useState<number | null>(null);
  const [cliJobLastEventAt, setCliJobLastEventAt] = useState<number | null>(null);
  const [manualRegen, setManualRegen] = useState<{ chapterId: string; prompt: string; promptVersion: string; raw: string; error: string | null } | null>(null);
  const [manualRegenBusy, setManualRegenBusy] = useState(false);
  const [generationMode, setGenerationMode] = useState<'automatic' | 'cli' | 'manual'>('automatic');
  const [resumeBackend, setResumeBackend] = useState<ScriptGenerationBackend>('api');
  const [cliGenerationModel, setCliGenerationModel] = useState<ClaudeCliModelId | null>(CLAUDE_CLI_DEFAULT_MODEL);
  const [manualRaw, setManualRaw] = useState('');
  const [manualPrompt, setManualPrompt] = useState<{ prompt: string; promptVersion: string } | null>(null);
  const [manualQuality, setManualQuality] = useState<{ projectId: string; signature: string; summary: ScriptQualitySummary } | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const regenControllerRef = useRef<AbortController | null>(null);
  const qaBulkCancelRequestedRef = useRef(false);
  const qaBulkUndoRef = useRef<QaBulkUndoContext | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const editFocusRequestRef = useRef<{ chapterId: string; quote?: string } | null>(null);
  const manualRegenBoxRef = useRef<HTMLDivElement>(null);
  const manualRegenTextareaRef = useRef<HTMLTextAreaElement>(null);
  const qaBlockRefs = useRef<Record<string, HTMLElement | null>>({});
  const lifecycleRef = useRef(0);
  const initialExpansionProjectIdRef = useRef<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const progress = useJobProgress(jobId, reviewJobReconnectKey);
  const qaProgress = useJobProgress(qaJobId, reviewJobReconnectKey);
  const cliProgress = useJobProgress(cliJobId, reviewJobReconnectKey);
  const cliStatusQuery = useQuery({ queryKey: ['script', 'claude-cli-status'], queryFn: api.getClaudeCliStatus, enabled: Boolean(projectId), staleTime: 15_000, retry: false });
  const projectQuery = useQuery({ queryKey: ['projects', 'detail', projectId], queryFn: () => api.getProject(projectId), enabled: Boolean(projectId) });
  const historyQuery = useQuery({ queryKey: ['projects', 'chapters', 'history', projectId], queryFn: () => api.getChapterHistory(projectId), enabled: Boolean(projectId) });
  const chapters = projectQuery.data?.chapters ?? [];
  const resumeChapterNo = getResumableChapterNo(chapters, jobId);
  const visibleManualQuality = manualQuality?.projectId === projectId && manualQuality.signature === manualQualitySignature(chapters) ? manualQuality.summary : null;
  const referenceCoverage = projectQuery.data ? getReferenceCoverage(projectQuery.data.referencesText, projectQuery.data.targetDurationSec) : null;
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
  const effectiveGenerationMode = chapters.length > 0 ? 'automatic' : generationMode;
  const activeReviewJobId = jobId ?? qaJobId;
  const activeReviewProgress = jobId ? progress : qaProgress;
  const reviewJobLocked = !reviewJobLocallyUnlocked && isStudioLocked(null, activeReviewJobId, activeReviewProgress);
  const cliJobLocked = isStudioLocked(null, cliJobId, cliProgress);
  const controlsBusy = reviewJobLocked || cliJobLocked || hasGenerating || manualBusy || manualRegenBusy || providerBusy || qaBulkRunning;
  const qaRegenMode = regenMode === 'manual' ? 'manual' : 'automatic';
  const qaBusy = !reviewJobLocallyUnlocked && isStudioLocked(null, qaJobId, qaProgress);
  const qaControlsBusy = qaBusy || qaManualBusy || qaBulkRunning;
  const qaReviewer = qaReviewerDisplay(projectQuery.data?.aiProvider ?? 'deepseek', qaResult);
  const qaBulkPlans = useMemo<Record<QaBulkApplyOption, QaBulkApplyPlan>>(() => {
    const plan = (option: QaBulkApplyOption) => planBulkQaApply({
      issues: qaResult?.issues ?? [],
      chapters,
      option,
      issueStates: qaIssueStates,
      regenMode: qaRegenMode,
      instructionForIssue: (issue) => qaIssueInstruction(issue, qaTypeLabel[issue.type], qaActionLabel[issue.suggestedAction]),
    });
    return { high: plan('high'), 'high-medium': plan('high-medium'), all: plan('all') };
  }, [chapters, qaIssueStates, qaResult, qaRegenMode]);
  const bulkApplyDisabled = !qaResult || controlsBusy || qaBusy || qaManualBusy || qaPatchBusy || qaBulkRunning
    || Boolean(editing || manualRegen || qaDialog) || Object.values(qaBulkPlans).every((plan) => plan.actionableCount === 0);
  const activeQaIssues = useMemo(() => qaResult ? sortQaIssues(qaResult.issues.filter((issue) => qaIssueStates[qaIssueKey(issue)] !== 'dismissed')) : [], [qaResult, qaIssueStates]);
  const qaSummary = useMemo(() => summarizeQaIssues(activeQaIssues), [activeQaIssues]);
  const qaPlacement = useMemo(() => splitQaIssuesByChapter(activeQaIssues, chapters), [activeQaIssues, chapters]);
  const qaChapterSummaries = useMemo(() => summarizeQaIssuesByChapter(activeQaIssues), [activeQaIssues]);
  const highQaChapterNos = useMemo(() => chaptersWithHighQaIssues(activeQaIssues), [activeQaIssues]);
  const dismissedQaCount = qaResult ? qaResult.issues.filter((issue) => qaIssueStates[qaIssueKey(issue)] === 'dismissed').length : 0;
  const qaDialogChapter = qaDialog ? chapters.find((chapter) => chapter.id === qaDialog.chapterId) ?? null : null;
  const qaDialogUndoIndex = qaDialog?.result && qaDialog.firstStartedAt && qaDialogChapter
    ? findUndoSnapshotIndex(history, chapters, qaDialog.chapterId, qaDialog.firstStartedAt)
    : null;
  const activeReviewStartedAt = reviewJobStartedAt;

  useEffect(() => {
    const lifecycle = ++lifecycleRef.current;
    setSelected(new Set());
    setExpanded(new Set());
    setEditing(null);
    setRegenInstruction('');
    setInstructionOrigin({ kind: 'user' });
    setRegenLevel('medium');
    setManualRegen(null);
    setFinalizeError(null);
    setJobId(null);
    setQaJobId(null);
    setCliJobId(null);
    setCliJobStartedAt(null);
    setCliJobLastEventAt(null);
    setReviewJobTask(null);
    setReviewJobStartedAt(null);
    setReviewJobLastEventAt(null);
    setReviewJobLocallyUnlocked(false);
    setQaResult(null);
    setQaMode('automatic');
    setQaManualPrompt(null);
    setQaManualRaw('');
    setQaManualError(null);
    setQaIssueStates({});
    setQaPatchConfirming(null);
    setQaPatchBusy(false);
    setQaBulkRunning(false);
    setQaBulkProgress(null);
    setQaBulkStartedAt(null);
    setQaBulkLastEventAt(null);
    setQaBulkResult(null);
    qaBulkCancelRequestedRef.current = false;
    qaBulkUndoRef.current = null;
    setQaStale(false);
    setQaResultsOpen(true);
    setExpandedQaKeys(new Set());
    setQaDialog(null);
    editFocusRequestRef.current = null;
    initialExpansionProjectIdRef.current = null;
    return () => {
      qaBulkCancelRequestedRef.current = true;
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
    if (!qaResult || highQaChapterNos.size === 0) return;
    const highChapterIds = chapters.filter((chapter) => highQaChapterNos.has(chapter.no)).map((chapter) => chapter.id);
    if (highChapterIds.length === 0) return;
    setExpanded((current) => {
      const next = new Set(current);
      highChapterIds.forEach((chapterId) => next.add(chapterId));
      return next.size === current.size ? current : next;
    });
  }, [chapters, highQaChapterNos, qaResult]);

  useEffect(() => {
    if (!qaResult) {
      setExpandedQaKeys(new Set());
      return;
    }
    const byChapter = new Map<number, QAIssue[]>();
    for (const issue of qaResult.issues.filter((item) => item.severity !== 'low')) {
      const chapterIssues = byChapter.get(issue.chapter) ?? [];
      chapterIssues.push(issue);
      byChapter.set(issue.chapter, chapterIssues);
    }
    const defaults = new Set<string>();
    for (const chapterIssues of byChapter.values()) {
      defaultExpandedQaKeys(chapterIssues).forEach((key) => defaults.add(key));
    }
    setExpandedQaKeys(defaults);
  }, [qaResult]);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedChapters.length > 0 && !allSelected;
  }, [allSelected, selectedChapters.length]);

  useEffect(() => {
    if (progress?.status === 'done') {
      void refresh();
      setJobId(null);
      setReviewJobTask(null);
      toast('Đã tạo xong bản nháp kịch bản.');
    } else if (progress?.status === 'failed' || progress?.status === 'cancelled') {
      void refresh();
      setJobId(null);
      setReviewJobTask(null);
      toast(progress.error ?? (progress.status === 'cancelled' ? 'Đã hủy; bạn có thể viết tiếp từ chương còn trống.' : 'Không thể tạo kịch bản.'));
    }
  }, [progress?.status]);

  useEffect(() => {
    if (qaProgress?.status === 'done') {
      const result = api.QAResultSchema.safeParse(qaProgress.result);
      if (result.success) {
        setQaResult(result.data);
        setQaIssueStates({});
        setQaPatchConfirming(null);
        setQaStale(false);
        setQaResultsOpen(true);
        toast('Đã hoàn tất kiểm tra QA.');
      } else {
        toast('Kết quả QA không hợp lệ.');
      }
      setQaJobId(null);
      setReviewJobTask(null);
    } else if (qaProgress?.status === 'failed' || qaProgress?.status === 'cancelled') {
      toast(qaProgress.error ?? 'Không thể kiểm tra QA.');
    }
  }, [qaProgress?.status, qaProgress?.result]);

  useEffect(() => {
    if (cliProgress?.status === 'done') {
      void refresh();
      toast('Đã tái tạo xong bằng Claude CLI.');
    } else if (cliProgress?.status === 'failed') {
      void refresh();
      toast(cliProgress.error ?? 'Không thể tái tạo bằng Claude CLI.');
    } else if (cliProgress?.status === 'cancelled') {
      void refresh();
      toast('Đã huỷ tác vụ Claude CLI.');
    }
  }, [cliProgress?.status]);
  useEffect(() => {
    if (progress) setReviewJobLastEventAt(Date.now());
    if (qaProgress) setReviewJobLastEventAt(Date.now());
    if (cliProgress) setCliJobLastEventAt(Date.now());
  }, [progress, qaProgress, cliProgress]);

  useEffect(() => {
    if (!manualRegen) return;
    const prefersReducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    manualRegenBoxRef.current?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    manualRegenTextareaRef.current?.focus();
  }, [manualRegen?.chapterId, manualRegen?.prompt]);

  useEffect(() => {
    const request = editFocusRequestRef.current;
    if (!request || editing !== request.chapterId || !editTextareaRef.current) return;
    const textarea = editTextareaRef.current;
    const prefersReducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    textarea.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    textarea.focus();
    if (request.quote) {
      const start = textarea.value.indexOf(request.quote);
      if (start >= 0 && textarea.value.indexOf(request.quote, start + request.quote.length) < 0) {
        textarea.setSelectionRange(start, start + request.quote.length);
      }
    }
    editFocusRequestRef.current = null;
  }, [editing, editParagraphs]);

  async function generate() {
    const backend: ScriptGenerationBackend = generationMode === 'cli' ? 'cli' : 'api';
    await enqueueScriptGeneration(false, backend, cliGenerationModel);
  }

  async function resumeScriptGeneration() {
    await enqueueScriptGeneration(true, resumeBackend, cliGenerationModel);
  }

  async function enqueueScriptGeneration(resume: boolean, backend: ScriptGenerationBackend, cliModel: ClaudeCliModelId | null) {
    try {
      const result = await api.generateScript(projectId, buildScriptGenerationRequest({ backend, cliModel, resume }));
      setReviewJobTask({ kind: backend === 'cli' ? 'cli-script-generation' : 'script-generation' });
      setReviewJobStartedAt(Date.now());
      setReviewJobLastEventAt(Date.now());
      setReviewJobLocallyUnlocked(false);
      setJobId(result.jobId);
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể tạo kịch bản.'); }
  }

  async function runQa() {
    try {
      setQaResult(null);
      setQaIssueStates({});
      setQaPatchConfirming(null);
      setQaStale(false);
      setQaResultsOpen(true);
      setQaManualError(null);
      const result = await api.runFinalQa(projectId);
      setReviewJobTask({ kind: 'final-qa' });
      setReviewJobStartedAt(Date.now());
      setReviewJobLastEventAt(Date.now());
      setReviewJobLocallyUnlocked(false);
      setQaJobId(result.jobId);
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể chạy kiểm tra QA.'); }
  }

  async function cancelReviewJob(): Promise<void> {
    if (!activeReviewJobId) return;
    try {
      await cancelJob(activeReviewJobId);
      toast('Đã yêu cầu huỷ tác vụ.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thể huỷ tác vụ.');
    }
  }

  async function reloadReviewJob(): Promise<void> {
    setReviewJobLastEventAt(Date.now());
    setReviewJobReconnectKey((current) => current + 1);
    await refresh();
  }

  function closeReviewJob(): void {
    setJobId(null);
    setQaJobId(null);
    setReviewJobTask(null);
    setReviewJobStartedAt(null);
    setReviewJobLastEventAt(null);
    setReviewJobLocallyUnlocked(false);
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
      setQaIssueStates({});
      setQaPatchConfirming(null);
      setQaStale(false);
      setQaResultsOpen(true);
      toast('Đã nhập kết quả QA.');
    } catch (error) {
      setQaManualError(error instanceof Error ? error.message : 'Không thể nhập kết quả QA.');
    } finally { setQaManualBusy(false); }
  }

  function qaChapterAndTarget(issue: QAIssue): { chapter: ChapterDoc; target: ReturnType<typeof findQuoteTarget> } | null {
    const chapterId = findChapterIdByNumber(chapters, issue.chapter);
    const chapter = chapterId ? chapters.find((item) => item.id === chapterId) : undefined;
    return chapter ? { chapter, target: findQuoteTarget(chapter, issue) } : null;
  }

  function openQaFixDialog(issue: QAIssue | null, chapter: ChapterDoc, viewOnly: boolean) {
    setManualRegen(null);
    setQaDialog({
      chapterId: chapter.id,
      issue,
      baseline: { ...chapter, paragraphs: [...chapter.paragraphs] },
      mode: qaRegenMode,
      initialInstruction: issue ? qaIssueInstruction(issue, qaTypeLabel[issue.type], qaActionLabel[issue.suggestedAction]) : '',
      initialLevel: issue ? qaLevelForAction(issue.suggestedAction) : 'medium',
      viewOnly,
      firstStartedAt: null,
      result: false,
      restored: false,
    });
  }

  function openQaIssueDetails(issue: QAIssue) {
    const match = qaChapterAndTarget(issue);
    if (!match) { toast('Không tìm thấy chương tương ứng.'); return; }
    openQaFixDialog(issue, match.chapter, true);
  }

  function applyQaIssue(issue: QAIssue) {
    const match = qaChapterAndTarget(issue);
    if (!match) { toast('Không tìm thấy chương tương ứng.'); return; }
    if (match.target && issue.replacement !== undefined) {
      setQaPatchConfirming(qaIssueKey(issue));
      return;
    }
    openQaFixDialog(issue, match.chapter, false);
  }

  async function acceptQaIssue(issue: QAIssue) {
    if (qaPatchBusy) return;
    const match = qaChapterAndTarget(issue);
    if (!match?.target || issue.replacement === undefined) return;
    setQaPatchBusy(true);
    try {
      const paragraphs = applyReplacementToParagraphs(match.chapter.paragraphs, match.target, issue.replacement);
      await api.patchChapter(projectId, match.chapter.id, { paragraphs });
      await refresh();
      setQaIssueStates((current) => ({ ...current, [qaIssueKey(issue)]: 'accepted' }));
      setQaPatchConfirming(null);
      setQaStale(true);
      toast(`Đã áp dụng gợi ý cho chương ${issue.chapter}.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thể áp dụng gợi ý.');
    } finally {
      setQaPatchBusy(false);
    }
  }

  function cancelQaPatch(issue: QAIssue) {
    setQaPatchConfirming((current) => current === qaIssueKey(issue) ? null : current);
  }

  function dismissQaIssue(issue: QAIssue) {
    setQaPatchConfirming(null);
    setQaIssueStates((current) => ({ ...current, [qaIssueKey(issue)]: 'dismissed' }));
  }

  function restoreDismissedQaIssues() {
    setQaIssueStates((current) => Object.fromEntries(Object.entries(current).filter(([, state]) => state !== 'dismissed')));
  }

  function editQaIssue(issue: QAIssue) {
    const match = qaChapterAndTarget(issue);
    if (!match) { toast('Không tìm thấy chương tương ứng.'); return; }
    setQaPatchConfirming(null);
    editFocusRequestRef.current = { chapterId: match.chapter.id, quote: issue.quote };
    startEdit(match.chapter);
  }

  async function changeProvider(provider: 'deepseek' | 'claude', model?: string) {
    setProviderBusy(true);
    try { await api.setAiProvider(projectId, provider, model); await projectQuery.refetch(); toast(model ? 'Đã đổi model AI.' : 'Đã đổi nhà cung cấp AI.'); } catch (error) { toast(error instanceof Error ? error.message : 'Không thể đổi cấu hình AI.'); } finally { setProviderBusy(false); }
  }

  function changeModel(model: string) {
    const provider = projectQuery.data?.aiProvider ?? 'deepseek';
    if (model === projectQuery.data?.aiModel || controlsBusy) return;
    void changeProvider(provider, model);
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
      const result: ManualScriptImportResult = await api.importManualScript(projectId, manualRaw);
      setManualRaw(manualTextAfterImport(manualRaw, true));
      setManualPrompt(null);
      const updatedProject = await refresh();
      setManualQuality({ projectId, signature: manualQualitySignature(updatedProject?.chapters ?? result.project.chapters), summary: result.quality });
      setQaStale(true);
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
      const result = await api.importRegeneratedChapter(projectId, chapter.id, manualRegen.raw);
      const updatedProject = await refresh();
      if (updatedProject) setManualQuality({ projectId, signature: manualQualitySignature(updatedProject.chapters), summary: result.quality });
      setManualRegen(null);
      setQaStale(true);
      toast(`Đã nhập chương ${chapter.no}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể nhập chương tái tạo.';
      setManualRegen((current) => current ? { ...current, error: message } : current);
    } finally { setManualRegenBusy(false); }
  }

  async function refresh() {
    const [projectResult] = await Promise.all([projectQuery.refetch(), historyQuery.refetch()]);
    return projectResult.data;
  }

  function recordQaBulkProgress(detail: string, completed: number, total: number): void {
    const now = Date.now();
    setQaBulkProgress((current) => ({
      status: 'running',
      progress: total > 0 ? Math.round(completed / total * 100) : 0,
      error: null,
      logs: [...(current?.logs ?? []), detail].slice(-8),
    }));
    setQaBulkLastEventAt(now);
  }

  async function runQaBulkApply(option: QaBulkApplyOption): Promise<void> {
    const startingProject = projectQuery.data;
    const plan = qaBulkPlans[option];
    if (!startingProject || plan.actionableCount === 0 || qaBulkRunning) return;

    const lifecycle = lifecycleRef.current;
    const historyBatchId = crypto.randomUUID();
    const startedAt = Date.now();
    const result: QaApplyAllResult = {
      option,
      appliedPatches: 0,
      regeneratedChapters: 0,
      skipped: [...plan.skipped],
      failures: [],
      cancelled: false,
      undoAvailable: false,
      undoBlocked: null,
      restored: false,
    };
    const appliedIssueKeys: string[] = [];
    // Batch writes increment Project.version once per chapter write; paragraph changes
    // also write the next chapter's upstream-review marker.
    let expectedBatchVersion = startingProject.version;
    let revisionTrackingCertain = true;
    const hasNextChapter = (chapterNo: number) => startingProject.chapters.some((chapter) => chapter.no === chapterNo + 1);
    qaBulkCancelRequestedRef.current = false;
    qaBulkUndoRef.current = null;
    setQaBulkResult(null);
    setQaBulkProgress({ status: 'running', progress: 0, error: null, logs: [] });
    setQaBulkStartedAt(startedAt);
    setQaBulkLastEventAt(startedAt);
    setQaBulkRunning(true);

    const cancelled = () => qaBulkCancelRequestedRef.current || lifecycleRef.current !== lifecycle;
    const markAccepted = (issues: readonly QAIssue[]) => {
      const keys = issues.map(qaIssueKey);
      appliedIssueKeys.push(...keys);
      setQaIssueStates((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, 'accepted' as const])) }));
    };

    try {
      const latestAtStart = await api.getProject(projectId);
      if (latestAtStart.version !== startingProject.version) {
        await refresh();
        throw new Error('Kịch bản đã thay đổi trước khi bắt đầu. Hãy kiểm tra lại kết quả QA rồi thử lại.');
      }
      const execution = await runBulkQaApplyQueue(plan, {
        applyPatch: async (patchPlan) => {
          try {
            await api.patchChapter(projectId, patchPlan.chapterId, { paragraphs: patchPlan.paragraphs, historyBatchId });
            expectedBatchVersion += 1 + (hasNextChapter(patchPlan.chapterNo) ? 1 : 0);
          } catch (error) {
            revisionTrackingCertain = false;
            throw error;
          }
        },
        regenerate: async (regeneration) => {
          const chapter = chapters.find((item) => item.id === regeneration.chapterId);
          if (!chapter) return { status: 'failed', hardStop: false, message: 'Không tìm thấy chương tương ứng.' };
          let regenerationError: unknown;
          const outcome = await regenerate(chapter, regeneration.instruction, regeneration.level, {
            historyBatchId,
            quiet: true,
            onError: (error) => { regenerationError = error; },
            onChunk: () => setQaBulkLastEventAt(Date.now()),
          });
          if (outcome === 'success') {
            // Success writes generating + regenerated chapter, and may mark the next chapter.
            expectedBatchVersion += 2 + (hasNextChapter(regeneration.chapterNo) ? 1 : 0);
            return { status: 'success' };
          }
          if (outcome === 'aborted') {
            // The server marks generating, then resets the chapter after stream abort.
            expectedBatchVersion += 2;
            return { status: 'aborted' };
          }
          if (regenerationError instanceof api.RegenerationStreamError) expectedBatchVersion += 2;
          else revisionTrackingCertain = false;
          return {
            status: 'failed',
            hardStop: isHardStopRegenerationError(regenerationError),
            message: regenerationError instanceof Error ? regenerationError.message : 'Không thể tái tạo chương.',
          };
        },
        isCancelled: cancelled,
        onProgress: recordQaBulkProgress,
        onApplied: (issues) => {
          markAccepted(issues);
          setQaStale(true);
        },
      });
      Object.assign(result, execution);

      if (cancelled()) result.cancelled = true;
      if (lifecycleRef.current !== lifecycle) return;
      const hasAttemptedChange = result.appliedPatches > 0 || result.regeneratedChapters > 0 || result.failures.length > 0;
      try {
        await refresh().catch(() => undefined);
        const [finishedProject, finishedHistory] = await Promise.all([api.getProject(projectId), api.getChapterHistory(projectId)]);
        if (lifecycleRef.current !== lifecycle) return;
        const snapshotIndex = finishedHistory.findIndex((snapshot) => snapshot.historyBatchId === historyBatchId);
        const revisionMatches = bulkUndoRevisionMatches(expectedBatchVersion, finishedProject.version, revisionTrackingCertain);
        result.undoAvailable = snapshotIndex >= 0 && hasAttemptedChange && revisionMatches;
        if (hasAttemptedChange && !revisionMatches) {
          result.undoBlocked = 'Kịch bản đã thay đổi trong hoặc sau lượt chạy; không thể hoàn tác an toàn.';
        } else if (hasAttemptedChange && snapshotIndex < 0) {
          result.undoBlocked = 'Không còn bản hoàn tác trong lịch sử phiên bản.';
        }
        if (result.undoAvailable) {
          qaBulkUndoRef.current = {
            historyBatchId,
            expectedVersion: expectedBatchVersion,
            expectedAfter: finishedProject.chapters,
            issueKeys: [...new Set(appliedIssueKeys)],
          };
        }
      } catch {
        if (hasAttemptedChange) {
          result.undoAvailable = false;
          result.undoBlocked = 'Lượt đã chạy xong nhưng không thể xác minh bản hoàn tác an toàn.';
        }
      }
      setQaBulkResult(result);
    } catch (error) {
      if (lifecycleRef.current === lifecycle) toast(error instanceof Error ? error.message : 'Không thể áp dụng các gợi ý QA.');
    } finally {
      if (lifecycleRef.current === lifecycle) {
        setQaBulkRunning(false);
        setQaBulkStartedAt(null);
      }
    }
  }

  function cancelQaBulkApply(): void {
    qaBulkCancelRequestedRef.current = true;
    regenControllerRef.current?.abort();
    setQaBulkLastEventAt(Date.now());
  }

  async function undoQaBulkApply(): Promise<void> {
    const context = qaBulkUndoRef.current;
    if (!context || !qaBulkResult?.undoAvailable || qaBulkResult.restored) return;
    try {
      const [currentProject, currentHistory] = await Promise.all([api.getProject(projectId), api.getChapterHistory(projectId)]);
      if (currentProject.version !== context.expectedVersion || !bulkUndoIsSafe(context.expectedAfter, currentProject.chapters)) {
        setQaBulkResult((current) => current ? {
          ...current,
          undoAvailable: false,
          undoBlocked: 'Dự án đã thay đổi kể từ lượt áp dụng; không thể hoàn tác an toàn. Hãy khôi phục thủ công hoặc xem lịch sử phiên bản.',
        } : current);
        return;
      }
      const snapshotIndex = currentHistory.findIndex((snapshot) => snapshot.historyBatchId === context.historyBatchId);
      if (snapshotIndex < 0) {
        setQaBulkResult((current) => current ? { ...current, undoAvailable: false, undoBlocked: 'Không còn bản hoàn tác trong lịch sử phiên bản.' } : current);
        return;
      }
      let restoreError: string | null = null;
      const restored = await restore(snapshotIndex, 'Hoàn tác toàn bộ lượt áp dụng QA về bản trước khi chạy?', context.expectedVersion, (message) => { restoreError = message; });
      if (!restored) {
        if (restoreError) setQaBulkResult((current) => current ? { ...current, undoAvailable: false, undoBlocked: restoreError } : current);
        return;
      }
      setQaIssueStates((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !context.issueKeys.includes(key))));
      setQaStale(true);
      setQaBulkResult((current) => current ? { ...current, restored: true, undoAvailable: false, undoBlocked: null } : current);
    } catch (error) {
      setQaBulkResult((current) => current ? {
        ...current,
        undoAvailable: false,
        undoBlocked: error instanceof Error ? error.message : 'Không thể hoàn tác lượt áp dụng QA an toàn.',
      } : current);
    }
  }

  async function patch(chapterId: string, body: Parameters<typeof api.patchChapter>[2]): Promise<boolean> {
    try { await api.patchChapter(projectId, chapterId, body); await refresh(); return true; } catch (error) { toast(error instanceof Error ? error.message : 'Không thể cập nhật chương.'); return false; }
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

  function focusQaChapter(chapterId: string) {
    setExpanded((current) => new Set(current).add(chapterId));
    window.requestAnimationFrame(() => {
      const prefersReducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      qaBlockRefs.current[chapterId]?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    });
  }

  async function saveEdit(chapterId: string) { if (await patch(chapterId, { paragraphs: editParagraphs })) setQaStale(true); setEditing(null); }

  async function regenerate(
    chapter: ChapterDoc,
    instruction = regenInstruction,
    level: 'light' | 'medium' | 'rewrite' = regenLevel,
    options: { historyBatchId?: string; quiet?: boolean; onError?: (error: unknown) => void; onChunk?: () => void } = {},
  ): Promise<'success' | 'aborted' | 'failed'> {
    if (regenControllerRef.current) return 'failed';
    const controller = new AbortController();
    let aborted = false;
    let failed = false;
    let streamCompleted = false;
    regenControllerRef.current = controller;
    setRegen({ id: chapter.id, instruction, level, preview: '', controller });
    try {
      await api.regenerateChapter(projectId, chapter.id, { instruction, level, ...(options.historyBatchId ? { historyBatchId: options.historyBatchId } : {}) }, (chunk) => {
        setRegen((current) => current ? { ...current, preview: current.preview + chunk } : current);
        options.onChunk?.();
      }, controller.signal);
      streamCompleted = true;
      setQaStale(true);
    } catch (error) {
      streamCompleted = error instanceof api.RegenerationStreamError;
      aborted = !streamCompleted && (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError'));
      if (!aborted) {
        failed = true;
        options.onError?.(error);
        if (!options.quiet) toast(error instanceof Error ? error.message : 'Không thể tái tạo chương.');
      }
    } finally {
      try {
        await refresh();
      } catch (error) {
        if (streamCompleted && !failed && !options.quiet) toast(error instanceof Error ? error.message : 'Đã tái tạo nhưng không thể làm mới dữ liệu.');
      }
      if (regenControllerRef.current === controller) regenControllerRef.current = null;
      setRegen((current) => current?.controller === controller ? null : current);
    }
    return regenerationOutcomeAfterStream(streamCompleted, aborted || controller.signal.aborted, failed);
  }

  async function regenerateChapterIds(chapterIds: readonly string[]) {
    if (regenControllerRef.current) return;
    const lifecycle = lifecycleRef.current;
    const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    if (regenMode === 'cli') {
      const instruction = chapterIds.length === 1
        ? instructionForChapter(instructionOrigin, regenInstruction, chapterIds[0]!)
        : regenInstruction;
      await enqueueClaudeCli(chapterIds, instruction);
      return;
    }
    await runRegenerationQueue(chapterIds, async (chapterId) => {
      if (lifecycleRef.current !== lifecycle) return true;
      const chapter = chapterById.get(chapterId);
      return chapter ? (await regenerate(chapter, instructionForChapter(instructionOrigin, regenInstruction, chapterId))) === 'aborted' : false;
    });
  }

  async function enqueueClaudeCli(chapterIds: readonly string[], instruction: string): Promise<void> {
    const status = cliStatusQuery.data;
    if (!status?.available) {
      toast(status?.reason ?? 'Claude Code CLI chưa sẵn sàng trên máy này.');
      return;
    }
    try {
      const queued = await api.regenerateWithClaudeCli(projectId, {
        chapterIds: [...chapterIds], instruction, level: regenLevel, model: cliModel,
      });
      const now = Date.now();
      setCliJobStartedAt(now);
      setCliJobLastEventAt(now);
      setCliJobId(queued.jobId);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thể xếp hàng tái tạo bằng Claude CLI.');
    }
  }

  async function cancelClaudeCliJob(): Promise<void> {
    if (!cliJobId) return;
    try {
      await cancelJob(cliJobId);
      toast('Đã yêu cầu huỷ tác vụ Claude CLI.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thể huỷ tác vụ Claude CLI.');
    }
  }

  function closeClaudeCliJob(): void {
    setCliJobId(null);
    setCliJobStartedAt(null);
    setCliJobLastEventAt(null);
  }

  async function regenerateSelected() { await regenerateChapterIds(selectedRegenIds); }

  async function regenerateAll() {
    const approvedInRun = chapters.filter((chapter) => regenerateAllIds.includes(chapter.id) && chapter.status === 'approved').length;
    const approvedNote = approvedInRun > 0 ? ` (${approvedInRun} đã duyệt sẽ về "Chưa duyệt")` : '';
    if (!window.confirm(`Tái tạo ${regenerateAllIds.length} chương${approvedNote}? Bản cũ vẫn nằm trong lịch sử.`)) return;
    await regenerateChapterIds(regenerateAllIds);
  }

  async function approveAll() {
    try {
      for (const chapterId of regenerateAllIds.filter((chapterId) => chapters.find((chapter) => chapter.id === chapterId)?.status !== 'approved')) {
        await api.patchChapter(projectId, chapterId, { status: 'approved' });
      }
      await refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thể duyệt tất cả chương.');
      await refresh();
    }
  }

  async function restore(index: number, confirmMessage = 'Khôi phục phiên bản này?', expectedVersion?: number, onError?: (message: string) => void): Promise<boolean> {
    if (!window.confirm(confirmMessage)) return false;
    try { await api.restoreChapters(projectId, index, expectedVersion); await refresh(); setQaStale(true); return true; } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể khôi phục.';
      if (onError) onError(message);
      else toast(message);
      return false;
    }
  }

  async function runQaDialogRegeneration(instruction: string, level: 'light' | 'medium' | 'rewrite') {
    if (!qaDialog || qaDialog.viewOnly || regenControllerRef.current) return;
    const chapter = chapters.find((item) => item.id === qaDialog.chapterId);
    if (!chapter) return;
    const firstStartedAt = qaDialog.firstStartedAt ?? new Date();
    if (!qaDialog.firstStartedAt) setQaDialog((current) => current ? { ...current, firstStartedAt } : current);
    const outcome = await regenerate(chapter, instruction, level);
    if (outcome === 'success') {
      setQaDialog((current) => current ? { ...current, result: true, restored: false, firstStartedAt } : current);
    } else if (!qaDialog.result) {
      setQaDialog((current) => current ? { ...current, firstStartedAt: null } : current);
    }
  }

  async function importQaDialogChapter(raw: string): Promise<string | null> {
    if (!qaDialog) return 'Không có chương đang mở để nhập.';
    const chapter = chapters.find((item) => item.id === qaDialog.chapterId);
    if (!chapter) return 'Không tìm thấy chương tương ứng.';
    const firstStartedAt = qaDialog.firstStartedAt ?? new Date();
    if (!qaDialog.firstStartedAt) setQaDialog((current) => current ? { ...current, firstStartedAt } : current);
    try {
      await api.importRegeneratedChapter(projectId, chapter.id, raw);
      await refresh();
      setQaStale(true);
      setQaDialog((current) => current ? { ...current, result: true, restored: false, firstStartedAt } : current);
      toast(`Đã nhập chương ${chapter.no}.`);
      return null;
    } catch (error) {
      if (!qaDialog.result) setQaDialog((current) => current ? { ...current, firstStartedAt: null } : current);
      return error instanceof Error ? error.message : 'Không thể nhập chương tái tạo.';
    }
  }

  async function undoQaDialog() {
    if (!qaDialog || qaDialogUndoIndex == null) return;
    if (await restore(qaDialogUndoIndex, 'Hoàn tác về bản trước khi tái tạo?')) {
      setQaDialog((current) => current ? { ...current, restored: true } : current);
    }
  }

  function keepQaDialog() {
    if (qaDialog?.issue) setQaIssueStates((current) => ({ ...current, [qaIssueKey(qaDialog.issue!)]: 'accepted' }));
    setQaDialog(null);
  }

  function dismissQaDialog() {
    if (qaDialog?.issue) dismissQaIssue(qaDialog.issue);
    setQaDialog(null);
  }

  function continueQaDialog(nextChapter: ChapterDoc) {
    openQaFixDialog(null, nextChapter, false);
  }

  async function finalize() {
    const upstreamChanged = chapters.filter((chapter) => chapter.reviewStatus === 'upstream-changed');
    const upstreamNote = upstreamChanged.length > 0
      ? `\n${upstreamChanged.length} chương còn đánh dấu "cần xem lại" (chương ${upstreamChanged.map((chapter) => chapter.no).join(', ')}). Vẫn chốt?`
      : '';
    if (!window.confirm(`Chốt kịch bản và chia cảnh?${upstreamNote}`)) return;
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
    if (await patch(chapter.id, { paragraphs: [hook, ...chapter.paragraphs] })) setQaStale(true);
  }

  const renderQaIssue = (issue: QAIssue, collapsible = false) => {
    const match = qaChapterAndTarget(issue);
    const replacement = issue.replacement;
    const quoteMatch: QuoteMatchOutcome | null = match ? explainQuoteMatch(match.chapter, issue) : null;
    const removesParagraph = Boolean(match?.target && replacement !== undefined
      && applyReplacementToParagraphs(match.chapter.paragraphs, match.target, replacement).length < match.chapter.paragraphs.length);
    const key = qaIssueKey(issue);
    return <QaIssueCard
      key={key}
      issue={issue}
      typeLabel={qaTypeLabel[issue.type]}
      severityLabel={qaSeverityLabel[issue.severity]}
      actionLabel={qaActionLabel[issue.suggestedAction]}
      patchTarget={match?.target ?? null}
      quoteMatch={quoteMatch}
      replacement={replacement}
      removesParagraph={removesParagraph}
      regenerationInstruction={qaIssueInstruction(issue, qaTypeLabel[issue.type], qaActionLabel[issue.suggestedAction])}
      regenerationLevel={qaLevelForAction(issue.suggestedAction)}
      collapsible={collapsible}
      expanded={expandedQaKeys.has(key) || qaPatchConfirming === key || qaIssueStates[key] === 'accepted'}
      confirming={qaPatchConfirming === key}
      accepted={qaIssueStates[key] === 'accepted'}
      onToggleExpanded={() => setExpandedQaKeys((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      })}
      onApply={() => applyQaIssue(issue)}
      onAccept={() => void acceptQaIssue(issue)}
      onCancel={() => cancelQaPatch(issue)}
      onEdit={() => editQaIssue(issue)}
      onDismiss={() => dismissQaIssue(issue)}
      onDetails={() => openQaIssueDetails(issue)}
    />;
  };

  const regenModelHelpIsStatus = regenMode === 'cli' || cliStatusQuery.isLoading || cliStatusQuery.isError || cliStatusQuery.data?.available === false;
  const regenModelHelp = regenMode === 'manual' ? manualRegenHelp
    : regenModelHelpIsStatus
      ? cliStatusQuery.isLoading ? 'Đang kiểm tra Claude Code CLI…' : cliStatusQuery.data?.available
        ? `Claude Code ${formatCliStatusVersion(cliStatusQuery.data.version)} · ${cliStatusQuery.data.authPathLikely === 'subscription' ? 'phiên đăng nhập CLI' : 'API key'}`
        : cliStatusQuery.data?.reason ?? 'Không thể kiểm tra Claude Code CLI trên máy này.'
      : 'Chi phí xem trên dashboard của Claude/DeepSeek.';

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
          {referenceCoverage?.shouldWarn && <p className={styles.qualityWarning} role="status">Nguồn tham khảo ngắn: {referenceCoverage.referenceCharacters} ký tự cho {referenceCoverage.targetMinutes} phút ({referenceCoverage.charactersPerMinute} ký tự/phút; ngưỡng cảnh báo 500). Bạn vẫn có thể tiếp tục tạo kịch bản.</p>}
          <div className={styles.generationModes}>
            <fieldset className={styles.modeControls}>
              <legend>Phương thức tạo</legend>
              <label><input type="radio" name="generation-mode" value="automatic" checked={effectiveGenerationMode === 'automatic'} disabled={controlsBusy} onChange={() => setGenerationMode('automatic')} />Tự động (API)</label>
              <label title={cliStatusQuery.data?.available ? undefined : cliStatusQuery.data?.reason ?? 'Đang kiểm tra Claude CLI trên máy này.'}><input type="radio" name="generation-mode" value="cli" checked={effectiveGenerationMode === 'cli'} disabled={controlsBusy || !cliStatusQuery.data?.available} onChange={() => setGenerationMode('cli')} />Claude CLI (máy này)</label>
              <label><input type="radio" name="generation-mode" value="manual" checked={effectiveGenerationMode === 'manual'} disabled={controlsBusy} onChange={() => setGenerationMode('manual')} />Thủ công (JSON)</label>
            </fieldset>
            <div className={styles.generationPanel}>
              <div className={styles.generationInfo}>
                <p className={styles.generationModeExplanation}>
                  {effectiveGenerationMode === 'automatic'
                    ? 'Gửi yêu cầu đến nhà cung cấp và model AI đã chọn cho dự án.'
                    : effectiveGenerationMode === 'cli'
                      ? 'Dùng Claude Code CLI trên máy này; model CLI độc lập với cấu hình AI của dự án.'
                      : 'Dán JSON bản thảo từ AI bất kỳ; ứng dụng sẽ kiểm tra trước khi nhập.'}
                </p>
                <div className={styles.generationStatusSlot} aria-live="polite">
                  {(effectiveGenerationMode === 'cli' || cliStatusQuery.isLoading || cliStatusQuery.isError || cliStatusQuery.data?.available === false)
                    ? <p className={styles.cliStatus} role="status">
                      {cliStatusQuery.isLoading ? 'Đang kiểm tra Claude Code CLI…' : cliStatusQuery.data?.available
                        ? 'Claude Code ' + (formatCliStatusVersion(cliStatusQuery.data.version)) + ' · ' + (cliStatusQuery.data.authPathLikely === 'subscription' ? 'phiên đăng nhập CLI' : 'API key')
                        : cliStatusQuery.data?.reason ?? 'Không thể kiểm tra Claude Code CLI trên máy này.'}
                    </p>
                    : <span className={styles.generationStatusPlaceholder} aria-hidden="true" />}
                </div>
              </div>
              <div className={styles.generationOptions}>
                {effectiveGenerationMode === 'automatic' && <>
                  <label className={styles.inlineField} htmlFor="review-provider">Nhà cung cấp AI
                    <select className={styles.input} id="review-provider" value={projectQuery.data?.aiProvider ?? 'deepseek'} disabled={controlsBusy} onChange={(event) => {
                      const provider = event.target.value as 'deepseek' | 'claude';
                      void changeProvider(provider, aiModelForProviderChange(provider, projectQuery.data?.aiProvider ?? 'deepseek', projectQuery.data?.aiModel));
                    }}>
                      <option value="deepseek">DeepSeek</option><option value="claude">Claude</option>
                    </select>
                  </label>
                  <AiModelSelect className={styles.modelSelect} selectClassName={styles.input} provider={projectQuery.data?.aiProvider ?? 'deepseek'} value={projectQuery.data?.aiModel} disabled={controlsBusy} onChange={changeModel} />
                </>}
                {effectiveGenerationMode === 'cli' && <>
                  <label className={styles.modelSelect} htmlFor="script-cli-model">Model Claude CLI
                    <select className={styles.input} id="script-cli-model" value={cliGenerationModel ?? ''} disabled={controlsBusy} onChange={(event) => setCliGenerationModel(event.target.value ? event.target.value as ClaudeCliModelId : null)}>
                      <option value="">Mặc định của Claude CLI</option>
                      {AI_MODEL_REGISTRY.claude.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                    </select>
                    <small>Mức suy luận: {CLAUDE_CLI_DEFAULT_EFFORT}</small>
                  </label>
                  <p className={styles.generationEstimate}>{cliGenerationEstimate(projectQuery.data?.chapterCount ?? 1).label}</p>
                </>}
                {effectiveGenerationMode === 'manual' && <div className={styles.manualActions}>
                  <div className={styles.actions}><Button variant="indigoline" disabled={manualBusy || controlsBusy} onClick={() => void loadManualPrompt()}>Lấy prompt</Button>{manualPrompt && <Button disabled={manualBusy || controlsBusy} onClick={() => void copyManualPrompt()}>Sao chép</Button>}</div>
                  {manualPrompt && <p className={styles.muted}>Prompt {manualPrompt.promptVersion}</p>}
                </div>}
              </div>
              {effectiveGenerationMode === 'manual' && <textarea className={[styles.textarea, styles.generationManualTextarea].join(' ')} value={manualRaw} onChange={(event) => setManualRaw(event.target.value)} placeholder="Dán JSON bản thảo hoàn chỉnh vào đây…" aria-label="Bản thảo thủ công" />}
              <div className={styles.generationAction}>
                {effectiveGenerationMode === 'automatic' && <Button variant="amber" disabled={controlsBusy} onClick={() => void generate()}>Tạo kịch bản</Button>}
                {effectiveGenerationMode === 'cli' && <Button variant="amber" disabled={controlsBusy || !cliStatusQuery.data?.available} onClick={() => void generate()}>Tạo kịch bản bằng Claude CLI</Button>}
                {effectiveGenerationMode === 'manual' && <Button variant="amber" disabled={manualBusy || controlsBusy || !manualRaw.trim()} onClick={() => void importManual()}>Nhập bản thảo</Button>}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className={styles.reviewGrid}>
          <section className={`${styles.panel} ${styles.chapters}`} aria-labelledby="chapters-title">
            <div className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle} id="chapters-title"><Icon name="list" />Kịch bản theo chương</h2>
                <div className={styles.summary}>{chaptersSummaryText(chapters)}</div>
              </div>
              <div className={styles.actions}>
                <Button disabled={!hasApprovableChapters} onClick={() => void approveAll()}><Icon name="check" />Duyệt tất cả</Button>
                <Button variant="red" title={regenMode === 'manual' ? 'Chế độ thủ công chỉ tái tạo từng chương' : undefined} disabled={regenMode === 'manual' || controlsBusy || (regenMode === 'cli' && !cliStatusQuery.data?.available) || regenerateAllIds.length === 0} onClick={() => void regenerateAll()}><Icon name="refresh" />Tái tạo toàn bộ</Button>
              </div>
            </div>
            {resumeChapterNo !== null && <div className={styles.resumeGeneration}>
              <div className={styles.resumeGenerationControls}>
                <label className={styles.inlineField} htmlFor="script-resume-backend">Viết tiếp bằng
                  <select className={styles.input} id="script-resume-backend" value={resumeBackend} disabled={controlsBusy} onChange={(event) => setResumeBackend(event.target.value as ScriptGenerationBackend)}>
                    <option value="api">API theo model dự án</option>
                    <option value="cli" disabled={!cliStatusQuery.data?.available}>Claude CLI trên máy này</option>
                  </select>
                </label>
                {resumeBackend === 'cli' && <label className={styles.modelSelect} htmlFor="script-resume-cli-model">Model Claude CLI
                  <select className={styles.input} id="script-resume-cli-model" value={cliGenerationModel ?? ''} disabled={controlsBusy} onChange={(event) => setCliGenerationModel(event.target.value ? event.target.value as ClaudeCliModelId : null)}>
                    <option value="">Mặc định của Claude CLI</option>
                    {AI_MODEL_REGISTRY.claude.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                  </select>
                  <small>Mức suy luận: {CLAUDE_CLI_DEFAULT_EFFORT}</small>
                </label>}
                <Button variant="amber" disabled={controlsBusy || (resumeBackend === 'cli' && !cliStatusQuery.data?.available)} onClick={() => void resumeScriptGeneration()}>Viết tiếp từ chương {resumeChapterNo}</Button>
              </div>
              {resumeBackend === 'cli' && <>
                <p className={styles.generationEstimate}>{cliGenerationEstimate(chapters.filter((chapter) => chapter.paragraphs.length === 0).length, false).label}</p>
                <p className={styles.cliStatus} role="status" aria-live="polite">
                  {cliStatusQuery.isLoading ? 'Đang kiểm tra Claude Code CLI…' : cliStatusQuery.data?.available
                    ? `Claude Code ${formatCliStatusVersion(cliStatusQuery.data.version)} · ${cliStatusQuery.data.authPathLikely === 'subscription' ? 'phiên đăng nhập CLI' : 'API key'}`
                    : cliStatusQuery.data?.reason ?? 'Không thể kiểm tra Claude Code CLI trên máy này.'}
                </p>
              </>}
            </div>}
            <div className={styles.regenConfig}>
              <div className={styles.regenConfigOptions}>
                <label className={styles.compactField} htmlFor="review-provider-existing">AI
                  <select className={styles.input} id="review-provider-existing" value={projectQuery.data?.aiProvider ?? 'deepseek'} disabled={controlsBusy} onChange={(event) => {
                    const provider = event.target.value as 'deepseek' | 'claude';
                    void changeProvider(provider, aiModelForProviderChange(provider, projectQuery.data?.aiProvider ?? 'deepseek', projectQuery.data?.aiModel));
                  }}>
                    <option value="deepseek">DeepSeek</option><option value="claude">Claude</option>
                  </select>
                </label>
                <ChapterRegenModelSelect
                  className={styles.regenModelSlot}
                  fieldClassName={styles.modelSelect}
                  selectClassName={styles.input}
                  mode={regenMode}
                  provider={projectQuery.data?.aiProvider ?? 'deepseek'}
                  model={aiModelForProviderChange(projectQuery.data?.aiProvider ?? 'deepseek', projectQuery.data?.aiProvider ?? 'deepseek', projectQuery.data?.aiModel)}
                  cliModel={cliModel}
                  disabled={controlsBusy}
                  onModelChange={(model) => void changeModel(model)}
                  onCliModelChange={setCliModel}
                />
                <ChapterRegenModelHelp className={styles.regenModelHelp} text={regenModelHelp} isStatus={regenModelHelpIsStatus} />
              </div>
              <div className={styles.regenModeRow}>
                <fieldset className={`${styles.segmented} ${styles.regenMode}`} aria-label="Chế độ tái tạo" disabled={controlsBusy}>
                  <label><input type="radio" name="regeneration-mode" value="automatic" checked={regenMode === 'automatic'} onChange={() => setRegenMode('automatic')} /><span>Tự động (API)</span></label>
                  <label title={cliStatusQuery.data?.available ? undefined : cliStatusQuery.data?.reason ?? 'Đang kiểm tra Claude CLI trên máy này.'}><input type="radio" name="regeneration-mode" value="cli" checked={regenMode === 'cli'} disabled={!cliStatusQuery.data?.available} onChange={() => setRegenMode('cli')} /><span>Claude CLI (máy này)</span></label>
                  <label><input type="radio" name="regeneration-mode" value="manual" checked={regenMode === 'manual'} onChange={() => setRegenMode('manual')} /><span>Thủ công (JSON)</span></label>
                </fieldset>
                <div className={styles.regenStatus} title={regenMode === 'manual' ? manualRegenHelp : undefined}>
                  {regenMode === 'automatic' && <span className={styles.statusDot} aria-hidden="true" />}
                  <span className={styles.regenStatusText}>{regenerationStatusLabel(regenMode, projectQuery.data?.aiProvider ?? 'deepseek')}</span>
                </div>
              </div>
            </div>
            {finalizeError && <div className={styles.errorAlert} role="alert">{finalizeError}</div>}
            {qaResult && <details className={styles.qaResultsPanel} open={qaResultsOpen} onToggle={(event) => setQaResultsOpen(event.currentTarget.open)}>
              <summary>
                <span className={styles.qaResultsTitle}><Icon name="check" />Kiểm tra cuối (QA)</span>
                <span className={styles.summary}>{activeQaIssues.length} thẻ</span>
              </summary>
              {qaStale && <div className={styles.qaResultsStale}><Icon name="alert" />Kết quả QA có thể đã cũ vì kịch bản đã thay đổi. Chạy lại kiểm tra để cập nhật.</div>}
              <div className={styles.qaResultsSummary} aria-label="Tóm tắt mức độ QA">
                <strong>{activeQaIssues.length} thẻ</strong>
                <span className={styles.qaSummaryHigh}><i className={styles.qaSummaryDot} aria-hidden="true" />{qaSummary.high} cao</span>
                <span className={styles.qaSummaryMedium}><i className={styles.qaSummaryDot} aria-hidden="true" />{qaSummary.medium} trung bình</span>
                <span className={styles.qaSummaryLow}><i className={styles.qaSummaryDot} aria-hidden="true" />{qaSummary.low} thấp</span>
                <QaApplyAllDialog
                  plans={qaBulkPlans}
                  providerLabel={aiProviderLabel[projectQuery.data?.aiProvider ?? 'deepseek']}
                  regenMode={qaRegenMode}
                  qaStale={qaStale}
                  historyAtLimit={history.length >= 10}
                  disabled={bulkApplyDisabled}
                  busy={qaBulkRunning}
                  result={qaBulkResult}
                  onStart={(option) => void runQaBulkApply(option)}
                  onUndo={() => void undoQaBulkApply()}
                  onDismissResult={() => setQaBulkResult(null)}
                />
              </div>
              {qaChapterSummaries.size > 0 && <div className={styles.qaChapterIndex} aria-label="QA theo chương">
                {chapters.filter((chapter) => qaChapterSummaries.has(chapter.no)).map((chapter) => {
                  const summary = qaChapterSummaries.get(chapter.no)!;
                  const counts = [summary.high ? `${summary.high} cao` : '', summary.medium ? `${summary.medium} trung bình` : '', summary.low ? `${summary.low} thấp` : ''].filter(Boolean).join(' · ');
                  return <Button key={chapter.id} size="sm" variant={summary.highest === 'high' ? 'red' : summary.highest === 'medium' ? 'indigoline' : 'ghost'} onClick={() => focusQaChapter(chapter.id)} aria-label={`Mở QA chương ${chapter.no}`}>Chương {chapter.no} · {counts}</Button>;
                })}
              </div>}
              {activeQaIssues.length === 0 && <p className={styles.qaResultsMuted}>Không còn thẻ QA đang hiển thị.</p>}
              {qaPlacement.unplaced.length > 0 && <section className={styles.qaUnplaced} aria-labelledby="qa-unplaced-title">
                <h3 id="qa-unplaced-title">Thẻ không gắn được chương</h3>
                <div className={styles.qaIssueList}>{qaPlacement.unplaced.map((issue) => renderQaIssue(issue))}</div>
              </section>}
              {dismissedQaCount > 0 && <div className={styles.qaDismissed}><span>Đã bỏ qua {dismissedQaCount} thẻ · Hiện lại</span><Button size="sm" onClick={restoreDismissedQaIssues}>Hiện lại</Button></div>}
              <p className={styles.qaResultsMuted}>Kết quả QA không được lưu; chạy lại sau khi chỉnh kịch bản để cập nhật.</p>
            </details>}
            <label className={styles.selectAll}><input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? new Set(chapters.map((chapter) => chapter.id)) : new Set())} />Chọn tất cả chương</label>
            {visibleManualQuality && <section className={styles.manualQuality} aria-live="polite" aria-labelledby="manual-quality-title">
              <h3 id="manual-quality-title">Độ dài bản thảo vừa nhập</h3>
              <p>{visibleManualQuality.totalWords} / {visibleManualQuality.targetWords} từ ({visibleManualQuality.targetPercent}%)</p>
              {visibleManualQuality.outsideLengthRange && <p className={styles.qualityWarning}>Cảnh báo: tổng độ dài nằm ngoài ngưỡng 85–115%. Bản thảo vẫn được nhập.</p>}
              {visibleManualQuality.plannedBudgetWarning && <p className={styles.qualityWarning}>Tổng targetWords dự kiến lệch {visibleManualQuality.plannedDeviationPct > 0 ? '+' : ''}{visibleManualQuality.plannedDeviationPct}% so với ngân sách dự án.</p>}
              {visibleManualQuality.warnings.filter((warning) => warning.startsWith('Act ')).map((warning) => <p className={styles.qualityWarning} key={warning}>{warning}</p>)}
              <ul>{visibleManualQuality.chapters.map((chapter) => <li key={chapter.chapterNo}>Chương {chapter.chapterNo}: {chapter.words} / {chapter.targetWords} từ ({chapter.deviationPct > 0 ? '+' : ''}{chapter.deviationPct}%) {chapter.outsideLengthRange ? '· ngoài ngưỡng 85–115%' : ''}</li>)}</ul>
            </section>}
            <div className={styles.chapterList}>
              {chapters.map((chapter) => {
                const isCurrentRegen = regen?.id === chapter.id;
                const busy = Boolean(isCurrentRegen) || chapter.status === 'generating';
                const isEditing = editing === chapter.id;
                const isExpanded = expanded.has(chapter.id);
                const meta = chapterMetaText(chapter);
                const budgetNote = chapterWordBudgetNote(chapter);
                const chapterQaIssues = qaPlacement.byChapterNo.get(chapter.no) ?? [];
                const chapterQaSummary = qaChapterSummaries.get(chapter.no);
                const qaChipTone = chapterQaSummary ? qaSeverityTone(chapterQaSummary.highest) : null;
                const qaChipVariant = qaChipTone === 'amber' ? 'amber' : qaChipTone === 'indigo' ? 'indigoline' : 'ghost';
                return <article className={styles.chapter} data-selected={selected.has(chapter.id)} key={chapter.id}>
                  <div className={styles.chapterTop}>
                    <input type="checkbox" checked={selected.has(chapter.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(chapter.id); else next.delete(chapter.id); return next; })} aria-label={`Chọn chương ${chapter.no}`} />
                    <button type="button" className={styles.chapterToggle} aria-expanded={isExpanded || isEditing} aria-controls={`chapter-body-${chapter.id}`} onClick={() => toggleExpanded(chapter.id)}>
                      <span className={styles.chapterNo}>{String(chapter.no).padStart(2, '0')}</span><span className={styles.chapterTitle}>{chapter.title}</span>{meta && <span className={styles.chapterMeta}>{meta}</span>}<Icon name="chevron" className={styles.chapterChevron} />
                    </button>
                    <Badge tone={statusTone[chapter.status]}>{statusLabel[chapter.status]}</Badge>
                    {chapter.reviewStatus === 'upstream-changed' && <span title="Chương trước đã thay đổi; hãy xem lại chương này trước khi chốt."><Badge tone="amber">Cần xem lại: chương trước đã đổi</Badge></span>}
                    {chapter.sourceFacts !== undefined && chapter.sourceFacts.length < 2 && (chapter.targetWords ?? 0) > 150 && <span className={styles.thinSourceNote}>Nguồn mỏng — chương này dễ bị kéo dài</span>}
                    {budgetNote && <Badge tone={budgetNote.tone}>{budgetNote.text}</Badge>}
                    {chapterQaSummary && <Button size="sm" variant={qaChipVariant} onClick={() => focusQaChapter(chapter.id)} aria-label={`Mở QA chương ${chapter.no}`}>QA {chapterQaSummary.total}</Button>}
                    <span className={styles.spacer} />
                    <div className={styles.actions}>
                      {isCurrentRegen ? <Button size="sm" variant="red" onClick={() => regen.controller.abort()}>Hủy</Button> : <>
                        <Button size="icon" active={chapter.status === 'needs-fix'} aria-label={`Đánh dấu cần sửa chương ${chapter.no}`} aria-pressed={chapter.status === 'needs-fix'} disabled={busy} onClick={() => void patch(chapter.id, { status: toggleFlagStatus(chapter.status) })}><Icon name="flag" /></Button>
                        <Button disabled={busy} onClick={() => startEdit(chapter)}><Icon name="edit" />Sửa</Button>
                        {regenMode === 'manual' ? <Button variant="indigoline" disabled={busy || controlsBusy || manualRegenBusy} onClick={() => void loadManualRegenPrompt(chapter)}>{manualRegenBusy ? 'Đang lấy prompt…' : <><Icon name="refresh" />Lấy prompt tái tạo</>}</Button> : regenMode === 'cli' ? <Button variant="indigoline" disabled={busy || controlsBusy || !cliStatusQuery.data?.available} onClick={() => void enqueueClaudeCli([chapter.id], instructionForChapter(instructionOrigin, regenInstruction, chapter.id))}><Icon name="refresh" />Tái tạo bằng Claude CLI</Button> : <Button variant="indigoline" disabled={busy || controlsBusy} onClick={() => void regenerate(chapter)}><Icon name="refresh" />Tái tạo</Button>}
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
                   {isExpanded && chapterQaIssues.length > 0 && <section ref={(element) => { qaBlockRefs.current[chapter.id] = element; }} className={styles.chapterQaBlock} aria-labelledby={`chapter-qa-title-${chapter.id}`}>
                     <div className={styles.chapterQaHead}><div><h3 id={`chapter-qa-title-${chapter.id}`}>Kiểm tra cuối · {chapterQaIssues.length} thẻ</h3></div>{qaStale && <span className={styles.qaResultsMuted}>Kết quả QA có thể đã cũ.</span>}</div>
                     <div className={styles.qaIssueList}>{chapterQaIssues.filter((issue) => issue.severity !== 'low').map((issue) => renderQaIssue(issue, true))}</div>
                     {chapterQaIssues.some((issue) => issue.severity === 'low') && <details className={styles.qaLowGroup}>
                       <summary>Xem {chapterQaIssues.filter((issue) => issue.severity === 'low').length} thẻ mức thấp</summary>
                       <div className={styles.qaIssueList}>{chapterQaIssues.filter((issue) => issue.severity === 'low').map((issue) => renderQaIssue(issue, true))}</div>
                     </details>}
                   </section>}
                   {shouldOfferOpeningHook(chapter, projectQuery.data?.openingHook ?? '') && <div className={styles.hookCallout}><div><strong>Hook mở đầu đề xuất</strong><p>{projectQuery.data?.openingHook}</p></div><Button variant="amber" disabled={busy} onClick={() => void insertOpeningHook(chapter)}>Chèn hook làm đoạn đầu tiên</Button></div>}
                   <div className={styles.chapterBody} id={`chapter-body-${chapter.id}`} hidden={!isExpanded && !isEditing}>{isEditing ? <><textarea ref={editTextareaRef} className={styles.textarea} value={editParagraphs.join('\n\n')} onChange={(event) => setEditParagraphs(event.target.value.split(/\n\s*\n/))} aria-label={`Sửa nội dung chương ${chapter.no}`} /><div className={styles.editorActions}><Button size="sm" onClick={() => setEditing(null)}>Hủy</Button><Button size="sm" variant="amber" onClick={() => void saveEdit(chapter.id)}><Icon name="save" />Lưu</Button></div></> : <><div className={styles.narrativeMeta}>{chapter.role && <span>Vai trò: {chapter.role}</span>}{chapter.targetWords != null && <span>Mục tiêu: {chapter.targetWords} từ</span>}{chapter.beat && <span>Nhịp: {chapter.beat}</span>}{chapter.endsOnTension && <span>Kết tension</span>}</div>{chapter.paragraphs.map((paragraph, index) => <p key={`${chapter.id}-${index}`}>{paragraph}</p>)}</>}</div>
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
              <textarea id="regen-instruction" className={styles.textarea} rows={5} value={regenInstruction} onChange={(event) => { setRegenInstruction(event.target.value); setInstructionOrigin({ kind: 'user' }); }} placeholder="VD: Giọng kể trầm hơn, nhấn mạnh việc thuyền lương bị bỏ lại…" />
              <fieldset className={styles.segmented}>
                <legend>Mức thay đổi</legend>
                {([['light', 'Nhẹ'], ['medium', 'Vừa'], ['rewrite', 'Viết lại']] as const).map(([value, label]) => <label key={value}><input type="radio" name="regen-level" value={value} checked={regenLevel === value} onChange={() => setRegenLevel(value)} /><span>{label}</span></label>)}
              </fieldset>
               <Button variant="indigo" size="lg" className={styles.blockButton} title={regenMode === 'manual' ? 'Chế độ thủ công chỉ tái tạo từng chương' : undefined} disabled={regenMode === 'manual' || controlsBusy || (regenMode === 'cli' && !cliStatusQuery.data?.available) || selectedRegenIds.length === 0} onClick={() => void regenerateSelected()}><Icon name="refresh" />Tái tạo chương đã chọn</Button>
               {selectedRegenIds.length === 0 && <p className={styles.muted}>Chọn ít nhất một chương để tái tạo.</p>}
               {regenMode === 'manual' && <p className={styles.muted}>Chế độ thủ công: dùng “Lấy prompt tái tạo” trên từng chương.</p>}
            </section>

            <section className={`${styles.panel} ${styles.historyPanel}`} aria-labelledby="history-title">
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
                  <textarea className={styles.textarea} value={qaManualRaw} onChange={(event) => { setQaManualRaw(event.target.value); setQaManualError(null); }} placeholder='{"issues":[{"chapter":1,"paragraph":2,"quote":"…","fixInstruction":"…","replacement":"…","type":"REPETITION","severity":"low","reason":"…","suggestedAction":"REMOVE_DUPLICATION"}]}' aria-label="JSON kết quả QA" />
                  <p className={styles.muted}>Loại: {api.QA_ISSUE_TYPES.join(', ')} · Mức độ: {api.QA_SEVERITIES.join(', ')} · Đề xuất: {api.QA_SUGGESTED_ACTIONS.join(', ')}</p>
                  {qaManualError && <p className={styles.error}>{qaManualError}</p>}
                  <Button variant="amber" disabled={qaControlsBusy || !qaManualRaw.trim()} onClick={() => void importQaManual()}>Nhập kết quả QA</Button>
                </>}
                {!qaManualPrompt && qaManualError && <p className={styles.error}>{qaManualError}</p>}
              </div>}
            </section>
          </aside>
        </div>
      )}

      <footer className={styles.footer}><Button variant="amber" disabled={!allApproved || hasGenerating || reviewJobLocked || cliJobLocked} onClick={() => void finalize()}>Chốt & chia cảnh</Button></footer>
      {qaDialog && qaDialogChapter && <QaFixDialog
        projectId={projectId}
        issue={qaDialog.issue}
        typeLabel={qaDialog.issue ? qaTypeLabel[qaDialog.issue.type] : undefined}
        chapter={qaDialogChapter}
        chapters={chapters}
        baseline={qaDialog.baseline}
        mode={qaDialog.mode}
        provider={projectQuery.data?.aiProvider ?? 'deepseek'}
        initialInstruction={qaDialog.initialInstruction}
        initialLevel={qaDialog.initialLevel}
        viewOnly={qaDialog.viewOnly}
        isRunning={regen?.id === qaDialog.chapterId}
        otherRegenRunning={Boolean(regen && regen.id !== qaDialog.chapterId)}
        preview={regen?.id === qaDialog.chapterId ? regen.preview : ''}
        result={qaDialog.result}
        restored={qaDialog.restored}
        undoIndex={qaDialogUndoIndex}
        onClose={() => setQaDialog(null)}
        onChangeMode={(mode) => setQaDialog((current) => current ? { ...current, mode } : current)}
        onRegenerate={(instruction, level) => void runQaDialogRegeneration(instruction, level)}
        onAbort={() => regen?.id === qaDialog.chapterId && regen.controller.abort()}
        onImport={importQaDialogChapter}
        onUndo={() => void undoQaDialog()}
        onKeep={keepQaDialog}
        onDismiss={dismissQaDialog}
        onContinueNext={continueQaDialog}
      />}
      {reviewJobTask && activeReviewStartedAt !== null && !reviewJobLocallyUnlocked && <BlockingProgressDialog
        visible
        task={reviewJobTask}
        jobId={activeReviewJobId}
        progress={activeReviewProgress}
        uploadProgress={null}
        startedAt={activeReviewStartedAt}
        lastEventAt={reviewJobLastEventAt}
        onCancel={() => void cancelReviewJob()}
        onClose={closeReviewJob}
        onReload={() => void reloadReviewJob()}
        onUnlock={() => setReviewJobLocallyUnlocked(true)}
      />}
      {qaBulkRunning && qaBulkStartedAt !== null && <BlockingProgressDialog
        visible
        task={{ kind: 'qa-bulk-apply', detail: qaBulkProgress?.logs[qaBulkProgress.logs.length - 1], immediate: true }}
        jobId={null}
        progress={qaBulkProgress}
        uploadProgress={null}
        startedAt={qaBulkStartedAt}
        lastEventAt={qaBulkLastEventAt}
        onCancel={cancelQaBulkApply}
        onClose={() => undefined}
      />}
      {cliJobId && cliJobStartedAt !== null && <BlockingProgressDialog
        visible
        task={{ kind: 'claude-cli-regeneration', detail: cliProgress?.logs.at(-1), immediate: true }}
        jobId={cliJobId}
        progress={cliProgress}
        uploadProgress={null}
        startedAt={cliJobStartedAt}
        lastEventAt={cliJobLastEventAt}
        onCancel={() => void cancelClaudeCliJob()}
        onClose={closeClaudeCliJob}
      />}
    </div>
  );
}
