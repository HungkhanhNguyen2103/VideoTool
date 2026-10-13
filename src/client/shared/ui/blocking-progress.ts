export type BlockingTaskKind =
  | 'render'
  | 'render-draft'
  | 'voiceover-all'
  | 'voiceover'
  | 'align-words'
  | 'sfx-all'
  | 'sfx'
  | 'bgm'
  | 'visual-prompts'
  | 'split-scenes'
  | 'depth-maps'
  | 'video-distribution-preview'
  | 'video-distribution-apply'
  | 'fit-to-clip'
  | 'preview'
  | 'import-zip'
  | 'quick'
  | 'script-generation'
  | 'cli-script-generation'
  | 'claude-cli-regeneration'
  | 'final-qa'
  | 'name-keywords'
  | 'popup-analysis'
  | 'recompute-durations'
  | 'qa-bulk-apply';

export type BlockingTask = {
  kind: BlockingTaskKind;
  detail?: string;
  immediate?: boolean;
};

export type BlockingProgressInput = {
  status: string;
  progress: number;
  error: string | null;
  logs: readonly string[];
};

export type BlockingProgressViewModel = {
  title: string;
  statusText: string;
  percent: number | null;
  indeterminate: boolean;
  elapsedText: string;
  logs: string[];
  error: string | null;
  detail: string | null;
  terminal: boolean;
  staleConnection: boolean;
  canCancel: boolean;
};

const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled']);
const TASK_TITLES: Record<BlockingTaskKind, string> = {
  render: 'Đang render video',
  'render-draft': 'Đang render nháp',
  'voiceover-all': 'Đang tạo voiceover',
  voiceover: 'Đang tạo voiceover',
  'align-words': 'Đang căn thời gian từ',
  'sfx-all': 'Đang tạo tất cả SFX',
  sfx: 'Đang tạo SFX',
  bgm: 'Đang tạo BGM',
  'visual-prompts': 'Đang tạo visual prompt',
  'split-scenes': 'Đang tách nhỏ scene',
  'depth-maps': 'Đang tạo depth map',
  'video-distribution-preview': 'Đang xem trước phân bổ video',
  'video-distribution-apply': 'Đang áp dụng phân bổ video',
  'fit-to-clip': 'Đang kéo dài scene theo clip',
  preview: 'Đang tạo preview',
  'import-zip': 'Đang nhập ZIP',
  quick: 'Đang cập nhật',
  'script-generation': 'Đang tạo kịch bản',
  'cli-script-generation': 'Đang viết kịch bản bằng Claude CLI',
  'claude-cli-regeneration': 'Đang tái tạo bằng Claude CLI',
  'final-qa': 'Đang kiểm tra QA',
  'name-keywords': 'Đang phân tích tên popup',
  'popup-analysis': 'Đang phân tích popup',
  'recompute-durations': 'Đang tính lại thời lượng scene',
  'qa-bulk-apply': 'Đang áp dụng QA',
};

export function blockingTaskTitle(task: BlockingTask): string {
  const title = TASK_TITLES[task.kind];
  return task.detail ? `${title} · ${task.detail}` : title;
}

export function taskFromBusyKey(busy: string | null, sceneLabelForId: (sceneId: string) => string | undefined): BlockingTask | null {
  if (!busy) return null;
  if (busy === 'import') return { kind: 'import-zip' };
  if (busy === 'voiceover-all') return { kind: 'voiceover-all' };
  if (busy === 'align-words') return { kind: 'align-words' };
  if (busy === 'sfx-all') return { kind: 'sfx-all' };
  if (busy === 'bgm') return { kind: 'bgm' };
  if (busy === 'video-distribution-preview') return { kind: 'video-distribution-preview', immediate: false };
  if (busy === 'video-distribution-apply') return { kind: 'video-distribution-apply' };
  if (busy === 'fit-to-clip' || busy.startsWith('fit-to-clip:')) return { kind: 'fit-to-clip' };
  if (busy === 'preview' || busy.startsWith('preview:')) return { kind: 'preview' };
  if (busy === 'render') return { kind: 'render' };
  if (busy === 'render-draft') return { kind: 'render-draft' };
  if (busy === 'depth-maps') return { kind: 'depth-maps' };
  if (busy === 'visual-prompts') return { kind: 'visual-prompts' };
  if (busy === 'split-scenes') return { kind: 'split-scenes' };
  if (busy === 'name-keywords') return { kind: 'name-keywords' };
  if (busy === 'popup-analysis') return { kind: 'popup-analysis' };
  if (busy === 'recompute-durations') return { kind: 'recompute-durations' };
  const sceneMatch = /^(voice|sfx):(.+)$/.exec(busy);
  if (sceneMatch) {
    const kind = sceneMatch[1] === 'voice' ? 'voiceover' : 'sfx';
    const detail = sceneLabelForId(sceneMatch[2]!);
    return detail ? { kind, detail } : { kind };
  }
  const quickLabels: Record<string, string> = {
    copy: 'sao chép JSON',
    download: 'tải JSON',
    type: 'đổi loại asset',
    'render-engine': 'đổi render engine',
    'keyword-popups': 'cập nhật chữ pop-up',
    'transition-style': 'đổi chuyển cảnh',
    'film-look': 'đổi hiệu ứng phim cũ',
    parallax: 'đổi hiệu ứng chiều sâu',
    'ai-provider': 'đổi nhà cung cấp AI',
    'visual-style': 'đổi visual style',
    'scene-tail': 'cập nhật khoảng nghỉ scene',
  };
  if (busy === 'scene' || busy.startsWith('scene:')) {
    const sceneId = busy.slice('scene:'.length);
    const detail = sceneLabelForId(sceneId);
    return { kind: 'quick', detail: detail ? `cập nhật ${detail}` : 'cập nhật scene', immediate: false };
  }
  const quickLabel = quickLabels[busy];
  return quickLabel ? { kind: 'quick', detail: quickLabel, immediate: false } : null;
}

export function isStudioLocked(busy: string | null, jobId: string | null, progress: Pick<BlockingProgressInput, 'status'> | null): boolean {
  if (busy !== null) return true;
  if (!jobId) return false;
  return progress === null || progress.status === 'queued' || progress.status === 'running';
}

export function shouldShowBlockingProgress(active: boolean, immediate: boolean, elapsedMs: number, thresholdMs = 400): boolean {
  return active && (immediate || elapsedMs >= thresholdMs);
}

export function formatElapsedMs(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function blockingProgressViewModel(args: {
  task: BlockingTask;
  jobId: string | null;
  progress: BlockingProgressInput | null;
  uploadProgress: number | null;
  startedAt: number;
  lastEventAt: number | null;
  now: number;
  staleAfterMs?: number;
}): BlockingProgressViewModel {
  const status = args.progress?.status ?? (args.jobId ? 'queued' : 'running');
  const terminal = TERMINAL_STATUSES.has(status);
  const percent = args.uploadProgress !== null
    ? clampPercent(args.uploadProgress)
    : args.progress && Number.isFinite(args.progress.progress) ? clampPercent(args.progress.progress) : null;
  const staleAfterMs = args.staleAfterMs ?? 45_000;
  const lastEventAt = args.lastEventAt ?? args.startedAt;
  const staleConnection = Boolean(args.jobId) && !terminal && args.now - lastEventAt >= staleAfterMs;
  const statusText = status === 'queued'
    ? 'Đang xếp hàng'
    : status === 'running'
      ? 'Đang chạy'
      : status === 'failed'
        ? 'Tác vụ thất bại'
        : status === 'cancelled'
          ? 'Đã huỷ tác vụ'
          : status;
  return {
    title: blockingTaskTitle(args.task),
    statusText,
    percent,
    indeterminate: percent === null,
    elapsedText: formatElapsedMs(args.now - args.startedAt),
    logs: [...(args.progress?.logs ?? [])].slice(-3),
    error: args.progress?.error ?? null,
    detail: null,
    terminal,
    staleConnection,
    canCancel: !terminal && (Boolean(args.jobId) || args.task.kind === 'qa-bulk-apply'),
  };
}
